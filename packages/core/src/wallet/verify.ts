import { hashFromHex, hashToHex, fromHex, concatBytes } from '../encoding/bytes.js';
import { sha256d } from '../crypto/hash.js';
import { bitsToTarget, checkProofOfWork, parseHeader } from '../crypto/pow.js';
import type { MerkleProof } from '../net/backend.js';
import type { NetworkParams } from '../networks.js';

/** Recomputes a merkle root from a leaf txid and an Electrum-style branch. */
export function merkleRootFromBranch(txid: string, proof: MerkleProof): string {
  let node = hashFromHex(txid);
  proof.branch.forEach((hex, i) => {
    const other = hashFromHex(hex);
    node = (proof.pos >> i) & 1 ? sha256d(concatBytes(other, node)) : sha256d(concatBytes(node, other));
  });
  return hashToHex(node);
}

/** Merkle root of a list of txids (display hex), Bitcoin rules (duplicate last on odd levels). */
export function merkleRoot(txids: string[]): string {
  if (txids.length === 0) throw new Error('empty block');
  let level = txids.map(hashFromHex);
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      next.push(sha256d(concatBytes(left, right)));
    }
    level = next;
  }
  return hashToHex(level[0]!);
}

/** Merkle branch for the first leaf (coinbase), as used by Stratum jobs. Internal byte order. */
export function coinbaseMerkleBranch(txidsAfterCoinbase: string[]): Uint8Array[] {
  const branch: Uint8Array[] = [];
  let level: (Uint8Array | null)[] = [null, ...txidsAfterCoinbase.map(hashFromHex)];
  while (level.length > 1) {
    branch.push(level[1] ?? (level[0] as Uint8Array));
    const next: (Uint8Array | null)[] = [null];
    for (let i = 2; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      next.push(sha256d(concatBytes(left, right)));
    }
    level = next;
  }
  return branch;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  blockTime: number;
}

/**
 * SPV check of a confirmed transaction: the merkle proof must connect the txid
 * to the block header's merkle root, and the header must carry valid LBRY
 * proof of work. For recent blocks the claimed difficulty must also be close to
 * the current tip's, which stops a dishonest server from fabricating cheap
 * low-difficulty headers.
 */
export function verifyTransactionInclusion(
  txid: string,
  proof: MerkleProof,
  headerHex: string,
  height: number,
  network: NetworkParams,
  tip: { height: number; header: string } | null,
): VerifyResult {
  const header = fromHex(headerHex);
  const parsed = parseHeader(header);
  if (merkleRootFromBranch(txid, proof) !== parsed.merkleRoot) return { ok: false, reason: 'merkle proof mismatch', blockTime: parsed.timestamp };
  if (!checkProofOfWork(header, network.powLimit)) return { ok: false, reason: 'invalid proof of work', blockTime: parsed.timestamp };
  if (tip && tip.height - height < 20_000 && network.name === 'mainnet') {
    const tipTarget = bitsToTarget(parseHeader(fromHex(tip.header)).bits);
    if (bitsToTarget(parsed.bits) > tipTarget * 256n) return { ok: false, reason: 'implausibly low difficulty', blockTime: parsed.timestamp };
  }
  return { ok: true, blockTime: parsed.timestamp };
}
