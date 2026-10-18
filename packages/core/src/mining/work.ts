import { ByteWriter, concatBytes, fromHex, hashFromHex, isHex, toHex, writeU32LE } from '../encoding/bytes.js';
import { sha256d } from '../crypto/hash.js';
import { HEADER_SIZE, hashToBigInt, lbryPowHash } from '../crypto/pow.js';

/**
 * Mining work shared by the Stratum and solo (getblocktemplate) paths.
 *
 * LBRY header layout (112 bytes, all integers little-endian):
 *   [0,4) version  [4,36) prev hash  [36,68) merkle root  [68,100) claimtrie root
 *   [100,104) time  [104,108) bits  [108,112) nonce
 */
export const NONCE_OFFSET = 108;
export const TIME_OFFSET = 100;

/** A header template plus everything needed to turn a found nonce into a share/block. */
export interface WorkUnit {
  /** Unique id of the source job. */
  jobId: string;
  /** 112-byte header with the nonce field zeroed. */
  header: Uint8Array;
  /** Share (or block) target as a 256-bit integer. */
  target: bigint;
  /** Network (block) target. */
  blockTarget: bigint;
  /** Extranonce2 used to build this header (Stratum), hex. */
  extranonce2?: string;
  ntime: number;
}

export function setNonce(header: Uint8Array, nonce: number): void {
  writeU32LE(header, nonce >>> 0, NONCE_OFFSET);
}

/** Checks a candidate nonce in JS (used to double-check WASM results before submitting). */
export function checkNonce(work: WorkUnit, nonce: number): { hash: Uint8Array; meetsShare: boolean; meetsBlock: boolean; value: bigint } {
  const header = work.header.slice();
  setNonce(header, nonce);
  const hash = lbryPowHash(header);
  const value = hashToBigInt(hash);
  return { hash, meetsShare: value <= work.target, meetsBlock: value <= work.blockTarget, value };
}

/** Swaps the bytes inside each 32-bit word (Stratum's encoding of prevhash / claimtrie). */
export function swapWords(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 4) {
    out[i] = bytes[i + 3]!;
    out[i + 1] = bytes[i + 2]!;
    out[i + 2] = bytes[i + 1]!;
    out[i + 3] = bytes[i]!;
  }
  return out;
}

export function assembleHeader(fields: {
  version: number;
  prevHash: Uint8Array;
  merkleRoot: Uint8Array;
  claimTrie: Uint8Array;
  time: number;
  bits: number;
  nonce?: number;
}): Uint8Array {
  const w = new ByteWriter(HEADER_SIZE)
    .u32LE(fields.version >>> 0)
    .bytes(fields.prevHash)
    .bytes(fields.merkleRoot)
    .bytes(fields.claimTrie)
    .u32LE(fields.time >>> 0)
    .u32LE(fields.bits >>> 0)
    .u32LE((fields.nonce ?? 0) >>> 0);
  const header = w.toBytes();
  if (header.length !== HEADER_SIZE) throw new Error('bad header size');
  return header;
}

/** Merkle root from the coinbase hash and a branch (internal byte order). */
export function merkleRootFromCoinbase(coinbaseHash: Uint8Array, branch: Uint8Array[]): Uint8Array {
  let root = coinbaseHash;
  for (const b of branch) root = sha256d(concatBytes(root, b));
  return root;
}

// ---------------------------------------------------------------------------
// Stratum (LBRY variant: mining.notify carries the claimtrie root)
// ---------------------------------------------------------------------------

export interface StratumJob {
  jobId: string;
  /** Header-order (internal) bytes. */
  prevHash: Uint8Array;
  claimTrie: Uint8Array;
  coinb1: Uint8Array;
  coinb2: Uint8Array;
  merkleBranch: Uint8Array[];
  version: number;
  bits: number;
  ntime: number;
  clean: boolean;
}

/**
 * Parses LBRY `mining.notify` params:
 * [job_id, prevhash, claimtrie, coinb1, coinb2, merkle_branch[], version, nbits, ntime, clean_jobs]
 * prevhash/claimtrie are word-swapped; version/nbits/ntime are big-endian hex.
 */
export function parseLbryNotify(params: unknown): StratumJob {
  if (!Array.isArray(params)) throw new Error('mining.notify params must be an array');
  if (params.length < 10) throw new Error('pool did not send a claimtrie root — is this an LBRY (lbry algorithm) pool?');
  const [jobId, prev, claim, cb1, cb2, branch, version, nbits, ntime, clean] = params as unknown[];
  const hex = (v: unknown, bytes?: number) => {
    if (typeof v !== 'string' || !isHex(v, bytes)) throw new Error('malformed mining.notify');
    return v;
  };
  if (!Array.isArray(branch)) throw new Error('malformed merkle branch');
  return {
    jobId: String(jobId),
    prevHash: swapWords(fromHex(hex(prev, 32))),
    claimTrie: swapWords(fromHex(hex(claim, 32))),
    coinb1: fromHex(hex(cb1)),
    coinb2: fromHex(hex(cb2)),
    merkleBranch: branch.map((b) => fromHex(hex(b, 32))),
    version: parseInt(hex(version, 4), 16) >>> 0,
    bits: parseInt(hex(nbits, 4), 16) >>> 0,
    ntime: parseInt(hex(ntime, 4), 16) >>> 0,
    clean: clean === true,
  };
}

/** LBRY pools use a 256× diff multiplier: difficulty 1 ↔ target 0xffff·2^216. */
const LBRY_DIFF1_TARGET = 0xffffn << 216n;
const MAX_TARGET = (1n << 256n) - 1n;

export function shareTargetForDifficulty(difficulty: number): bigint {
  if (!(difficulty > 0) || !Number.isFinite(difficulty)) return MAX_TARGET;
  const SCALE = 1n << 32n;
  const scaled = BigInt(Math.max(1, Math.round(difficulty * 2 ** 32)));
  const t = (LBRY_DIFF1_TARGET * SCALE) / scaled;
  return t > MAX_TARGET ? MAX_TARGET : t;
}

/** Expected hashes per share at a given pool difficulty. */
export function hashesPerShare(difficulty: number): number {
  return (difficulty * 2 ** 256) / Number(LBRY_DIFF1_TARGET);
}

export function stratumWork(job: StratumJob, extranonce1: Uint8Array, extranonce2: Uint8Array, shareTarget: bigint, blockTarget: bigint, ntime = job.ntime): WorkUnit {
  const coinbase = concatBytes(job.coinb1, extranonce1, extranonce2, job.coinb2);
  const merkleRoot = merkleRootFromCoinbase(sha256d(coinbase), job.merkleBranch);
  const header = assembleHeader({ version: job.version, prevHash: job.prevHash, merkleRoot, claimTrie: job.claimTrie, time: ntime, bits: job.bits });
  return { jobId: job.jobId, header, target: shareTarget, blockTarget, extranonce2: toHex(extranonce2), ntime };
}

/** Formats submit fields: nonce/ntime as big-endian hex of the header values (cpuminer convention). */
export function submitParams(username: string, work: WorkUnit, nonce: number): [string, string, string, string, string] {
  return [username, work.jobId, work.extranonce2 ?? '', (work.ntime >>> 0).toString(16).padStart(8, '0'), (nonce >>> 0).toString(16).padStart(8, '0')];
}

export function extranonce2For(counter: bigint, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let v = counter;
  for (let i = 0; i < size; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export { hashFromHex };
