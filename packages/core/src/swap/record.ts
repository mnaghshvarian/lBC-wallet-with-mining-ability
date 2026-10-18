import type { NetworkName } from '../networks.js';
import type { SwapCoin } from './protocol.js';

/** A contract of a swap, ours or theirs. */
export interface SwapContractRecord {
  coin: SwapCoin;
  /** The contract script (hex). */
  contract: string;
  /** Its P2SH address. */
  address: string;
  locktime: number;
  /** The output paying to the contract, once known. */
  funding?: { txid: string; vout: number; value: string; height: number };
  /** Set once the funding output was checked against the chain beyond the first server. */
  verified?: boolean;
}

/** A claim or refund transaction this wallet sent. */
export interface SwapSpendRecord {
  txid: string;
  hex: string;
  height: number;
  sentAt: number;
}

export interface SwapEvent {
  at: number;
  code: string;
  params?: Record<string, string | number>;
}

/**
 * Everything a wallet keeps about one swap. Stored inside the wallet's
 * encrypted state, because it holds the swap's private keys and secret.
 */
export interface SwapRecord {
  id: string;
  role: 'starter' | 'joiner';
  network: NetworkName;
  give: SwapCoin;
  /** Agreed amounts: dewies and satoshis, as decimal strings. */
  lbc: string;
  btc: string;
  createdAt: number;
  updatedAt: number;
  /** Private keys (hex): the refund key on the chain we give, the claim key on the chain we get. */
  giveKey: string;
  getKey: string;
  /** The joiner's secret (hex); the starter learns it when the joiner claims. */
  secret?: string;
  secretHash?: string;
  /** Where the coins we get are paid, and where a refund of ours goes. */
  receiveTo: string;
  refundTo: string;
  /** The other side's claim key hash on the chain we give (hex). */
  theirPkh?: string;
  /** The joiner must lock before this time (Unix seconds), when the swap came from the order board. */
  lockBy?: number;
  ours?: SwapContractRecord;
  theirs?: SwapContractRecord;
  claim?: SwapSpendRecord;
  refund?: SwapSpendRecord;
  /** `failed`: the other side's coins went back to them before this wallet could claim them. */
  status: 'active' | 'completed' | 'refunded' | 'cancelled' | 'failed';
  /** Why the swap is stuck or ended early, for the user. */
  problem?: { code: string; params?: Record<string, string | number> };
  events: SwapEvent[];
}
