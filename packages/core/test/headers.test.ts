import { describe, expect, it } from 'vitest';
import { MAINNET, REGTEST, bitsToTarget, blockHash, checkHeaderChain, checkProofOfWork, nextRequiredBits, parseHeader, targetToBits, HEADER_SIZE, toHex } from '../src/index';
import { ByteWriter } from '../src/encoding/bytes';

/** A regtest header on top of `prev` (internal-order hash) with valid proof of work. */
function mine(prev: Uint8Array, timestamp: number, bits = REGTEST.powLimitBits): Uint8Array {
  for (let nonce = 0; ; nonce++) {
    const h = new ByteWriter(HEADER_SIZE).i32LE(1).bytes(prev).bytes(new Uint8Array(32).fill(1)).bytes(new Uint8Array(32)).u32LE(timestamp).u32LE(bits).u32LE(nonce).toBytes();
    if (checkProofOfWork(h, REGTEST.powLimit)) return h;
  }
}

const START = 1_700_000_000;

/** `n` linked regtest headers from height 0, one second apart. */
function chain(n: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  let prev: Uint8Array = new Uint8Array(32);
  for (let i = 0; i < n; i++) {
    const h = mine(prev, START + i);
    out.push(h);
    prev = blockHash(h);
  }
  return out;
}

const hex = (headers: Uint8Array[]) => headers.map((h) => toHex(h));

describe('the difficulty rule (lbcd calcNextRequiredDifficulty for LBRY)', () => {
  const bits = 0x1a05c3ab;
  const target = bitsToTarget(bits);
  const after = (seconds: number) => nextRequiredBits(MAINNET, { bits, timestamp: START + seconds, height: 2_000_000 }, { timestamp: START });

  it('keeps the difficulty when the last block took exactly the target time', () => {
    expect(after(150)).toBe(bits);
  });

  it('damps the change to an eighth and limits it to -12.5 % … +50 % of the timespan', () => {
    expect(after(600)).toBe(targetToBits((target * 206n) / 150n)); // 150 + 450 / 8
    expect(after(0)).toBe(targetToBits((target * 132n) / 150n)); // floor: 150 - 150 / 8
    expect(after(-100)).toBe(targetToBits((target * 132n) / 150n)); // a block dated before its parent
    expect(after(5000)).toBe(targetToBits((target * 225n) / 150n)); // ceiling: 150 + 150 / 2
    expect(bitsToTarget(after(5000))).toBeGreaterThan(bitsToTarget(after(600)));
    expect(bitsToTarget(after(600))).toBeGreaterThan(target);
    expect(bitsToTarget(after(0))).toBeLessThan(target);
  });

  it('never goes easier than the proof-of-work limit', () => {
    expect(nextRequiredBits(MAINNET, { bits: MAINNET.powLimitBits, timestamp: START + 5000, height: 10 }, { timestamp: START })).toBe(MAINNET.powLimitBits);
  });

  it('measures a zero timespan for the genesis block and needs the parent otherwise', () => {
    expect(nextRequiredBits(MAINNET, { bits: MAINNET.powLimitBits, timestamp: START, height: 0 }, null)).toBe(targetToBits((bitsToTarget(MAINNET.powLimitBits) * 132n) / 150n));
    expect(() => nextRequiredBits(MAINNET, { bits, timestamp: START, height: 1 }, null)).toThrow(/parent/);
  });

  it('holds regtest at the minimum difficulty whatever the block times', () => {
    for (const gap of [0, 1, 60, 3600]) expect(nextRequiredBits(REGTEST, { bits: REGTEST.powLimitBits, timestamp: START + gap, height: 5 }, { timestamp: START })).toBe(REGTEST.powLimitBits);
  });
});

describe('checkHeaderChain', () => {
  const headers = chain(6);

  it('accepts linked headers with valid proof of work, the right difficulty and the expected tip', () => {
    const result = checkHeaderChain(hex(headers), 0, REGTEST, { now: START + 100, tipHash: parseHeader(headers[5]!).hash });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.headers).toHaveLength(6);
  });

  it('also checks a run that starts in the middle of the chain', () => {
    expect(checkHeaderChain(hex(headers.slice(2)), 2, REGTEST).ok).toBe(true);
  });

  it('rejects a header that does not follow the one before', () => {
    const forged = [...headers];
    forged[3] = mine(new Uint8Array(32).fill(9), START + 3);
    const result = checkHeaderChain(hex(forged), 0, REGTEST);
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/block 3 does not follow block 2/) });
  });

  it('rejects a difficulty the rule does not require', () => {
    const forged = headers.slice(0, 3);
    forged.push(mine(blockHash(headers[2]!), START + 3, 0x1f7fffff));
    const result = checkHeaderChain(hex(forged), 0, REGTEST);
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/block 3 has difficulty 1f7fffff where the rule requires 207fffff/) });
  });

  it('rejects proof of work that is too easy for the network', () => {
    expect(checkHeaderChain(hex(headers.slice(0, 1)), 0, MAINNET)).toMatchObject({ ok: false, reason: expect.stringMatching(/invalid proof of work/) });
  });

  it('rejects blocks dated more than two hours ahead', () => {
    expect(checkHeaderChain(hex(headers), 0, REGTEST, { now: START - 3 * 3600 })).toMatchObject({ ok: false, reason: expect.stringMatching(/future/) });
  });

  it('rejects a run that does not end at the expected tip, malformed and empty input', () => {
    expect(checkHeaderChain(hex(headers), 0, REGTEST, { tipHash: '00'.repeat(32) })).toMatchObject({ ok: false, reason: expect.stringMatching(/not the chain tip/) });
    expect(checkHeaderChain(['zz'], 0, REGTEST).ok).toBe(false);
    expect(checkHeaderChain(['00'], 0, REGTEST)).toMatchObject({ ok: false, reason: expect.stringMatching(/wrong size/) });
    expect(checkHeaderChain([], 0, REGTEST)).toMatchObject({ ok: false, reason: 'no headers' });
  });
});
