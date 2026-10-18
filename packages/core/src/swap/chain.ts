/**
 * The two chains of a swap behind one small interface: LBC through the
 * wallet's hub or node, Bitcoin through an Esplora server.
 */
import { fromHex } from '../encoding/bytes.js';
import type { ChainBackend } from '../net/backend.js';
import type { EsploraClient, EsploraTx } from '../net/esplora.js';
import type { NetworkParams } from '../networks.js';
import { parseHeader } from '../crypto/pow.js';
import { Transaction } from '../tx/transaction.js';
import { checkHeaderChain } from '../wallet/headers.js';
import { verifyTransactionInclusion } from '../wallet/verify.js';
import type { SwapCoin } from './protocol.js';

export interface SwapTxInput {
  txid: string;
  vout: number;
  scriptSig: Uint8Array;
  witness: Uint8Array[];
}

/** A transaction as a swap sees it. */
export interface SwapTx {
  txid: string;
  /** Block height; 0 while unconfirmed. */
  height: number;
  inputs: SwapTxInput[];
  outputs: { value: bigint; script: Uint8Array }[];
}

/** A confirmed output paying to a contract, as one server reported it. */
export interface FundingClaim {
  address: string;
  txid: string;
  vout: number;
  value: bigint;
  height: number;
}

/**
 * Why a funding payment does not count yet. `unconfirmed` and `cross-check-failed`
 * pass with time; `mismatch`, `single-server`, `bad-chain` and `disagreement` mean
 * the server's word cannot be taken (a lying server, or only one server to ask).
 */
export type FundingVerdict =
  | { ok: true }
  | { ok: false; reason: 'unconfirmed' | 'mismatch' | 'single-server' | 'bad-chain' | 'disagreement' | 'cross-check-failed'; detail?: string };

/** Blocks after the funding block that a second server must agree on (LBC needs 12 confirmations). */
const CROSS_CHECK_BLOCKS = 12;
/** A funding payment deeper than this is not checked (it never is in a running swap). */
const MAX_FUNDING_DEPTH = 2016;

export interface SwapChain {
  readonly coin: SwapCoin;
  /** Where the chain is read from, for the log. */
  readonly server: string;
  tipHeight(): Promise<number>;
  /** Transactions that pay to or spend from an address (a contract's P2SH address). */
  addressTxs(address: string): Promise<SwapTx[]>;
  broadcast(tx: Transaction): Promise<string>;
  /** Fee rate (smallest unit per byte) for a transaction that should confirm soon. */
  feeRate(): Promise<number>;
  /**
   * Checks the other side's funding beyond the server that reported it, before
   * anything is locked or revealed because of it: on LBC with a merkle proof, a
   * run of headers that obeys the chain's rules up to the tip, and a second hub
   * that agrees on those blocks; on Bitcoin with independent explorers.
   */
  verifyFunding(claim: FundingClaim): Promise<FundingVerdict>;
}

export function confirmationsAt(height: number, tip: number): number {
  return height > 0 && tip >= height ? tip - height + 1 : 0;
}

function fromTransaction(tx: Transaction, height: number): SwapTx {
  return {
    txid: tx.txid,
    height,
    inputs: tx.inputs.map((i) => ({ txid: i.txid, vout: i.vout, scriptSig: i.scriptSig, witness: i.witness })),
    outputs: tx.outputs.map((o) => ({ value: o.value, script: o.script })),
  };
}

/** LBC through the wallet's chain backend (hub or lbcd). */
export function backendSwapChain(options: {
  backend: () => ChainBackend;
  network: NetworkParams;
  /** The wallet's chain tip (its proof of work checked by the hub client). */
  tip: () => { height: number; header: string } | null;
  feeRate: () => number;
  /** Broadcast through the wallet, so coins coming back to it show at once. */
  broadcast: (tx: Transaction) => Promise<string>;
  /** Seconds; for the sanity check of block times. */
  now?: () => number;
  log?: (level: 'info' | 'warn', message: string) => void;
}): SwapChain {
  return {
    coin: 'LBC',
    get server() {
      return options.backend().getStatus().server ?? options.backend().kind;
    },
    tipHeight: async () => options.tip()?.height ?? 0,
    addressTxs: async (address) => {
      const backend = options.backend();
      const history = await backend.getHistory(address);
      if (history.length === 0) return [];
      const fetched = await backend.getTransactions(history.map((h) => h.txid));
      const out: SwapTx[] = [];
      for (const h of history) {
        const f = fetched.get(h.txid);
        if (!f) continue;
        const tx = Transaction.fromHex(f.hex);
        // The server's txid must match the transaction it sent.
        if (tx.txid !== h.txid) throw new Error('the server sent a transaction that does not match its id');
        out.push(fromTransaction(tx, h.height > 0 ? h.height : 0));
      }
      return out;
    },
    broadcast: (tx) => options.broadcast(tx),
    feeRate: async () => options.feeRate(),
    verifyFunding: async (claim) => {
      const backend = options.backend();
      // Your own node checks everything itself; a hub must prove the transaction is in a block,
      // and that block must sit in a chain the rules allow and another hub knows.
      if (!backend.untrusted) return { ok: true };
      const tip = options.tip();
      if (claim.height <= 0 || !tip || tip.height < claim.height) return { ok: false, reason: 'unconfirmed' };
      if (tip.height - claim.height > MAX_FUNDING_DEPTH) return { ok: false, reason: 'mismatch', detail: 'the payment is too old to check' };
      const fetched = (await backend.getTransactions([claim.txid])).get(claim.txid);
      if (!fetched?.merkle || fetched.height !== claim.height) return { ok: false, reason: 'unconfirmed' };
      const tx = Transaction.fromHex(fetched.hex);
      const out = tx.outputs[claim.vout];
      if (tx.txid !== claim.txid || !out || out.value !== claim.value) return { ok: false, reason: 'mismatch', detail: 'the server sent a different transaction' };
      // Every header from two blocks before the payment up to the tip: linked, with valid proof of
      // work and exactly the difficulty the rule demands, ending in the tip the wallet follows.
      const from = Math.max(0, claim.height - 2);
      const headers = await backend.getHeaders(from, tip.height - from + 1);
      if (headers.length !== tip.height - from + 1) return { ok: false, reason: 'unconfirmed', detail: 'the server has not sent every header yet' };
      const chain = checkHeaderChain(headers, from, options.network, { now: options.now?.() ?? Math.floor(Date.now() / 1000), tipHash: parseHeader(fromHex(tip.header)).hash });
      if (!chain.ok) return { ok: false, reason: 'bad-chain', detail: chain.reason };
      const header = headers[claim.height - from]!;
      const inclusion = verifyTransactionInclusion(claim.txid, fetched.merkle, header, claim.height, options.network, tip);
      if (!inclusion.ok) return { ok: false, reason: 'bad-chain', detail: inclusion.reason };
      // A second hub must know the same blocks: the payment's and those confirming it. With a
      // single hub configured (the user's own choice, typically their own) there is none to ask.
      if (!backend.crossCheckHeaders) return { ok: false, reason: 'single-server', detail: 'this connection cannot ask a second hub' };
      const count = Math.min(CROSS_CHECK_BLOCKS, tip.height - claim.height + 1);
      let other: { server: string; headers: string[] } | null;
      try {
        other = await backend.crossCheckHeaders(claim.height, count);
      } catch (err) {
        return { ok: false, reason: 'cross-check-failed', detail: (err as Error).message };
      }
      if (!other) {
        options.log?.('warn', `only one hub is configured, so its word on the payment ${claim.txid.slice(0, 8)}… could not be checked against another`);
        return { ok: true };
      }
      if (other.headers.length < count) return { ok: false, reason: 'unconfirmed', detail: `${other.server} has not seen every confirming block yet` };
      for (let i = 0; i < count; i++) {
        if (other.headers[i] !== headers[claim.height - from + i]) return { ok: false, reason: 'disagreement', detail: `${other.server} reports a different block at height ${claim.height + i}` };
      }
      return { ok: true };
    },
  };
}

function fromEsplora(t: EsploraTx): SwapTx {
  return {
    txid: t.txid,
    height: t.status.confirmed ? (t.status.block_height ?? 0) : 0,
    inputs: t.vin.map((i) => ({ txid: i.txid, vout: i.vout, scriptSig: fromHex(i.scriptsig ?? ''), witness: (i.witness ?? []).map((w) => fromHex(w)) })),
    outputs: t.vout.map((o) => ({ value: BigInt(o.value), script: fromHex(o.scriptpubkey) })),
  };
}

/**
 * Bitcoin through Esplora servers run by different people. Every server is
 * asked for a contract's transactions, so one that hides a transaction (say
 * the other person's claim, which carries the secret) is outvoted; the swap
 * engine checks whatever a server reports before acting on it. The other
 * side's funding counts only when every server reports it the same way.
 */
export function esploraSwapChain(client: EsploraClient, crossCheck: EsploraClient[] = []): SwapChain {
  const all = [client, ...crossCheck];
  let lastTip: number | null = null;
  /** Answers from every server; one that is down or rate-limited must not stop a swap. */
  const fromAll = async <T>(ask: (c: EsploraClient) => Promise<T>): Promise<T[]> => {
    const results = await Promise.allSettled(all.map(ask));
    const answered: T[] = [];
    for (const r of results) if (r.status === 'fulfilled') answered.push(r.value);
    if (answered.length === 0) throw (results[0] as PromiseRejectedResult).reason;
    return answered;
  };
  return {
    coin: 'BTC',
    server: client.server,
    tipHeight: async () => {
      try {
        lastTip = Math.max(...(await fromAll((c) => c.tipHeight())));
        return lastTip;
      } catch (err) {
        if (lastTip !== null) return lastTip;
        throw err;
      }
    },
    addressTxs: async (address) => {
      const answered = await fromAll((c) => c.addressTxs(address));
      const merged = new Map<string, SwapTx>();
      for (const value of answered) {
        for (const t of value) {
          let tx: SwapTx;
          try {
            tx = fromEsplora(t);
          } catch {
            continue; // one malformed entry from one server is not a reason to stop
          }
          const seen = merged.get(tx.txid);
          // Servers may disagree while a block propagates: unconfirmed if any says so, else the latest height.
          if (seen) seen.height = seen.height === 0 || tx.height === 0 ? 0 : Math.max(seen.height, tx.height);
          else merged.set(tx.txid, tx);
        }
      }
      return [...merged.values()];
    },
    broadcast: async (tx) => {
      // Through every server we know, so one that drops it does not stall the swap.
      const results = await Promise.allSettled([client, ...crossCheck].map((c) => c.broadcast(tx.toHex())));
      const ok = results.find((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled');
      if (ok) return ok.value;
      throw (results[0] as PromiseRejectedResult).reason;
    },
    feeRate: async () => {
      // The median of the servers' estimates: one wrong or hostile estimate does not set the fee.
      const rates = (await fromAll((c) => c.feeRate(2))).sort((a, b) => a - b);
      return rates[Math.floor((rates.length - 1) / 2)]!;
    },
    verifyFunding: async (claim) => {
      for (const c of all) {
        const t = (await c.addressTxs(claim.address)).find((x) => x.txid === claim.txid);
        if (!t || !t.status.confirmed) return { ok: false, reason: 'unconfirmed', detail: `${c.server} does not show it confirmed` };
        if (t.status.block_height !== claim.height || t.vout[claim.vout]?.value !== Number(claim.value)) return { ok: false, reason: 'disagreement', detail: `${c.server} reports it differently` };
      }
      return { ok: true };
    },
  };
}
