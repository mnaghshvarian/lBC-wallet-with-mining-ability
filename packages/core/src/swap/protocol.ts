/**
 * The LBC ↔ Bitcoin atomic swap protocol: who locks what, for how long, and
 * what each side checks before it moves.
 *
 * The person who starts the swap ("starter") sends an invite with the agreed
 * amounts and the key hash they will be paid to. The person who joins
 * ("joiner") creates the secret and locks their coins first, for 48 hours,
 * then sends a lock code. The starter checks that contract on its chain and
 * locks their own coins for 24 hours (paid to the joiner's key hash, same
 * secret hash), then sends a lock code back. The joiner claims the starter's
 * coins, which reveals the secret on that chain; the starter's wallet reads it
 * there and claims the joiner's coins. If either side stops, both get their
 * coins back after their lock time.
 */
import { equalBytes } from '../encoding/bytes.js';
import type { AddressParams } from '../address.js';
import type { NetworkName } from '../networks.js';
import { parseHtlc, type HtlcTerms } from './htlc.js';

export type SwapCoin = 'LBC' | 'BTC';

export const otherCoin = (coin: SwapCoin): SwapCoin => (coin === 'LBC' ? 'BTC' : 'LBC');

/** Bitcoin address formats for the LBC network the wallet is on. */
export const BITCOIN_NETWORKS: Record<NetworkName, AddressParams> = {
  mainnet: { pubKeyHashPrefix: 0x00, scriptHashPrefix: 0x05, bech32Hrp: 'bc', symbol: 'BTC' },
  testnet: { pubKeyHashPrefix: 0x6f, scriptHashPrefix: 0xc4, bech32Hrp: 'tb', symbol: 'BTC' },
  regtest: { pubKeyHashPrefix: 0x6f, scriptHashPrefix: 0xc4, bech32Hrp: 'bcrt', symbol: 'BTC' },
};

export interface SwapChainRules {
  /** Confirmations before the other side's contract is trusted. */
  confirmations: number;
  /** Smallest output worth creating (relay dust limit with a margin). */
  dust: bigint;
  /** Expected seconds between blocks. */
  blockSeconds: number;
}

/**
 * LBC needs more confirmations than Bitcoin: its blocks come every 2.5 minutes
 * and its hashrate is far smaller, so a short chain could be rewritten more
 * cheaply.
 */
export const SWAP_CHAINS: Record<SwapCoin, SwapChainRules> = {
  LBC: { confirmations: 12, dust: 10_000n, blockSeconds: 150 },
  BTC: { confirmations: 2, dust: 1_000n, blockSeconds: 600 },
};

/** The time rules of a swap, in seconds. Tests shorten them; the app uses SWAP_TIMING. */
export interface SwapTiming {
  /** How long each side's coins are locked. */
  joinerLock: number;
  starterLock: number;
  /** The starter locks only while the joiner's contract has at least this long left. */
  starterMinRemaining: number;
  /** The starter's lock ends at least this long before the joiner's, to leave time to claim. */
  lockGap: number;
  /**
   * The joiner reveals the secret only while the starter's contract has at
   * least this long left: after it ends, the starter could take their coins
   * back and also use the revealed secret.
   */
  claimMargin: number;
  /** How far each chain's clock (the median time of recent blocks, which lock times are checked against) runs behind real time. */
  clockLag: Record<SwapCoin, number>;
}

export const SWAP_TIMING: SwapTiming = {
  joinerLock: 48 * 3600,
  starterLock: 24 * 3600,
  starterMinRemaining: 36 * 3600,
  lockGap: 12 * 3600,
  claimMargin: 4 * 3600,
  clockLag: { LBC: 20 * 60, BTC: 90 * 60 },
};

/** The starter's lock time, given the joiner's: 24 hours, and well before the joiner's ends. */
export function starterLocktime(now: number, joinerLocktime: number, timing: SwapTiming = SWAP_TIMING): number {
  return Math.min(now + timing.starterLock, joinerLocktime - timing.lockGap);
}

export interface ContractCheck {
  contract: Uint8Array;
  /** Value of the funding output paying to the contract. */
  value: bigint;
  /** Confirmations of the funding transaction (0 = unconfirmed). */
  confirmations: number;
  coin: SwapCoin;
  /** The key hash this wallet will claim with. */
  ourPkh: Uint8Array;
  /** The agreed amount. */
  amount: bigint;
  /** Secret hash the contract must use, when already known. */
  secretHash?: Uint8Array;
  /** Required lock-time window [min, max] (Unix seconds). */
  locktimeMin: number;
  locktimeMax: number;
}

export type ContractProblem = 'not-a-contract' | 'wrong-recipient' | 'amount-too-low' | 'wrong-secret-hash' | 'locktime-too-early' | 'locktime-too-late' | 'unconfirmed';

/**
 * Checks the other side's contract before anything is done that depends on it.
 * Returns the contract terms and every problem found; `unconfirmed` alone
 * means "wait".
 */
export function checkContract(c: ContractCheck): { terms: HtlcTerms | null; problems: ContractProblem[] } {
  let terms: HtlcTerms;
  try {
    terms = parseHtlc(c.contract);
  } catch {
    return { terms: null, problems: ['not-a-contract'] };
  }
  const problems: ContractProblem[] = [];
  if (!equalBytes(terms.recipientPkh, c.ourPkh)) problems.push('wrong-recipient');
  if (c.value < c.amount) problems.push('amount-too-low');
  if (c.secretHash && !equalBytes(terms.secretHash, c.secretHash)) problems.push('wrong-secret-hash');
  if (terms.locktime < c.locktimeMin) problems.push('locktime-too-early');
  if (terms.locktime > c.locktimeMax) problems.push('locktime-too-late');
  if (c.confirmations < SWAP_CHAINS[c.coin].confirmations) problems.push('unconfirmed');
  return { terms, problems };
}

/** Whether the refund path of a contract can be used now (the chain's clock is behind real time). */
export function refundOpen(locktime: number, coin: SwapCoin, now: number, timing: SwapTiming = SWAP_TIMING): boolean {
  return now >= locktime + timing.clockLag[coin];
}
