/**
 * Checks on runs of block headers, for the light wallet: LBRY's difficulty rule
 * (lbcd `blockchain/difficulty.go` and `chain.go`) and the linkage of
 * consecutive headers. A hub can send any header it likes; before coins move on
 * its word, the headers it sends must form a chain that obeys the rules and
 * that another server agrees with.
 */
import { fromHex } from '../encoding/bytes.js';
import { HEADER_SIZE, bitsToTarget, checkProofOfWork, parseHeader, targetToBits, type ParsedHeader } from '../crypto/pow.js';
import type { NetworkParams } from '../networks.js';

/** A block's time may be at most this far ahead of the clock (consensus rule). */
export const MAX_FUTURE_BLOCK_TIME = 2 * 60 * 60;

export interface HeaderNode {
  bits: number;
  timestamp: number;
  height: number;
}

/**
 * The nBits the block after `last` must carry: lbcd's `calcNextRequiredDifficulty`
 * for LBRY networks. The target adjusts every block by the time the last block
 * took, damped to one eighth of the difference and limited to −12.5 % … +50 % of
 * the target timespan (`minRetargetTimespan`, `maxRetargetTimespan`), then capped
 * at the proof-of-work limit. `parent` is the block before `last`; the genesis
 * block has none, and lbcd then measures a zero timespan.
 */
export function nextRequiredBits(network: NetworkParams, last: HeaderNode, parent: { timestamp: number } | null): number {
  if (last.height >= 1 && !parent) throw new Error('the parent header is needed to compute the next difficulty');
  const span = BigInt(network.powTargetTimespan);
  const first = last.height >= 1 ? parent! : last;
  const actual = BigInt(last.timestamp - first.timestamp);
  // Integer divisions truncate toward zero, as in Go.
  let adjusted = span + (actual - span) / 8n;
  const min = span - span / 8n;
  const max = span + span / 2n;
  if (adjusted < min) adjusted = min;
  else if (adjusted > max) adjusted = max;
  let target = (bitsToTarget(last.bits) * adjusted) / span;
  if (target > network.powLimit) target = network.powLimit;
  return targetToBits(target);
}

export type HeaderChainResult = { ok: true; headers: ParsedHeader[] } | { ok: false; reason: string };

/**
 * Verifies that `headersHex` are the consecutive blocks from `firstHeight` on:
 * each with valid proof of work, each linking to the one before, each carrying
 * exactly the difficulty the rule demands (checked wherever both predecessors
 * are known, so from the third header on, or from the second when the first is
 * the genesis block), none dated more than two hours ahead of `now`, and the
 * last one being the block `tipHash` (display hex) when given.
 */
export function checkHeaderChain(headersHex: string[], firstHeight: number, network: NetworkParams, options: { now?: number; tipHash?: string } = {}): HeaderChainResult {
  const fail = (reason: string): HeaderChainResult => ({ ok: false, reason });
  if (headersHex.length === 0) return fail('no headers');
  const headers: ParsedHeader[] = [];
  for (let i = 0; i < headersHex.length; i++) {
    const height = firstHeight + i;
    let bytes: Uint8Array;
    try {
      bytes = fromHex(headersHex[i]!);
    } catch {
      return fail(`header ${height} is not hex`);
    }
    if (bytes.length !== HEADER_SIZE) return fail(`header ${height} has the wrong size`);
    const h = parseHeader(bytes);
    if (!checkProofOfWork(bytes, network.powLimit)) return fail(`block ${height} has invalid proof of work`);
    if (options.now !== undefined && h.timestamp > options.now + MAX_FUTURE_BLOCK_TIME) return fail(`block ${height} is dated in the future`);
    const prev = headers[i - 1];
    if (prev && h.prevHash !== prev.hash) return fail(`block ${height} does not follow block ${height - 1}`);
    const grand = headers[i - 2] ?? null;
    if (prev && (grand || height - 1 === 0)) {
      const required = nextRequiredBits(network, { bits: prev.bits, timestamp: prev.timestamp, height: height - 1 }, grand);
      if (h.bits !== required) return fail(`block ${height} has difficulty ${h.bits.toString(16)} where the rule requires ${required.toString(16)}`);
    }
    headers.push(h);
  }
  if (options.tipHash && headers[headers.length - 1]!.hash !== options.tipHash) return fail('the last header is not the chain tip');
  return { ok: true, headers };
}
