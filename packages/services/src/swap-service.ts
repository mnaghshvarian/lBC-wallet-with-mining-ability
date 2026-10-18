import {
  BITCOIN_NETWORKS,
  EsploraClient,
  SWAP_CHAINS,
  SWAP_TIMING,
  addressToScript,
  buildHtlcSpend,
  checkContract,
  confirmationsAt,
  decodeAddress,
  decodeSwapCode,
  encodeSwapCode,
  equalBytes,
  esploraSwapChain,
  extractSecret,
  fromHex,
  hash160,
  htlcAddress,
  htlcOutputScript,
  htlcScript,
  otherCoin,
  parseHtlc,
  publicKeyOf,
  randomBytes,
  refundOpen,
  secretHashOf,
  starterLocktime,
  toHex,
  getNetwork,
  Transaction,
  type NetworkName,
  type SwapChain,
  type SwapCoin,
  type SwapContractRecord,
  type SwapRecord,
  type SwapTiming,
  type SwapTx,
} from '@lbcwallet/core';
import type { NoticeView, SwapCodeView, SwapContractView, SwapStage, SwapView } from './api.js';
import { UserError } from './errors.js';
import type { SettingsStore } from './settings.js';
import { scopedLogger, type Logger, type Platform } from './platform.js';

/** What the swap service needs from the open wallet. */
export interface SwapWallet {
  network: NetworkName;
  watchOnly: boolean;
  records(): SwapRecord[];
  saveRecords(records: SwapRecord[]): void;
  /** A fresh receiving address of the wallet. */
  receiveAddress(): string;
  /** LBC through the wallet's server or node. */
  lbc: SwapChain;
  /** Pays dewies from the wallet to an address (a contract); resolves with the transaction id and output index. */
  pay(address: string, amount: bigint, password: string | undefined, label: string): Promise<{ txid: string; vout: number }>;
  /** Writes the records to disk now, before coins are sent on their strength. */
  flush?(): void;
}

export interface SwapServiceDeps {
  /** The open wallet, or null while locked. */
  wallet: () => SwapWallet | null;
  changed: (view: SwapView) => void;
  notice: (n: NoticeView) => void;
  /** Bitcoin access; tests pass their own. Default: Esplora servers from the settings. */
  bitcoin?: (network: NetworkName) => SwapChain;
  now?: () => number;
  /** Shorter time rules for tests. */
  timing?: SwapTiming;
}

/** Public Esplora servers per network: the first is read, the others confirm the other side's coins. */
export const DEFAULT_BTC_EXPLORERS: Record<NetworkName, string[]> = {
  mainnet: ['https://blockstream.info/api', 'https://mempool.space/api'],
  testnet: ['https://blockstream.info/testnet/api', 'https://mempool.space/testnet/api'],
  regtest: [],
};

/** Smallest swaps: below these the network fees eat too much of the amount. */
export const MIN_SWAP_LBC = 10n * 100_000_000n;
export const MIN_SWAP_BTC = 20_000n;
/** While swaps are new, mainnet swaps are capped to limit what a bug could cost. */
export const MAX_SWAP_BTC = 5_000_000n;

const POLL_MS = 30_000;
const REBROADCAST_MS = 10 * 60_000;
const MAX_EVENTS = 40;

const amountOf = (r: SwapRecord, coin: SwapCoin) => BigInt(coin === 'LBC' ? r.lbc : r.btc);
const pkhOf = (keyHex: string) => hash160(publicKeyOf(fromHex(keyHex)));

function newKey(): Uint8Array {
  for (;;) {
    const key = randomBytes(32);
    try {
      publicKeyOf(key);
      return key;
    } catch {
      // outside the curve order (astronomically rare); draw again
    }
  }
}

/** The output of `txs` paying to `script`: the expected one if known, else the first. */
function findFunding(txs: SwapTx[], script: Uint8Array, expected?: { txid: string; vout: number }): { txid: string; vout: number; value: bigint; height: number } | null {
  for (const t of txs) {
    if (expected && t.txid !== expected.txid) continue;
    for (let vout = 0; vout < t.outputs.length; vout++) {
      if (expected && vout !== expected.vout) continue;
      if (equalBytes(t.outputs[vout]!.script, script)) return { txid: t.txid, vout, value: t.outputs[vout]!.value, height: t.height };
    }
  }
  return null;
}

type Spend = { tx: SwapTx; input: SwapTx['inputs'][number] };

/** Every transaction reported as spending an outpoint, with the input that does, in the servers' order. */
function findSpends(txs: SwapTx[], outpoint: { txid: string; vout: number }): Spend[] {
  const out: Spend[] = [];
  for (const tx of txs) {
    const input = tx.inputs.find((i) => i.txid === outpoint.txid && i.vout === outpoint.vout);
    if (input) out.push({ tx, input });
  }
  return out;
}

/** Fee rates above these are a wrong or malicious estimate, not a market (smallest unit per byte). */
const MAX_FEE_RATE: Record<SwapCoin, number> = { BTC: 1000, LBC: 1000 };
/** A claim or refund never pays more than this share of its value in fees, whatever the estimate says. */
const MAX_FEE_SHARE = 0.25;
/** Size of a contract spend, for the fee bounds (buildHtlcSpend knows the exact size). */
const SPEND_SIZE = 340;

/**
 * Atomic swaps between LBC and Bitcoin (see core/swap/protocol.ts). Swaps are
 * stored in the wallet that made them and run while that wallet is open:
 * every 30 seconds the service reads both contracts, and claims or refunds as
 * soon as the protocol allows. Locking LBC is the only step that needs the
 * user (and their password, like any payment).
 */
export class SwapService {
  private readonly log: Logger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private lastBroadcast = new Map<string, number>();

  constructor(
    private readonly platform: Platform,
    private readonly settings: SettingsStore,
    private readonly deps: SwapServiceDeps,
  ) {
    this.log = scopedLogger(platform, 'swap');
  }

  private now(): number {
    return Math.floor((this.deps.now?.() ?? Date.now()) / 1000);
  }

  private get timing(): SwapTiming {
    return this.deps.timing ?? SWAP_TIMING;
  }

  private wallet(): SwapWallet {
    const w = this.deps.wallet();
    if (!w) throw new UserError('noWalletOpen');
    return w;
  }

  private bitcoin(network: NetworkName): SwapChain {
    if (this.deps.bitcoin) return this.deps.bitcoin(network);
    const custom = this.settings.get().swap.btcExplorer.trim();
    const servers = custom ? [custom] : DEFAULT_BTC_EXPLORERS[network];
    if (servers.length === 0) throw new UserError('swapNoExplorer');
    const post = this.platform.postText?.bind(this.platform);
    if (!post) throw new UserError('swapUnsupported');
    const http = { getJson: (url: string) => this.platform.fetchJson(url), postText: post };
    const [first, ...others] = servers.map((s) => new EsploraClient(s, http));
    return esploraSwapChain(first!, others);
  }

  private chain(w: SwapWallet, coin: SwapCoin): SwapChain {
    return coin === 'LBC' ? w.lbc : this.bitcoin(w.network);
  }

  // ---------------------------------------------------------------- records

  private records(): SwapRecord[] {
    return this.wallet().records();
  }

  private record(id: string): SwapRecord {
    const r = this.records().find((x) => x.id === id);
    if (!r) throw new UserError('swapUnknown');
    return r;
  }

  private save(w: SwapWallet, r: SwapRecord): void {
    r.updatedAt = Date.now();
    const list = w.records().filter((x) => x.id !== r.id);
    list.push(r);
    w.saveRecords(list);
    this.deps.changed(this.view(r));
  }

  private event(r: SwapRecord, code: string, params?: Record<string, string | number>): void {
    r.events.push({ at: Date.now(), code, ...(params ? { params } : {}) });
    if (r.events.length > MAX_EVENTS) r.events.splice(0, r.events.length - MAX_EVENTS);
    this.log('info', `swap ${r.id}: ${code}${params ? ` ${JSON.stringify(params)}` : ''}`);
  }

  // ---------------------------------------------------------------- views

  private contractView(c: SwapContractRecord, tips: Partial<Record<SwapCoin, number>>): SwapContractView {
    const tip = tips[c.coin] ?? 0;
    return {
      coin: c.coin,
      address: c.address,
      locktime: c.locktime,
      txid: c.funding?.txid,
      value: c.funding?.value,
      confirmations: c.funding ? confirmationsAt(c.funding.height, tip) : 0,
      required: SWAP_CHAINS[c.coin].confirmations,
    };
  }

  private tips: Partial<Record<SwapCoin, number>> = {};

  stage(r: SwapRecord): SwapStage {
    if (r.status !== 'active') return r.status;
    if (r.refund) return 'refunding';
    if (r.claim) return 'claiming';
    const abandoned = !!r.problem && r.problem.code !== 'explorer';
    if (r.role === 'starter') {
      if (!r.ours) {
        if (!r.theirs) return 'send-invite';
        return r.theirs.verified ? 'lock' : 'checking';
      }
      if (!r.ours.funding) return abandoned ? 'refund-waiting' : r.give === 'LBC' ? 'lock' : 'pay-btc';
      if (r.secret) return 'claiming';
      return abandoned || refundOpen(r.ours.locktime, r.give, this.now(), this.timing) ? 'refund-waiting' : 'send-lock';
    }
    if (!r.ours) return 'lock';
    if (!r.ours.funding) return abandoned ? 'refund-waiting' : r.give === 'LBC' ? 'lock' : 'pay-btc';
    if (abandoned) return 'refund-waiting';
    if (!r.theirs) return refundOpen(r.ours.locktime, r.give, this.now(), this.timing) ? 'refund-waiting' : 'send-lock';
    return r.theirs.verified ? 'claiming' : 'checking';
  }

  private code(r: SwapRecord, stage: SwapStage): string | undefined {
    if (stage === 'send-invite') {
      return encodeSwapCode({ type: 'invite', network: r.network, id: r.id, starterGives: r.give, lbc: BigInt(r.lbc), btc: BigInt(r.btc), starterPkh: pkhOf(r.getKey) });
    }
    if (r.ours?.funding && (stage === 'send-lock' || stage === 'checking' || stage === 'claiming')) {
      return encodeSwapCode({
        type: 'lock',
        network: r.network,
        id: r.id,
        coin: r.ours.coin,
        contract: fromHex(r.ours.contract),
        txid: r.ours.funding.txid,
        vout: r.ours.funding.vout,
        ...(r.role === 'joiner' ? { joinerPkh: pkhOf(r.getKey) } : {}),
      });
    }
    return undefined;
  }

  view(r: SwapRecord): SwapView {
    const stage = this.stage(r);
    const get = otherCoin(r.give);
    return {
      id: r.id,
      role: r.role,
      give: r.give,
      get,
      lbc: r.lbc,
      btc: r.btc,
      stage,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      code: this.code(r, stage),
      expectsCode: !r.theirs && ((r.role === 'starter' && stage === 'send-invite') || (r.role === 'joiner' && stage === 'send-lock')),
      payTo: stage === 'pay-btc' && r.ours && r.give === 'BTC' ? { address: r.ours.address, amount: r.btc } : undefined,
      ours: r.ours ? this.contractView(r.ours, this.tips) : undefined,
      theirs: r.theirs ? this.contractView(r.theirs, this.tips) : undefined,
      claimTxid: r.claim?.txid,
      refundTxid: r.refund?.txid,
      receiveTo: r.receiveTo,
      refundTo: r.refundTo,
      refundAt: r.ours ? r.ours.locktime + this.timing.clockLag[r.give] : undefined,
      cancellable: r.status === 'active' && !r.ours?.funding && !r.claim,
      lockBy: r.lockBy,
      problem: r.problem,
      events: r.events,
    };
  }

  list(): SwapView[] {
    const w = this.deps.wallet();
    if (!w) return [];
    return w
      .records()
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => this.view(r));
  }

  // ---------------------------------------------------------------- user actions

  private checkAmounts(network: NetworkName, lbc: bigint, btc: bigint): void {
    checkSwapAmounts(network, lbc, btc);
  }

  private btcAddress(network: NetworkName, address: string): string {
    return checkBtcAddress(network, address);
  }

  private writable(w: SwapWallet): void {
    if (w.watchOnly) throw new UserError('watchOnly');
  }

  /** Starts a swap: returns its invite code for the other person. */
  start(params: { give: SwapCoin; lbc: string; btc: string; btcAddress: string }): SwapView {
    const w = this.wallet();
    this.writable(w);
    if (params.give !== 'LBC' && params.give !== 'BTC') throw new UserError('invalidAmount');
    let lbc: bigint;
    let btc: bigint;
    try {
      lbc = BigInt(params.lbc);
      btc = BigInt(params.btc);
    } catch {
      throw new UserError('invalidAmount');
    }
    this.checkAmounts(w.network, lbc, btc);
    const btcAddress = this.btcAddress(w.network, params.btcAddress);
    const lbcAddress = w.receiveAddress();
    const r: SwapRecord = {
      id: toHex(randomBytes(8)),
      role: 'starter',
      network: w.network,
      give: params.give,
      lbc: lbc.toString(),
      btc: btc.toString(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      giveKey: toHex(newKey()),
      getKey: toHex(newKey()),
      receiveTo: params.give === 'LBC' ? btcAddress : lbcAddress,
      refundTo: params.give === 'LBC' ? lbcAddress : btcAddress,
      status: 'active',
      events: [],
    };
    this.event(r, 'created');
    this.save(w, r);
    return this.view(r);
  }

  /** What a code is, before anything is done with it. */
  inspect(text: string): SwapCodeView {
    const w = this.wallet();
    let code;
    try {
      code = decodeSwapCode(text);
    } catch (err) {
      throw new UserError('swapCodeInvalid', { detail: (err as Error).message });
    }
    if (code.network !== w.network) throw new UserError('swapWrongNetwork', { network: code.network });
    const known = w.records().some((r) => r.id === code.id);
    if (code.type === 'invite') return { type: 'invite', id: code.id, network: code.network, youGive: otherCoin(code.starterGives), lbc: code.lbc.toString(), btc: code.btc.toString(), known };
    return { type: 'lock', id: code.id, network: code.network, coin: code.coin, known };
  }

  /**
   * Joins a swap from its invite. Nothing is locked yet: that is the next
   * step, which `lockBy` (Unix seconds) can limit in time (trades from the
   * order board, whose other side gives up after a while).
   */
  join(params: { code: string; btcAddress: string; lockBy?: number }): SwapView {
    const w = this.wallet();
    this.writable(w);
    let invite;
    try {
      invite = decodeSwapCode(params.code);
    } catch (err) {
      throw new UserError('swapCodeInvalid', { detail: (err as Error).message });
    }
    if (invite.type !== 'invite') throw new UserError('swapWrongCode');
    if (invite.network !== w.network) throw new UserError('swapWrongNetwork', { network: invite.network });
    if (w.records().some((r) => r.id === invite.id)) throw new UserError('swapAlreadyJoined');
    this.checkAmounts(w.network, invite.lbc, invite.btc);
    const give = otherCoin(invite.starterGives);
    const btcAddress = this.btcAddress(w.network, params.btcAddress);
    const lbcAddress = w.receiveAddress();
    const secret = randomBytes(32);
    const r: SwapRecord = {
      id: invite.id,
      role: 'joiner',
      network: w.network,
      give,
      lbc: invite.lbc.toString(),
      btc: invite.btc.toString(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      giveKey: toHex(newKey()),
      getKey: toHex(newKey()),
      secret: toHex(secret),
      secretHash: toHex(secretHashOf(secret)),
      receiveTo: give === 'LBC' ? btcAddress : lbcAddress,
      refundTo: give === 'LBC' ? lbcAddress : btcAddress,
      theirPkh: toHex(invite.starterPkh),
      ...(params.lockBy ? { lockBy: params.lockBy } : {}),
      status: 'active',
      events: [],
    };
    this.event(r, 'joined');
    this.save(w, r);
    return this.view(r);
  }

  /** Takes the other person's lock code. */
  accept(params: { code: string }): SwapView {
    const w = this.wallet();
    let lock;
    try {
      lock = decodeSwapCode(params.code);
    } catch (err) {
      throw new UserError('swapCodeInvalid', { detail: (err as Error).message });
    }
    if (lock.type !== 'lock') throw new UserError('swapWrongCode');
    const r = this.record(lock.id);
    if (r.status !== 'active') throw new UserError('swapNotReady');
    if (r.ours && equalBytes(lock.contract, fromHex(r.ours.contract))) throw new UserError('swapOwnCode');
    if (lock.coin !== otherCoin(r.give)) throw new UserError('swapWrongCode');
    if (r.theirs) {
      if (r.theirs.contract === toHex(lock.contract) && r.theirs.funding?.txid === lock.txid) return this.view(r);
      throw new UserError('swapAlreadyHaveLock');
    }
    if (r.role === 'joiner' && !r.ours?.funding) throw new UserError('swapNotReady');
    if (r.role === 'starter' && !lock.joinerPkh) throw new UserError('swapWrongCode');
    let terms;
    try {
      terms = parseHtlc(lock.contract);
    } catch {
      throw new UserError('swapContractMismatch');
    }
    // It must pay to our claim key, and the joiner's must use our secret.
    if (!equalBytes(terms.recipientPkh, pkhOf(r.getKey))) throw new UserError('swapContractMismatch');
    if (r.role === 'joiner' && !equalBytes(terms.secretHash, fromHex(r.secretHash!))) throw new UserError('swapContractMismatch');
    const network = lock.coin === 'LBC' ? undefined : BITCOIN_NETWORKS[r.network];
    r.theirs = {
      coin: lock.coin,
      contract: toHex(lock.contract),
      address: network ? htlcAddress(lock.contract, network) : this.lbcContractAddress(w, lock.contract),
      locktime: terms.locktime,
      funding: { txid: lock.txid, vout: lock.vout, value: '0', height: 0 },
    };
    if (r.role === 'starter') {
      r.theirPkh = toHex(lock.joinerPkh!);
      r.secretHash = toHex(terms.secretHash);
    }
    this.event(r, 'their-lock');
    this.save(w, r);
    void this.poll();
    return this.view(r);
  }

  private lbcContractAddress(w: SwapWallet, contract: Uint8Array): string {
    return htlcAddress(contract, lbcAddressParams(w.network));
  }

  /** Locks our coins: pays LBC from the wallet, or shows where to pay the Bitcoin. */
  async lock(params: { id: string; password?: string }): Promise<SwapView> {
    const w = this.wallet();
    this.writable(w);
    const r = this.record(params.id);
    if (this.stage(r) !== 'lock') throw new UserError('swapNotReady');
    const now = this.now();
    if (!r.ours && r.lockBy && now > r.lockBy) throw new UserError('marketLockExpired');
    if (!r.ours) {
      let locktime: number;
      let secretHash: Uint8Array;
      if (r.role === 'joiner') {
        locktime = now + this.timing.joinerLock;
        secretHash = fromHex(r.secretHash!);
      } else {
        const theirs = r.theirs!;
        if (theirs.locktime - now < this.timing.starterMinRemaining) throw new UserError('swapTooLate', { hours: Math.floor(this.timing.starterMinRemaining / 3600) });
        locktime = starterLocktime(now, theirs.locktime, this.timing);
        secretHash = fromHex(r.secretHash!);
      }
      const contract = htlcScript({ secretHash, recipientPkh: fromHex(r.theirPkh!), refundPkh: pkhOf(r.giveKey), locktime });
      r.ours = {
        coin: r.give,
        contract: toHex(contract),
        address: r.give === 'LBC' ? this.lbcContractAddress(w, contract) : htlcAddress(contract, BITCOIN_NETWORKS[r.network]),
        locktime,
      };
      this.event(r, 'contract');
      this.save(w, r);
      // On disk before any payment into it: a crash after paying must not lose the contract's lock time.
      w.flush?.();
    }
    if (r.give === 'LBC') {
      const ours = r.ours;
      // An earlier attempt may have paid without being recorded: never pay twice.
      const paid = findFunding(await w.lbc.addressTxs(ours.address), htlcOutputScript(fromHex(ours.contract)));
      if (paid) {
        ours.funding = { txid: paid.txid, vout: paid.vout, value: paid.value.toString(), height: paid.height };
        this.save(w, r);
        return this.view(r);
      }
      const { txid, vout } = await w.pay(ours.address, BigInt(r.lbc), params.password, `Swap ${r.id.slice(0, 6)}: LBC for BTC`);
      ours.funding = { txid, vout, value: r.lbc, height: 0 };
      this.event(r, 'locked', { txid });
      this.save(w, r);
    }
    void this.poll();
    return this.view(r);
  }

  /** Stops a swap before any of our coins are locked. */
  cancel(id: string): SwapView {
    const w = this.wallet();
    const r = this.record(id);
    if (r.status !== 'active' || r.ours?.funding || r.claim) throw new UserError('swapCannotCancel');
    // A Bitcoin contract may already have been paid without the payment showing yet:
    // keep watching it and refund anything that arrives.
    if (r.ours) r.problem = { code: 'cancelled' };
    else r.status = 'cancelled';
    this.event(r, 'cancelled');
    this.save(w, r);
    return this.view(r);
  }

  /** Forgets a finished swap. */
  remove(id: string): void {
    const w = this.wallet();
    const r = this.record(id);
    if (r.status === 'active') throw new UserError('swapStillActive');
    w.saveRecords(w.records().filter((x) => x.id !== id));
  }

  /** Expected Bitcoin network fee for claiming or refunding a contract. */
  async btcFee(): Promise<{ satPerVbyte: number; claimSats: string } | null> {
    try {
      const w = this.wallet();
      const rate = await this.bitcoin(w.network).feeRate();
      // A contract claim is about 330 bytes.
      return { satPerVbyte: rate, claimSats: String(rate * 330) };
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------- the engine

  /** Checks the open wallet's swaps every 30 seconds (cheap when there are none). */
  watch(): void {
    this.timer ??= setInterval(() => void this.poll(), POLL_MS);
  }

  unwatch(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Checks every active swap of the open wallet once (one round at a time). */
  poll(): Promise<void> {
    this.running ??= this.pollOnce().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pollOnce(): Promise<void> {
    const w = this.deps.wallet();
    if (!w) return;
    const active = w.records().filter((r) => r.status === 'active');
    for (const r of active) {
      try {
        await this.step(w, r);
      } catch (err) {
        const message = (err as Error).message;
        this.log('warn', `swap ${r.id}: ${message}`);
        if (!r.problem || r.problem.code === 'explorer') {
          r.problem = { code: 'explorer', params: { detail: message.slice(0, 200) } };
          this.save(w, r);
        }
      }
    }
  }

  private async step(w: SwapWallet, r: SwapRecord): Promise<void> {
    if (!r.ours && !r.theirs) return; // only an invite so far
    const before = JSON.stringify(r);
    const now = this.now();
    const give = this.chain(w, r.give);
    const get = this.chain(w, otherCoin(r.give));
    const giveTip = await give.tipHeight();
    const getTip = await get.tipHeight();
    this.tips[r.give] = giveTip;
    this.tips[otherCoin(r.give)] = getTip;
    if (r.problem?.code === 'explorer') delete r.problem;

    // ---- our contract: funding, and whoever spent it
    let ourSpend: Spend | null = null;
    if (r.ours) {
      const ourTxs = await give.addressTxs(r.ours.address);
      const found = findFunding(ourTxs, htlcOutputScript(fromHex(r.ours.contract)), r.ours.funding);
      if (found) {
        if (!r.ours.funding?.height && r.ours.funding?.txid !== found.txid) this.event(r, 'payment-seen', { txid: found.txid });
        if (r.give === 'BTC' && found.value < amountOf(r, 'BTC') && !r.problem) {
          r.problem = { code: 'underpaid', params: { paid: found.value.toString(), expected: r.btc } };
        }
        r.ours.funding = { txid: found.txid, vout: found.vout, value: found.value.toString(), height: found.height };
      }
      if (r.ours.funding) {
        // Only our refund or their claim, which carries the secret, can spend our contract.
        // Anything else a server reports is false and must not stop our refund; every reported
        // spend is examined, so a false one listed first cannot hide the real one.
        const spends = findSpends(ourTxs, r.ours.funding);
        const ourRefund = r.refund ? spends.find((s) => s.tx.txid === r.refund!.txid) : undefined;
        if (ourRefund) {
          r.refund!.height = ourRefund.tx.height;
          ourSpend = ourRefund;
        } else {
          for (const spend of spends) {
            const secret = r.secretHash ? extractSecret(spend.input.scriptSig, fromHex(r.secretHash), spend.input.witness) : null;
            if (secret) {
              ourSpend = spend;
              if (!r.secret) {
                r.secret = toHex(secret);
                this.event(r, 'secret');
              }
              break;
            }
            this.log('warn', `swap ${r.id}: ignoring ${spend.tx.txid}, reported as spending our contract without the secret`);
          }
        }
      }
    }

    // ---- their contract: its funding, and our claim of it
    let theirSpend: Spend | null = null;
    if (r.theirs?.funding) {
      const theirTxs = await get.addressTxs(r.theirs.address);
      const found = findFunding(theirTxs, htlcOutputScript(fromHex(r.theirs.contract)), r.theirs.funding);
      if (found) {
        r.theirs.funding = { ...r.theirs.funding, value: found.value.toString(), height: found.height };
        const spends = findSpends(theirTxs, r.theirs.funding);
        const ourClaim = r.claim ? spends.find((s) => s.tx.txid === r.claim!.txid) : undefined;
        if (ourClaim) {
          r.claim!.height = ourClaim.tx.height;
          theirSpend = ourClaim;
        } else {
          for (const spend of spends) {
            if (now >= r.theirs.locktime) {
              // Their refund (before their lock time only our claim can spend their contract,
              // so an earlier report is false): our claim can never confirm.
              theirSpend = spend;
              if (r.claim) {
                this.event(r, 'claim-failed');
                delete r.claim;
                r.problem = { code: 'claim-failed' };
              }
              break;
            }
            this.log('warn', `swap ${r.id}: ignoring ${spend.tx.txid}, reported as spending their contract before its lock time`);
          }
        }
      }
      if (!r.theirs.verified && found && !r.claim) await this.checkTheirs(r, get, found.value, confirmationsAt(found.height, getTip), now);
    }

    // ---- decisions
    if (r.claim) {
      if (r.claim.height > 0) {
        r.status = 'completed';
        this.event(r, 'completed');
        this.deps.notice({ kind: 'confirmed', code: 'swapCompleted', params: { coin: otherCoin(r.give) } });
      } else await this.rebroadcast(get, r.claim);
    } else if (r.refund) {
      if (r.refund.height > 0) {
        r.status = 'refunded';
        this.event(r, 'refunded');
        this.deps.notice({ kind: 'confirmed', code: 'swapRefunded', params: { coin: r.give } });
      } else if (ourSpend && ourSpend.tx.txid !== r.refund.txid) {
        // They claimed before our refund confirmed: the secret is out, so claim theirs instead.
        delete r.refund;
      } else await this.rebroadcast(give, r.refund);
    }

    if (!r.claim && r.status === 'active') {
      const canClaim =
        r.theirs?.verified &&
        !theirSpend &&
        r.secret &&
        // The joiner reveals the secret only while there is time left; the starter claims whenever it can.
        (r.role === 'starter' || r.theirs.locktime - now >= this.timing.claimMargin) &&
        (r.role === 'starter' || !r.problem);
      if (canClaim) await this.claim(r, get, now);
      else if (r.role === 'joiner' && r.theirs?.verified && !r.claim && r.theirs.locktime - now < this.timing.claimMargin && !r.problem) {
        r.problem = { code: 'too-late-to-claim' };
      }
    }

    // Their coins went back to them before we claimed (we were away too long).
    if (r.status === 'active' && theirSpend && !r.claim) {
      if (!r.ours?.funding) r.status = 'cancelled';
      else if (ourSpend && ourSpend.tx.txid !== r.refund?.txid) {
        r.status = 'failed';
        r.problem = { code: 'claim-failed' };
        this.event(r, 'failed');
      }
    }

    // Starter: too late to lock?
    if (r.role === 'starter' && r.status === 'active' && !r.ours && r.theirs?.verified && r.theirs.locktime - now < this.timing.starterMinRemaining) {
      r.problem = { code: 'too-late-to-lock' };
      r.status = 'cancelled';
      this.event(r, 'cancelled');
    }

    // Refund our coins once their lock time has passed and nobody claimed them.
    const mayRefund = r.role === 'starter' ? !r.secret : !r.claim || r.problem?.code === 'claim-failed';
    if (r.status === 'active' && r.ours?.funding && !ourSpend && !r.refund && mayRefund && refundOpen(r.ours.locktime, r.give, now, this.timing)) {
      await this.refund(r, give);
    }
    // A cancelled Bitcoin contract that was never paid: done once its lock time has passed.
    if (r.status === 'active' && r.ours && !r.ours.funding && r.problem && refundOpen(r.ours.locktime, r.give, now, this.timing)) r.status = 'cancelled';

    if (JSON.stringify(r) !== before) this.save(w, r);
  }

  /** Checks the other side's contract; marks it verified when everything holds. */
  private async checkTheirs(r: SwapRecord, chain: SwapChain, value: bigint, confirmations: number, now: number): Promise<void> {
    const theirs = r.theirs!;
    const coin = theirs.coin;
    const result = checkContract({
      contract: fromHex(theirs.contract),
      value,
      confirmations,
      coin,
      ourPkh: pkhOf(r.getKey),
      amount: amountOf(r, coin),
      secretHash: r.secretHash ? fromHex(r.secretHash) : undefined,
      // The joiner's contract must have 36–72 hours left; the starter's must end before ours.
      locktimeMin: r.role === 'starter' ? now + this.timing.starterMinRemaining : now + this.timing.claimMargin,
      locktimeMax: r.role === 'starter' ? now + Math.round(this.timing.joinerLock * 1.5) : r.ours!.locktime,
    });
    const serious = result.problems.filter((p) => p !== 'unconfirmed');
    if (serious.length > 0) {
      if (r.problem?.code !== 'their-contract-invalid') {
        r.problem = { code: 'their-contract-invalid', params: { reasons: serious.join(',') } };
        this.event(r, 'their-lock-invalid', { reasons: serious.join(',') });
      }
      if (r.role === 'starter') r.status = 'cancelled';
      return;
    }
    if (result.problems.length > 0) return; // waiting for confirmations
    const verdict = await chain.verifyFunding({ address: theirs.address, txid: theirs.funding!.txid, vout: theirs.funding!.vout, value, height: theirs.funding!.height });
    if (!verdict.ok) {
      if (coin === 'LBC' && (verdict.reason === 'single-server' || verdict.reason === 'bad-chain' || verdict.reason === 'disagreement')) {
        // Time does not fix this: say so, and keep trying (another hub, or the user's own node, may do).
        if (r.problem?.code !== 'lbc-unverified') {
          r.problem = { code: 'lbc-unverified', params: { detail: (verdict.detail ?? verdict.reason).slice(0, 200) } };
          this.event(r, 'their-lock-unverified', { reason: verdict.reason });
        }
      } else this.log('info', `swap ${r.id}: their funding could not be verified yet (${verdict.reason}${verdict.detail ? `: ${verdict.detail}` : ''})`);
      return;
    }
    if (r.problem?.code === 'lbc-unverified') delete r.problem;
    theirs.verified = true;
    this.event(r, 'their-lock-confirmed');
    if (r.role === 'starter') this.deps.notice({ kind: 'swap', code: 'swapReadyToLock', params: { coin: r.give } });
  }

  private destinationScript(r: SwapRecord, coin: SwapCoin, address: string): Uint8Array {
    return addressToScript(address, coin === 'LBC' ? lbcAddressParams(r.network) : BITCOIN_NETWORKS[r.network]);
  }

  private async claim(r: SwapRecord, chain: SwapChain, now: number): Promise<void> {
    const theirs = r.theirs!;
    const coin = theirs.coin;
    const value = BigInt(theirs.funding!.value);
    const rate = this.boundedFeeRate(r, coin, await chain.feeRate(), value);
    const { tx } = this.spend(r, coin, {
      contract: fromHex(theirs.contract),
      output: { txid: theirs.funding!.txid, vout: theirs.funding!.vout, value },
      privateKey: fromHex(r.getKey),
      destination: this.destinationScript(r, coin, r.receiveTo),
      feeRate: rate,
      dust: SWAP_CHAINS[coin].dust,
      path: { kind: 'redeem', secret: fromHex(r.secret!) },
    });
    const txid = await chain.broadcast(tx);
    r.claim = { txid, hex: tx.toHex(), height: 0, sentAt: now * 1000 };
    this.lastBroadcast.set(txid, Date.now());
    this.event(r, 'claim-sent', { txid });
  }

  private async refund(r: SwapRecord, chain: SwapChain): Promise<void> {
    const ours = r.ours!;
    const rate = this.boundedFeeRate(r, r.give, await chain.feeRate(), BigInt(ours.funding!.value));
    const { tx } = this.spend(r, r.give, {
      contract: fromHex(ours.contract),
      output: { txid: ours.funding!.txid, vout: ours.funding!.vout, value: BigInt(ours.funding!.value) },
      privateKey: fromHex(r.giveKey),
      destination: this.destinationScript(r, r.give, r.refundTo),
      feeRate: rate,
      dust: SWAP_CHAINS[r.give].dust,
      path: { kind: 'refund' },
    });
    try {
      const txid = await chain.broadcast(tx);
      r.refund = { txid, hex: tx.toHex(), height: 0, sentAt: Date.now() };
      this.lastBroadcast.set(txid, Date.now());
      this.event(r, 'refund-sent', { txid });
    } catch (err) {
      // Most often the chain's clock has not passed the lock time yet; try again next round.
      this.log('info', `swap ${r.id}: refund not accepted yet: ${(err as Error).message}`);
    }
  }

  /** The estimate, bounded: an absurd rate must not burn the amount. */
  private boundedFeeRate(r: SwapRecord, coin: SwapCoin, rate: number, value: bigint): number {
    const byShare = Math.floor((Number(value) * MAX_FEE_SHARE) / SPEND_SIZE);
    const bounded = Math.max(1, Math.min(rate, MAX_FEE_RATE[coin], byShare));
    if (bounded !== rate) this.log('warn', `swap ${r.id}: ${coin} fee rate ${rate}/byte bounded to ${bounded}/byte`);
    return bounded;
  }

  /** Builds a claim or refund; the fee is capped so the output stays above dust. */
  private spend(r: SwapRecord, coin: SwapCoin, params: Parameters<typeof buildHtlcSpend>[0]) {
    try {
      return buildHtlcSpend(params);
    } catch (err) {
      if (!/too small to pay the network fee/.test((err as Error).message)) throw err;
      // Fees spiked: pay what the amount allows rather than not claiming at all.
      const maxRate = Math.floor(Number(params.output.value - params.dust) / SPEND_SIZE);
      if (maxRate < 1) throw err;
      this.log('warn', `swap ${r.id}: ${coin} fee capped at ${maxRate}/byte`);
      return buildHtlcSpend({ ...params, feeRate: maxRate });
    }
  }

  private async rebroadcast(chain: SwapChain, spend: { txid: string; hex: string }): Promise<void> {
    const last = this.lastBroadcast.get(spend.txid) ?? 0;
    if (Date.now() - last < REBROADCAST_MS) return;
    this.lastBroadcast.set(spend.txid, Date.now());
    await chain.broadcast(Transaction.fromHex(spend.hex)).catch((err: Error) => this.log('info', `rebroadcast ${spend.txid}: ${err.message}`));
  }
}

/** LBC address formats of a network (the wallet's own). */
function lbcAddressParams(network: NetworkName) {
  return getNetwork(network);
}

/** Swap amounts must cover the network fees, and stay under the cap while swaps are new. */
export function checkSwapAmounts(network: NetworkName, lbc: bigint, btc: bigint): void {
  if (lbc < MIN_SWAP_LBC || btc < MIN_SWAP_BTC) throw new UserError('swapAmountTooSmall', { lbc: Number(MIN_SWAP_LBC / 100_000_000n), btc: Number(MIN_SWAP_BTC) / 1e8 });
  if (network === 'mainnet' && btc > MAX_SWAP_BTC) throw new UserError('swapAmountTooLarge', { btc: Number(MAX_SWAP_BTC) / 1e8 });
}

/** A Bitcoin address of the network's Bitcoin counterpart, trimmed; throws a user-readable error. */
export function checkBtcAddress(network: NetworkName, address: string): string {
  const a = address.trim();
  try {
    decodeAddress(a, BITCOIN_NETWORKS[network]);
  } catch (err) {
    throw new UserError('swapBtcAddressInvalid', { detail: (err as Error).message });
  }
  return a;
}
