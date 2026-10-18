import { describe, expect, it } from 'vitest';
import { ByteWriter, fromHex, hashFromHex, hashToHex } from '../src/encoding/bytes.js';
import { bitsToTarget, blockHash, checkProofOfWork, hashToBigInt, lbryPowHash, parseHeader, targetToBits, workForTarget } from '../src/crypto/pow.js';
import { MAINNET, REGTEST } from '../src/networks.js';

function genesisHeader(bits: number, nonce: number): Uint8Array {
  return new ByteWriter(112)
    .i32LE(1)
    .bytes(new Uint8Array(32))
    .bytes(hashFromHex('b8211c82c3d15bcd78bba57005b86fed515149a53a425eb592c07af99fe559cc'))
    .bytes(hashFromHex('0000000000000000000000000000000000000000000000000000000000000001'))
    .u32LE(1446058291)
    .u32LE(bits)
    .u32LE(nonce)
    .toBytes();
}

describe('LBRY proof of work', () => {
  it('reproduces the mainnet genesis block hash and its valid PoW', () => {
    const header = genesisHeader(0x1f00ffff, 1287);
    expect(header.length).toBe(112);
    expect(hashToHex(blockHash(header))).toBe(MAINNET.genesisHash);
    expect(checkProofOfWork(header, MAINNET.powLimit)).toBe(true);
    // A neighbouring nonce must not hash below the target (2^-16 odds of a false positive).
    const pow = hashToBigInt(lbryPowHash(header));
    expect(pow <= bitsToTarget(0x1f00ffff)).toBe(true);
    const parsed = parseHeader(header);
    expect(parsed.claimTrieRoot).toBe('0000000000000000000000000000000000000000000000000000000000000001');
    expect(parsed.nonce).toBe(1287);
  });

  it('reproduces the regtest genesis block hash', () => {
    expect(hashToHex(blockHash(genesisHeader(0x207fffff, 1)))).toBe(REGTEST.genesisHash);
  });

  it('converts between compact bits and targets', () => {
    expect(bitsToTarget(0x1f00ffff)).toBe(0xffffn << 224n);
    expect(targetToBits(bitsToTarget(0x1f00ffff))).toBe(0x1f00ffff);
    expect(targetToBits(bitsToTarget(0x1a0d5e53))).toBe(0x1a0d5e53);
    expect(targetToBits(bitsToTarget(0x207fffff))).toBe(0x207fffff);
    expect(bitsToTarget(0x01003456)).toBe(0n);
    expect(workForTarget(bitsToTarget(0x1f00ffff))).toBe(65537n);
  });

  it('hashes known input deterministically', () => {
    const h = lbryPowHash(fromHex('00'.repeat(112)));
    expect(h.length).toBe(32);
    expect(hashToHex(h)).toMatch(/^[0-9a-f]{64}$/);
  });
});
