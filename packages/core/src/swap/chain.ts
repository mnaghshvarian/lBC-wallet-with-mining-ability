/**
 * The two chains of a swap behind one small interface: LBC through the
 * wallet's hub or node, Bitcoin through an Esplora server.
 */
import { fromHex } from '../encoding/bytes.js';
import type { ChainBackend } from '../net/backend.js';
import type { EsploraClient, EsploraTx } from '../net/esplora.js';
import type { NetworkParams } from '../networks.js';
import { Transaction } from '../tx/transaction.js';
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
   * anything is locked or revealed because of it: on LBC with a merkle proof
   * against proof-of-work headers, on Bitcoin with independent explorers.
   */
  verifyFunding(claim: FundingClaim): Promise<boolean>;
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
  /** The wallet's verified chain tip. */
  tip: () => { height: number; header: string } | null;
  feeRate: () => number;
  /** Broadcast through the wallet, so coins coming back to it show at once. */
  broadcast: (tx: Transaction) => Promise<string>;
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
      // Your own node checks everything itself; a hub must prove the transaction is in a block.
      if (!backend.untrusted) return true;
      if (claim.height <= 0) return false;
      const fetched = (await backend.getTransactions([claim.txid])).get(claim.txid);
      if (!fetched?.merkle || fetched.height !== claim.height) return false;
      const tx = Transaction.fromHex(fetched.hex);
      const out = tx.outputs[claim.vout];
      if (tx.txid !== claim.txid || !out || out.value !== claim.value) return false;
      const [header] = await backend.getHeaders(claim.height, 1);
      if (!header) return false;
      return verifyTransactionInclusion(claim.txid, fetched.merkle, header, claim.height, options.network, options.tip()).ok;
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
  return {
    coin: 'BTC',
    server: client.server,
    tipHeight: () => client.tipHeight(),
    addressTxs: async (address) => {
      const results = await Promise.allSettled(all.map((c) => c.addressTxs(address)));
      const answered = results.filter((r): r is PromiseFulfilledResult<EsploraTx[]> => r.status === 'fulfilled');
      if (answered.length === 0) throw (results[0] as PromiseRejectedResult).reason;
      const merged = new Map<string, SwapTx>();
      for (const { value } of answered) {
        for (const t of value) {
          const tx = fromEsplora(t);
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
    feeRate: () => client.feeRate(2),
    verifyFunding: async (claim) => {
      for (const c of all) {
        const t = (await c.addressTxs(claim.address)).find((x) => x.txid === claim.txid);
        if (!t || !t.status.confirmed || t.status.block_height !== claim.height || t.vout[claim.vout]?.value !== Number(claim.value)) return false;
      }
      return true;
    },
  };
}
