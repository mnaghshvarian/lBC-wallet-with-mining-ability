import type { HistoryItem, MerkleProof } from '../net/backend.js';
import type { SwapRecord } from '../swap/record.js';
import type { MarketState } from '../market/protocol.js';

export interface AddressRecord {
  address: string;
  chain: number;
  index: number;
  /** Last status reported by the backend (null = no history). */
  status: string | null;
  history: HistoryItem[];
}

export interface TxRecord {
  txid: string;
  hex: string;
  /** Block height, 0 when unconfirmed. */
  height: number;
  firstSeen: number;
  blockTime?: number;
  merkle?: MerkleProof;
  /** SPV verification result for confirmed transactions from untrusted servers. */
  verified?: boolean;
}

export interface PendingTx {
  txid: string;
  hex: string;
  createdAt: number;
}

export interface Contact {
  id: string;
  name: string;
  address: string;
  note?: string;
}

/** Everything the wallet knows that is not derivable from the seed. Persisted encrypted. */
export interface WalletState {
  version: 1;
  addresses: AddressRecord[];
  txs: Record<string, TxRecord>;
  pending: Record<string, PendingTx>;
  tip: { height: number; header: string } | null;
  /** User labels keyed by txid or address. */
  labels: Record<string, string>;
  contacts: Contact[];
  /** Highest receiving index handed out via "new address". */
  issuedReceive: number;
  lastSyncAt?: number;
  /** Atomic swaps, with their keys and secrets. */
  swaps?: SwapRecord[];
  /** Order board offers and trades, with their keys. */
  market?: MarketState;
}

export function emptyWalletState(): WalletState {
  return { version: 1, addresses: [], txs: {}, pending: {}, tip: null, labels: {}, contacts: [], issuedReceive: 0 };
}

export type UtxoKind = 'standard' | 'support' | 'claim' | 'update' | 'other';

export interface WalletUtxo {
  txid: string;
  vout: number;
  value: bigint;
  script: Uint8Array;
  address: string;
  chain: number;
  index: number;
  height: number;
  confirmations: number;
  kind: UtxoKind;
  coinbase: boolean;
  mature: boolean;
  /** Created by this wallet (so spending it unconfirmed is safe). */
  trusted: boolean;
  claimName?: string;
  claimId?: string;
}

export interface Balance {
  /** Spendable right now. */
  available: bigint;
  /** Incoming, waiting for confirmation. */
  pending: bigint;
  /** Mining rewards waiting for coinbase maturity (100 blocks). */
  immature: bigint;
  /** Locked in supports and tips (can be unlocked). */
  supports: bigint;
  /** Locked in claims (channels/content), managed by LBRY apps. */
  claims: bigint;
  total: bigint;
}

export type TxType = 'receive' | 'send' | 'self' | 'mining' | 'tip-in' | 'tip-out' | 'support' | 'claim' | 'unlock';

export interface TxOutputView {
  vout: number;
  address: string | null;
  value: bigint;
  mine: boolean;
  change: boolean;
  kind: UtxoKind;
  claimName?: string;
  claimId?: string;
}

export interface TxInputView {
  txid: string;
  vout: number;
  address: string | null;
  value: bigint | null;
  mine: boolean;
}

export interface TxSummary {
  txid: string;
  height: number;
  confirmations: number;
  time: number;
  type: TxType;
  /** Net effect on the wallet (received minus spent), in dewies. */
  amount: bigint;
  fee: bigint | null;
  counterparty: string | null;
  label?: string;
  status: 'pending' | 'confirmed';
  verified?: boolean;
}

export interface TxDetail extends TxSummary {
  inputs: TxInputView[];
  outputs: TxOutputView[];
  size: number;
  hex: string;
}

export interface SyncInfo {
  state: 'idle' | 'connecting' | 'syncing' | 'synced' | 'offline' | 'error';
  addresses: number;
  transactions: number;
  lastSyncAt?: number;
  error?: string;
}
