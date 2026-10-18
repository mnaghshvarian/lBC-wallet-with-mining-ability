import { Emitter, TaskQueue, mapLimit } from '../util/emitter.js';
import type { ChainBackend, ChainTip, HistoryItem } from '../net/backend.js';
import type { AddressDeriver } from '../keys/hd.js';
import { CHAIN_CHANGE, CHAIN_RECEIVE } from '../keys/hd.js';
import type { NetworkParams } from '../networks.js';
import { DEFAULT_FEE_PER_BYTE, DUST_THRESHOLD } from '../networks.js';
import { Transaction } from '../tx/transaction.js';
import { addressToScript, scriptToAddress } from '../address.js';
import { classifyOutput } from '../script/script.js';
import { assembleTransaction, selectAll, selectCoins, signTransaction, type UnsignedPayment, type Utxo } from '../tx/builder.js';
import { verifyTransactionInclusion } from './verify.js';
import type {
  AddressRecord,
  Balance,
  SyncInfo,
  TxDetail,
  TxInputView,
  TxOutputView,
  TxRecord,
  TxSummary,
  TxType,
  UtxoKind,
  WalletState,
  WalletUtxo,
} from './types.js';

export interface WalletEngineOptions {
  network: NetworkParams;
  deriver: AddressDeriver;
  backend: ChainBackend;
  state: WalletState;
  gap?: { receive: number; change: number };
  /** Called (debounced) whenever state changes and should be saved. */
  persist: (state: WalletState) => void;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
  now?: () => number;
}

type EngineEvents = {
  changed: void;
  sync: SyncInfo;
  notice: { kind: 'received' | 'confirmed' | 'dropped'; txid: string; amount?: bigint; type?: TxType };
};

export interface PaymentDraft {
  id: string;
  payment: UnsignedPayment;
  recipients: { address: string; value: bigint }[];
  fee: bigint;
  feePerByte: number;
  change: bigint;
  changeAddress: string | null;
  /** Amount leaving the wallet (recipients + fee). */
  total: bigint;
  size: number;
  kind: 'payment' | 'unlock-supports' | 'sweep';
}

export type KeyProvider = (chain: number, index: number) => Uint8Array;

const PENDING_EXPIRY_MS = 3 * 60 * 60 * 1000;
/** Blocks this close to the tip may still be reorganised away. */
const REORG_GUARD = 10;
/** SPV checks per transaction and height before it is reported as unverifiable. */
const MAX_VERIFY_ATTEMPTS = 3;

/**
 * Keeps a wallet's view of the chain up to date and builds transactions.
 *
 * Sync follows the Electrum model: subscribe to every derived address, compare
 * the server's status hash with the stored one, refetch history only where it
 * changed, and extend each chain until `gap` consecutive unused addresses
 * exist. Transaction contents are integrity-checked (txid must match) and
 * confirmations are SPV-verified against PoW-checked headers.
 */
export class WalletEngine extends Emitter<EngineEvents> {
  readonly network: NetworkParams;
  private readonly deriver: AddressDeriver;
  private backend: ChainBackend;
  readonly state: WalletState;
  private readonly gap: { receive: number; change: number };
  private readonly byAddress = new Map<string, AddressRecord>();
  private readonly parsed = new Map<string, Transaction>();
  private readonly headerCache = new Map<number, string>();
  private readonly queue = new TaskQueue();
  private readonly subscribed = new Set<string>();
  /** SPV attempts per txid@height: a reorg can make a proof or a cached header stale, so failures are retried. */
  private readonly verifyAttempts = new Map<string, number>();
  private unsubscribers: (() => void)[] = [];
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private draftSeq = 0;
  private drafts = new Map<string, PaymentDraft>();
  syncInfo: SyncInfo = { state: 'idle', addresses: 0, transactions: 0 };

  constructor(private readonly options: WalletEngineOptions) {
    super();
    this.network = options.network;
    this.deriver = options.deriver;
    this.backend = options.backend;
    this.state = options.state;
    this.gap = options.gap ?? { receive: 20, change: 10 };
    for (const rec of this.state.addresses) this.byAddress.set(rec.address, rec);
    this.ensureGap();
    this.syncInfo = { ...this.syncInfo, addresses: this.state.addresses.length, transactions: Object.keys(this.state.txs).length, lastSyncAt: this.state.lastSyncAt };
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private log(level: 'info' | 'warn' | 'error', message: string) {
    this.options.log?.(level, message);
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.attach();
    this.setSync({ state: 'connecting' });
    try {
      await this.backend.start();
      const tip = await this.backend.getTip();
      this.state.tip = { height: tip.height, header: tip.header };
    } catch (err) {
      this.setSync({ state: 'offline', error: (err as Error).message });
      throw err;
    }
    await this.fullSync();
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    await this.backend.stop();
    this.flush();
  }

  /** Swaps the network backend (e.g. user switched hub or to a full node). */
  async replaceBackend(backend: ChainBackend): Promise<void> {
    const wasRunning = this.running;
    if (wasRunning) await this.stop();
    this.backend = backend;
    this.subscribed.clear();
    if (wasRunning) await this.start();
  }

  getBackend(): ChainBackend {
    return this.backend;
  }

  private attach() {
    this.unsubscribers.push(
      this.backend.on('tip', (tip) => this.onTip(tip)),
      this.backend.on('addressStatus', ({ address, status }) => void this.onAddressStatus(address, status)),
      this.backend.on('reconnected', () => {
        this.subscribed.clear();
        void this.fullSync().catch((err) => this.log('warn', `resync failed: ${(err as Error).message}`));
      }),
      this.backend.on('status', (s) => {
        if (!s.connected && this.syncInfo.state !== 'idle') this.setSync({ state: 'offline', error: s.error });
        else if (s.connected && this.syncInfo.state === 'offline') this.setSync({ state: 'synced', error: undefined });
      }),
    );
  }

  private setSync(patch: Partial<SyncInfo>) {
    this.syncInfo = { ...this.syncInfo, ...patch, addresses: this.state.addresses.length, transactions: Object.keys(this.state.txs).length };
    this.emit('sync', this.syncInfo);
  }

  private changed() {
    this.emit('changed', undefined);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.flush(), 1000);
  }

  /** Call after mutating `state` directly (e.g. contacts) so it is persisted and observers refresh. */
  stateChanged(): void {
    this.changed();
  }

  /** Writes state immediately. */
  flush() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    this.options.persist(this.state);
  }

  // -------------------------------------------------------------------------
  // addresses
  // -------------------------------------------------------------------------

  private chainRecords(chain: number): AddressRecord[] {
    return this.state.addresses.filter((a) => a.chain === chain).sort((a, b) => a.index - b.index);
  }

  /** Indices that have on-chain history or are referenced by an unconfirmed tx of ours. */
  private usedSet(): Set<string> {
    const used = new Set<string>();
    for (const rec of this.state.addresses) if (rec.history.length > 0) used.add(rec.address);
    for (const p of Object.values(this.state.pending)) {
      const tx = this.parse(p.txid, p.hex);
      for (const o of tx.outputs) {
        const a = scriptToAddress(o.script, this.network);
        if (a && this.byAddress.has(a)) used.add(a);
      }
    }
    return used;
  }

  /** Derives addresses so each chain ends with `gap` unused ones. Returns newly created records. */
  private ensureGap(): AddressRecord[] {
    const created: AddressRecord[] = [];
    const used = this.usedSet();
    for (const [chain, gap] of [
      [CHAIN_RECEIVE, this.gap.receive],
      [CHAIN_CHANGE, this.gap.change],
    ] as const) {
      const recs = this.chainRecords(chain);
      let lastUsed = -1;
      for (const r of recs) if (used.has(r.address)) lastUsed = Math.max(lastUsed, r.index);
      let target = lastUsed + 1 + gap;
      if (chain === CHAIN_RECEIVE) target = Math.max(target, this.state.issuedReceive + 1);
      for (let i = recs.length; i < target; i++) {
        const { address } = this.deriver.derive(chain, i);
        const rec: AddressRecord = { address, chain, index: i, status: null, history: [] };
        this.state.addresses.push(rec);
        this.byAddress.set(address, rec);
        created.push(rec);
      }
    }
    return created;
  }

  isMine(address: string): boolean {
    return this.byAddress.has(address);
  }

  addressInfo(address: string): AddressRecord | undefined {
    return this.byAddress.get(address);
  }

  private lastUsedIndex(chain: number, used: Set<string>): number {
    let last = -1;
    for (const r of this.chainRecords(chain)) if (used.has(r.address)) last = Math.max(last, r.index);
    return last;
  }

  private currentReceive(used: Set<string>): AddressRecord {
    const recs = this.chainRecords(CHAIN_RECEIVE);
    return recs.find((r) => r.index >= this.state.issuedReceive && !used.has(r.address)) ?? recs.find((r) => !used.has(r.address)) ?? recs[recs.length - 1]!;
  }

  /** Current receiving address: the first unused one at or after the last address handed out. */
  getReceiveAddress(): string {
    return this.currentReceive(this.usedSet()).address;
  }

  /**
   * Moves to a fresh receiving address. Never goes past `gap` unused addresses
   * after the last used one, so restoring from the seed always finds payments.
   */
  newReceiveAddress(): { address: string; atLimit: boolean } {
    const used = this.usedSet();
    const current = this.currentReceive(used).index;
    const limit = this.lastUsedIndex(CHAIN_RECEIVE, used) + this.gap.receive;
    const next = Math.min(current + 1, limit);
    this.state.issuedReceive = next;
    this.ensureGap();
    this.changed();
    void this.subscribeNew();
    return { address: this.getReceiveAddress(), atLimit: next === current };
  }

  private getChangeAddress(exclude: Set<string> = new Set()): string {
    const used = this.usedSet();
    const rec = this.chainRecords(CHAIN_CHANGE).find((r) => !used.has(r.address) && !exclude.has(r.address));
    if (rec) return rec.address;
    const created = this.ensureGap();
    return (created.find((r) => r.chain === CHAIN_CHANGE) ?? this.chainRecords(CHAIN_CHANGE).at(-1)!).address;
  }

  listAddresses(): { address: string; chain: number; index: number; used: boolean; balance: bigint; txCount: number; label?: string }[] {
    const used = this.usedSet();
    const balances = new Map<string, bigint>();
    for (const u of this.computeUtxos()) balances.set(u.address, (balances.get(u.address) ?? 0n) + u.value);
    return this.state.addresses
      .slice()
      .sort((a, b) => a.chain - b.chain || a.index - b.index)
      .map((r) => ({
        address: r.address,
        chain: r.chain,
        index: r.index,
        used: used.has(r.address),
        balance: balances.get(r.address) ?? 0n,
        txCount: r.history.length,
        label: this.state.labels[r.address],
      }));
  }

  // -------------------------------------------------------------------------
  // sync
  // -------------------------------------------------------------------------

  fullSync(): Promise<void> {
    return this.queue.run(async () => {
      this.setSync({ state: 'syncing', error: undefined });
      try {
        await this.syncLoop(this.state.addresses.map((a) => a.address));
        await this.reconcile();
        this.state.lastSyncAt = this.now();
        this.setSync({ state: 'synced', lastSyncAt: this.state.lastSyncAt });
        this.changed();
      } catch (err) {
        this.setSync({ state: 'error', error: (err as Error).message });
        throw err;
      }
    });
  }

  /** Subscribes `initial` (minus already-subscribed) and keeps extending the gap until stable. */
  private async syncLoop(initial: string[]): Promise<void> {
    let pending = initial.filter((a) => !this.subscribed.has(a));
    for (let round = 0; pending.length > 0 && round < 1000; round++) {
      const statuses = await this.backend.subscribeAddresses(pending);
      pending.forEach((a) => this.subscribed.add(a));
      const changed: { address: string; status: string | null }[] = [];
      pending.forEach((address, i) => {
        const rec = this.byAddress.get(address)!;
        const status = statuses[i] ?? null;
        if (status !== rec.status || (status !== null && rec.history.length === 0)) changed.push({ address, status });
      });
      await mapLimit(changed, 8, async ({ address, status }) => {
        const rec = this.byAddress.get(address)!;
        rec.history = status === null ? [] : await this.backend.getHistory(address);
        rec.status = status;
      });
      if (changed.length) await this.fetchMissing();
      const created = this.ensureGap();
      pending = created.map((r) => r.address).filter((a) => !this.subscribed.has(a));
      this.setSync({});
    }
  }

  private async subscribeNew(): Promise<void> {
    await this.queue.run(async () => {
      try {
        await this.syncLoop(this.state.addresses.map((a) => a.address));
        await this.reconcile();
        this.changed();
      } catch (err) {
        this.log('warn', `subscribe failed: ${(err as Error).message}`);
      }
    });
  }

  private onAddressStatus(address: string, status: string | null): Promise<void> {
    return this.queue.run(async () => {
      const rec = this.byAddress.get(address);
      if (!rec || rec.status === status) return;
      try {
        const before = new Set(Object.keys(this.state.txs));
        rec.history = status === null ? [] : await this.backend.getHistory(address);
        rec.status = status;
        await this.fetchMissing();
        await this.syncLoop(this.ensureGap().map((r) => r.address));
        await this.reconcile();
        for (const txid of Object.keys(this.state.txs)) {
          if (!before.has(txid) && !this.state.pending[txid]) {
            const s = this.summarize(this.state.txs[txid]!);
            if (s.amount > 0n) this.emit('notice', { kind: 'received', txid, amount: s.amount, type: s.type });
          }
        }
        this.changed();
      } catch (err) {
        this.log('warn', `update for ${address} failed: ${(err as Error).message}`);
      }
    });
  }

  private onTip(tip: ChainTip) {
    const prev = this.state.tip;
    this.state.tip = { height: tip.height, header: tip.header };
    if (!prev || prev.header !== tip.header) {
      // Blocks near the tip can still be replaced by a reorg; don't trust their cached headers.
      for (const h of this.headerCache.keys()) if (h > tip.height - REORG_GUARD) this.headerCache.delete(h);
      void this.queue.run(() => this.reconcile().catch(() => undefined)).then(() => this.changed());
    }
  }

  /** Height recorded in histories for a txid (max across addresses), 0 if only in mempool. */
  private historyHeights(): Map<string, number> {
    const heights = new Map<string, number>();
    for (const rec of this.state.addresses) {
      for (const h of rec.history) heights.set(h.txid, Math.max(heights.get(h.txid) ?? 0, normalizeHeight(h)));
    }
    return heights;
  }

  private async fetchMissing(): Promise<void> {
    const heights = this.historyHeights();
    const missing: string[] = [];
    for (const [txid, height] of heights) {
      const rec = this.state.txs[txid];
      if (!rec) missing.push(txid);
      else if (rec.height !== height) {
        rec.height = height;
        rec.verified = undefined;
        rec.merkle = undefined;
        if (height === 0) rec.blockTime = undefined;
      }
    }
    if (missing.length === 0) return;
    const fetched = await this.backend.getTransactions(missing);
    for (const txid of missing) {
      const f = fetched.get(txid);
      if (!f) {
        this.log('warn', `server did not return transaction ${txid}`);
        continue;
      }
      let tx: Transaction;
      try {
        tx = Transaction.fromHex(f.hex);
      } catch {
        this.log('error', `server returned an unparseable transaction for ${txid}`);
        continue;
      }
      if (tx.txid !== txid) {
        this.log('error', `server returned the wrong transaction for ${txid}`);
        continue;
      }
      this.parsed.set(txid, tx);
      const height = heights.get(txid) ?? 0;
      this.state.txs[txid] = {
        txid,
        hex: f.hex,
        height,
        firstSeen: this.state.pending[txid]?.createdAt ?? this.now(),
        merkle: height > 0 && f.height === height ? f.merkle : undefined,
      };
    }
  }

  /** Prunes stale data, settles pending broadcasts and verifies confirmations. */
  private async reconcile(): Promise<void> {
    const heights = this.historyHeights();
    // transactions no longer in any history (reorged out / replaced) are dropped,
    // except our own recent broadcasts which hubs may not have indexed yet.
    for (const txid of Object.keys(this.state.txs)) {
      if (heights.has(txid)) continue;
      const pending = this.state.pending[txid];
      if (pending && this.now() - pending.createdAt < PENDING_EXPIRY_MS) continue;
      if (pending) {
        const still = await this.backend.getTransactions([txid]).catch(() => new Map());
        if (still.has(txid)) continue;
        this.emit('notice', { kind: 'dropped', txid });
        delete this.state.pending[txid];
      }
      delete this.state.txs[txid];
      this.parsed.delete(txid);
    }
    for (const txid of Object.keys(this.state.pending)) {
      if (heights.has(txid)) delete this.state.pending[txid];
      else if (!this.state.txs[txid]) {
        this.state.txs[txid] = { txid, hex: this.state.pending[txid]!.hex, height: 0, firstSeen: this.state.pending[txid]!.createdAt };
      }
    }
    await this.verifyConfirmations();
  }

  private async header(height: number): Promise<string> {
    const hit = this.headerCache.get(height);
    if (hit) return hit;
    const [h] = await this.backend.getHeaders(height, 1);
    if (!h) throw new Error(`no header at ${height}`);
    this.headerCache.set(height, h);
    return h;
  }

  private async verifyConfirmations(): Promise<void> {
    const attemptKey = (t: TxRecord) => `${t.txid}@${t.height}`;
    const todo = Object.values(this.state.txs).filter(
      (t) => t.height > 0 && (t.verified !== true || t.blockTime === undefined) && (this.verifyAttempts.get(attemptKey(t)) ?? 0) < MAX_VERIFY_ATTEMPTS,
    );
    if (todo.length === 0) return;
    for (const t of todo) this.verifyAttempts.set(attemptKey(t), (this.verifyAttempts.get(attemptKey(t)) ?? 0) + 1);
    if (this.backend.untrusted) {
      const needProof = todo.filter((t) => !t.merkle).map((t) => t.txid);
      if (needProof.length) {
        const fetched = await this.backend.getTransactions(needProof);
        for (const txid of needProof) {
          const f = fetched.get(txid);
          const rec = this.state.txs[txid];
          if (f && rec && f.merkle && f.height === rec.height) rec.merkle = f.merkle;
        }
      }
    }
    await mapLimit(todo, 8, async (rec) => {
      try {
        const header = await this.header(rec.height);
        if (!this.backend.untrusted) {
          rec.verified = true;
          rec.blockTime = readTimestamp(header);
          return;
        }
        if (!rec.merkle) return;
        const result = verifyTransactionInclusion(rec.txid, rec.merkle, header, rec.height, this.network, this.state.tip);
        rec.verified = result.ok;
        rec.blockTime = result.blockTime;
        if (!result.ok) {
          // Fetch a fresh proof and header next time in case the block at this height was replaced.
          rec.merkle = undefined;
          this.headerCache.delete(rec.height);
          const retry = (this.verifyAttempts.get(attemptKey(rec)) ?? 0) < MAX_VERIFY_ATTEMPTS;
          this.log('warn', `SPV verification failed for ${rec.txid}: ${result.reason}${retry ? ' (will retry)' : ''}`);
        }
      } catch (err) {
        this.log('warn', `could not verify ${rec.txid}: ${(err as Error).message}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // views
  // -------------------------------------------------------------------------

  private parse(txid: string, hex: string): Transaction {
    let tx = this.parsed.get(txid);
    if (!tx) {
      tx = Transaction.fromHex(hex);
      this.parsed.set(txid, tx);
    }
    return tx;
  }

  get tipHeight(): number {
    return this.state.tip?.height ?? 0;
  }

  /** The chain backend the wallet syncs from (atomic swaps read contracts through it). */
  get chain(): ChainBackend {
    return this.backend;
  }

  private confirmations(height: number): number {
    return height > 0 && this.tipHeight >= height ? this.tipHeight - height + 1 : 0;
  }

  /** All wallet-owned unspent outputs, including locked supports/claims and immature coinbases. */
  computeUtxos(): WalletUtxo[] {
    const spent = new Set<string>();
    const records = Object.values(this.state.txs);
    for (const rec of records) {
      const tx = this.parse(rec.txid, rec.hex);
      if (!tx.isCoinbase()) for (const i of tx.inputs) spent.add(`${i.txid}:${i.vout}`);
    }
    const out: WalletUtxo[] = [];
    for (const rec of records) {
      const tx = this.parse(rec.txid, rec.hex);
      const coinbase = tx.isCoinbase();
      const trusted = rec.height > 0 || this.isOwnTransaction(tx);
      tx.outputs.forEach((o, vout) => {
        if (spent.has(`${rec.txid}:${vout}`)) return;
        const address = scriptToAddress(o.script, this.network);
        const owner = address ? this.byAddress.get(address) : undefined;
        if (!owner) return;
        const c = classifyOutput(o.script);
        const kind: UtxoKind = c.claim ? c.claim.kind : c.type === 'p2pkh' ? 'standard' : 'other';
        const confirmations = this.confirmations(rec.height);
        out.push({
          txid: rec.txid,
          vout,
          value: o.value,
          script: o.script,
          address: address!,
          chain: owner.chain,
          index: owner.index,
          height: rec.height,
          confirmations,
          kind,
          coinbase,
          mature: !coinbase || confirmations >= this.network.coinbaseMaturity,
          trusted,
          claimName: c.claim?.name,
          claimId: c.claim?.claimId,
        });
      });
    }
    return out;
  }

  private isOwnTransaction(tx: Transaction): boolean {
    if (tx.isCoinbase() || tx.inputs.length === 0) return false;
    return tx.inputs.every((i) => {
      const prev = this.state.txs[i.txid];
      if (!prev) return false;
      const o = this.parse(prev.txid, prev.hex).outputs[i.vout];
      const a = o ? scriptToAddress(o.script, this.network) : null;
      return !!a && this.byAddress.has(a);
    });
  }

  getBalance(): Balance {
    const b: Balance = { available: 0n, pending: 0n, immature: 0n, supports: 0n, claims: 0n, total: 0n };
    for (const u of this.computeUtxos()) {
      b.total += u.value;
      if (u.kind === 'support') b.supports += u.value;
      else if (u.kind === 'claim' || u.kind === 'update') b.claims += u.value;
      else if (u.kind !== 'standard') continue;
      else if (!u.mature) b.immature += u.value;
      else if (u.height > 0 || u.trusted) b.available += u.value;
      else b.pending += u.value;
    }
    return b;
  }

  /** Outputs that can be spent by a normal payment right now. */
  spendableUtxos(): WalletUtxo[] {
    return this.computeUtxos().filter((u) => u.kind === 'standard' && u.mature && (u.height > 0 || u.trusted));
  }

  private outputValue(txid: string, vout: number): { value: bigint; address: string | null; kind: UtxoKind } | null {
    const rec = this.state.txs[txid];
    if (!rec) return null;
    const o = this.parse(rec.txid, rec.hex).outputs[vout];
    if (!o) return null;
    const c = classifyOutput(o.script);
    return { value: o.value, address: scriptToAddress(o.script, this.network), kind: c.claim ? c.claim.kind : c.type === 'p2pkh' ? 'standard' : 'other' };
  }

  private summarize(rec: TxRecord): TxSummary {
    const tx = this.parse(rec.txid, rec.hex);
    const coinbase = tx.isCoinbase();
    let spentFromUs = 0n;
    let ourInputs = 0;
    let inputsKnown = !coinbase;
    let totalIn = 0n;
    let spentLocked = false;
    for (const i of tx.inputs) {
      if (coinbase) break;
      const prev = this.outputValue(i.txid, i.vout);
      if (!prev) {
        inputsKnown = false;
        continue;
      }
      totalIn += prev.value;
      if (prev.address && this.byAddress.has(prev.address)) {
        ourInputs++;
        spentFromUs += prev.value;
        if (prev.kind !== 'standard') spentLocked = true;
      }
    }
    let receivedByUs = 0n;
    let external: { address: string | null; kind: UtxoKind; value: bigint } | null = null;
    let externalCount = 0;
    let ownLocked: UtxoKind | null = null;
    let receivedSupport = false;
    for (const o of tx.outputs) {
      const address = scriptToAddress(o.script, this.network);
      const c = classifyOutput(o.script);
      const kind: UtxoKind = c.claim ? c.claim.kind : c.type === 'p2pkh' ? 'standard' : 'other';
      if (address && this.byAddress.has(address)) {
        receivedByUs += o.value;
        if (kind === 'support') receivedSupport = true;
        if (kind !== 'standard') ownLocked = kind;
      } else if (c.type !== 'nulldata') {
        externalCount++;
        if (!external) external = { address, kind, value: o.value };
      }
    }
    const totalOut = tx.totalOutput();
    const fee = !coinbase && inputsKnown && ourInputs === tx.inputs.length ? totalIn - totalOut : null;
    let type: TxType;
    if (coinbase) type = 'mining';
    else if (ourInputs === 0) type = receivedSupport ? 'tip-in' : 'receive';
    else if (externalCount === 0) type = spentLocked ? 'unlock' : ownLocked === 'support' ? 'support' : ownLocked ? 'claim' : 'self';
    else type = external?.kind === 'support' ? 'tip-out' : external && external.kind !== 'standard' && external.kind !== 'other' ? 'claim' : 'send';
    const amount = receivedByUs - spentFromUs;
    return {
      txid: rec.txid,
      height: rec.height,
      confirmations: this.confirmations(rec.height),
      time: rec.blockTime ?? Math.floor(rec.firstSeen / 1000),
      type,
      amount,
      fee,
      counterparty: ourInputs > 0 ? (external?.address ?? null) : null,
      label: this.state.labels[rec.txid],
      status: rec.height > 0 ? 'confirmed' : 'pending',
      verified: rec.verified,
    };
  }

  getTransactions(): TxSummary[] {
    return Object.values(this.state.txs)
      .map((r) => this.summarize(r))
      .sort((a, b) => {
        // unconfirmed first, then newest block first
        if (a.height === 0 && b.height !== 0) return -1;
        if (b.height === 0 && a.height !== 0) return 1;
        return b.height - a.height || b.time - a.time;
      });
  }

  getTransaction(txid: string): TxDetail | null {
    const rec = this.state.txs[txid];
    if (!rec) return null;
    const tx = this.parse(rec.txid, rec.hex);
    const summary = this.summarize(rec);
    const inputs: TxInputView[] = tx.isCoinbase()
      ? []
      : tx.inputs.map((i) => {
          const prev = this.outputValue(i.txid, i.vout);
          return { txid: i.txid, vout: i.vout, address: prev?.address ?? null, value: prev?.value ?? null, mine: !!prev?.address && this.byAddress.has(prev.address) };
        });
    const outputs: TxOutputView[] = tx.outputs.map((o, vout) => {
      const address = scriptToAddress(o.script, this.network);
      const c = classifyOutput(o.script);
      const owner = address ? this.byAddress.get(address) : undefined;
      return {
        vout,
        address,
        value: o.value,
        mine: !!owner,
        change: owner?.chain === CHAIN_CHANGE,
        kind: c.claim ? c.claim.kind : c.type === 'p2pkh' ? 'standard' : 'other',
        claimName: c.claim?.name,
        claimId: c.claim?.claimId,
      };
    });
    return { ...summary, inputs, outputs, size: rec.hex.length / 2, hex: rec.hex };
  }

  setLabel(key: string, label: string) {
    if (label.trim()) this.state.labels[key] = label.trim().slice(0, 200);
    else delete this.state.labels[key];
    this.changed();
  }

  // -------------------------------------------------------------------------
  // spending
  // -------------------------------------------------------------------------

  private toBuilderUtxo(u: WalletUtxo): Utxo {
    return { txid: u.txid, vout: u.vout, value: u.value, script: u.script, address: u.address, height: u.height };
  }

  private register(draft: Omit<PaymentDraft, 'id'>): PaymentDraft {
    const id = `d${++this.draftSeq}`;
    const full = { ...draft, id };
    this.drafts.set(id, full);
    return full;
  }

  getDraft(id: string): PaymentDraft | undefined {
    return this.drafts.get(id);
  }

  /** Builds an unsigned payment. `amount: 'max'` sends the whole spendable balance. */
  createPayment(params: { address: string; amount: bigint | 'max'; feePerByte?: number }): PaymentDraft {
    const feePerByte = validateFeeRate(params.feePerByte ?? DEFAULT_FEE_PER_BYTE);
    const script = addressToScript(params.address, this.network);
    const utxos = this.spendableUtxos().map((u) => this.toBuilderUtxo(u));
    if (params.amount === 'max') {
      const r = selectAll(utxos, script, feePerByte);
      const payment = assembleTransaction(utxos, [{ script, value: r.value }]);
      return this.register({ payment, recipients: [{ address: params.address, value: r.value }], fee: r.fee, feePerByte, change: 0n, changeAddress: null, total: r.value + r.fee, size: r.size, kind: 'payment' });
    }
    if (params.amount < DUST_THRESHOLD) throw new Error(`Minimum amount is ${Number(DUST_THRESHOLD) / 1e8} LBC`);
    const changeAddress = this.getChangeAddress(new Set([params.address]));
    const changeScript = addressToScript(changeAddress, this.network);
    const sel = selectCoins(utxos, [{ script, value: params.amount }], changeScript, feePerByte);
    const payment = assembleTransaction(sel.inputs, [{ script, value: params.amount }], sel.change > 0n ? { script: changeScript, value: sel.change } : undefined);
    return this.register({
      payment,
      recipients: [{ address: params.address, value: params.amount }],
      fee: sel.fee,
      feePerByte,
      change: sel.change,
      changeAddress: sel.change > 0n ? changeAddress : null,
      total: params.amount + sel.fee,
      size: sel.size,
      kind: 'payment',
    });
  }

  /** Spends every confirmed support/tip output back to the wallet ("unlock tips"). */
  createUnlockSupports(feePerByte = DEFAULT_FEE_PER_BYTE): PaymentDraft {
    const rate = validateFeeRate(feePerByte);
    const supports = this.computeUtxos().filter((u) => u.kind === 'support' && u.height > 0);
    if (supports.length === 0) throw new Error('There are no confirmed tips or supports to unlock');
    const destination = this.getChangeAddress();
    const script = addressToScript(destination, this.network);
    const utxos = supports.map((u) => this.toBuilderUtxo(u));
    const r = selectAll(utxos, script, rate);
    const payment = assembleTransaction(utxos, [{ script, value: r.value }]);
    return this.register({ payment, recipients: [{ address: destination, value: r.value }], fee: r.fee, feePerByte: rate, change: 0n, changeAddress: null, total: r.fee, size: r.size, kind: 'unlock-supports' });
  }

  /** Signs a draft. `keys(chain, index)` must return a fresh copy of the private key (it is wiped). */
  sign(draft: PaymentDraft, keys: KeyProvider): Transaction {
    return signTransaction(draft.payment, (utxo) => {
      const rec = this.byAddress.get(utxo.address);
      if (!rec) throw new Error(`no key for ${utxo.address}`);
      return keys(rec.chain, rec.index);
    });
  }

  /** Broadcasts a signed transaction and records it as pending immediately. */
  async broadcast(tx: Transaction, label?: string): Promise<string> {
    const hex = tx.toHex();
    const txid = tx.txid;
    const returned = await this.backend.broadcast(hex);
    if (typeof returned === 'string' && returned.length === 64 && returned !== txid) {
      this.log('warn', `server reported txid ${returned}, expected ${txid}`);
    }
    await this.queue.run(async () => {
      const now = this.now();
      this.state.pending[txid] = { txid, hex, createdAt: now };
      this.state.txs[txid] = this.state.txs[txid] ?? { txid, hex, height: 0, firstSeen: now };
      this.parsed.set(txid, tx);
      if (label) this.state.labels[txid] = label;
      for (const d of this.drafts.values()) if (d.payment.tx.inputs.some((i) => tx.inputs.some((j) => j.txid === i.txid && j.vout === i.vout))) this.drafts.delete(d.id);
      this.ensureGap();
      this.flush();
    });
    this.emit('changed', undefined);
    void this.subscribeNew();
    return txid;
  }
}

function normalizeHeight(h: HistoryItem): number {
  return h.height > 0 ? h.height : 0;
}

function readTimestamp(headerHex: string): number {
  const b = (i: number) => parseInt(headerHex.slice(i * 2, i * 2 + 2), 16);
  return (b(100) | (b(101) << 8) | (b(102) << 16) | (b(103) << 24)) >>> 0;
}

export function validateFeeRate(feePerByte: number): number {
  if (!Number.isFinite(feePerByte) || feePerByte < 1) throw new Error('Fee rate must be at least 1 dewie/byte');
  if (feePerByte > 10_000) throw new Error('Fee rate is unreasonably high (max 10,000 dewies/byte)');
  return feePerByte;
}
