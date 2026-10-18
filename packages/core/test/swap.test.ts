import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { concatBytes, fromHex, toHex } from '../src/encoding/bytes.js';
import { hash160, sha256 } from '../src/crypto/hash.js';
import { decompile, p2pkhScript } from '../src/script/script.js';
import { SIGHASH_ALL, legacySighash, publicKeyOf } from '../src/tx/sign.js';
import { SEQUENCE_FINAL } from '../src/tx/transaction.js';
import { MAINNET } from '../src/networks.js';
import { addressToScript, decodeAddress } from '../src/address.js';
import { buildHtlcSpend, extractSecret, htlcAddress, htlcOutputScript, htlcScript, parseHtlc, secretHashOf, type HtlcTerms } from '../src/swap/htlc.js';
import { decodeSwapCode, encodeSwapCode } from '../src/swap/codes.js';
import { BITCOIN_NETWORKS, SWAP_TIMING, checkContract, refundOpen, starterLocktime } from '../src/swap/protocol.js';
import { esploraSwapChain } from '../src/swap/chain.js';
import { EsploraClient, type EsploraHttp, type EsploraTx } from '../src/net/esplora.js';

const recipientKey = fromHex('11'.repeat(32));
const refundKey = fromHex('22'.repeat(32));
const secret = fromHex('5e'.repeat(32));
const terms: HtlcTerms = {
  secretHash: secretHashOf(secret),
  recipientPkh: hash160(publicKeyOf(recipientKey)),
  refundPkh: hash160(publicKeyOf(refundKey)),
  locktime: 1_760_000_000,
};

describe('swap contract', () => {
  it('has exactly the layout of Decred atomicswap contracts', () => {
    const script = htlcScript(terms);
    expect(script.length).toBe(97);
    const expected = concatBytes(
      fromHex('63820120' + '88a820'),
      terms.secretHash,
      fromHex('8876a914'),
      terms.recipientPkh,
      fromHex('6704'),
      // 1760000000 = 0x68e77800, little-endian
      fromHex('0078e768'),
      fromHex('b17576a914'),
      terms.refundPkh,
      fromHex('6888ac'),
    );
    expect(toHex(script)).toBe(toHex(expected));
    expect(parseHtlc(script)).toEqual(terms);
  });

  it('refuses anything that is not exactly the template', () => {
    const script = htlcScript(terms);
    // Another secret size.
    const size = script.slice();
    size[3] = 0x21;
    expect(() => parseHtlc(size)).toThrow();
    // An extra opcode at the end.
    expect(() => parseHtlc(concatBytes(script, fromHex('75')))).toThrow();
    // A non-minimal push of the locktime (PUSHDATA1).
    const nonMinimal = concatBytes(script.slice(0, 57), fromHex('4c04'), script.slice(58));
    expect(() => parseHtlc(nonMinimal)).toThrow();
    // Block-height lock times are not used.
    expect(() => htlcScript({ ...terms, locktime: 800_000 })).toThrow();
    expect(() => parseHtlc(fromHex('76a914' + '00'.repeat(20) + '88ac'))).toThrow();
  });

  it('pays to P2SH addresses on LBC and Bitcoin', () => {
    const script = htlcScript(terms);
    const lbc = htlcAddress(script, MAINNET);
    expect(lbc.startsWith('r')).toBe(true);
    const btc = htlcAddress(script, BITCOIN_NETWORKS.mainnet);
    expect(btc.startsWith('3')).toBe(true);
    expect(addressToScript(btc, BITCOIN_NETWORKS.mainnet)).toEqual(htlcOutputScript(script));
    expect(decodeAddress('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', BITCOIN_NETWORKS.mainnet).type).toBe('p2wpkh');
    expect(() => decodeAddress(btc, MAINNET)).toThrow();
  });

  function verifyInput(tx: ReturnType<typeof buildHtlcSpend>['tx'], contract: Uint8Array): boolean {
    const chunks = decompile(tx.inputs[0]!.scriptSig)!;
    const sig = chunks[0]!.data!;
    const pub = chunks[1]!.data!;
    expect(sig[sig.length - 1]).toBe(SIGHASH_ALL);
    expect(chunks[chunks.length - 1]!.data).toEqual(contract);
    return secp256k1.verify(sig.subarray(0, -1), legacySighash(tx, 0, contract), pub, { prehash: false, lowS: true, format: 'der' });
  }

  it('claims with the secret, which anyone can then read from the transaction', () => {
    const contract = htlcScript(terms);
    const destination = addressToScript('bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', BITCOIN_NETWORKS.mainnet);
    const { tx, fee } = buildHtlcSpend({
      contract,
      output: { txid: 'ab'.repeat(32), vout: 1, value: 100_000n },
      privateKey: recipientKey,
      destination,
      feeRate: 10,
      dust: 1_000n,
      path: { kind: 'redeem', secret },
    });
    expect(tx.locktime).toBe(0);
    expect(tx.inputs[0]!.sequence).toBe(SEQUENCE_FINAL);
    expect(tx.outputs[0]!.value).toBe(100_000n - fee);
    expect(Number(fee)).toBeGreaterThanOrEqual(tx.size * 10);
    expect(verifyInput(tx, contract)).toBe(true);
    expect(extractSecret(tx.inputs[0]!.scriptSig, terms.secretHash)).toEqual(secret);
    expect(extractSecret(tx.inputs[0]!.scriptSig, sha256(fromHex('00')))).toBeNull();
  });

  it('refunds only with the refund key, and only after the lock time', () => {
    const contract = htlcScript(terms);
    const params = {
      contract,
      output: { txid: 'cd'.repeat(32), vout: 0, value: 50_000_000n },
      destination: p2pkhScript(hash160(publicKeyOf(refundKey))),
      feeRate: 50,
      dust: 10_000n,
    };
    const { tx } = buildHtlcSpend({ ...params, privateKey: refundKey, path: { kind: 'refund' } });
    expect(tx.locktime).toBe(terms.locktime);
    expect(tx.inputs[0]!.sequence).toBeLessThan(SEQUENCE_FINAL);
    expect(verifyInput(tx, contract)).toBe(true);
    expect(extractSecret(tx.inputs[0]!.scriptSig, terms.secretHash)).toBeNull();
    expect(() => buildHtlcSpend({ ...params, privateKey: recipientKey, path: { kind: 'refund' } })).toThrow(/cannot refund/);
    expect(() => buildHtlcSpend({ ...params, privateKey: refundKey, path: { kind: 'redeem', secret } })).toThrow(/cannot claim/);
    expect(() => buildHtlcSpend({ ...params, privateKey: recipientKey, path: { kind: 'redeem', secret: fromHex('00'.repeat(32)) } })).toThrow(/does not match/);
    expect(() => buildHtlcSpend({ ...params, output: { ...params.output, value: 20_000n }, privateKey: refundKey, path: { kind: 'refund' } })).toThrow(/too small/);
  });
});

describe('swap codes', () => {
  it('round-trips an invite and a lock code', () => {
    const invite = { type: 'invite' as const, network: 'mainnet' as const, id: '0123456789abcdef', starterGives: 'LBC' as const, lbc: 1_000_000_000_000n, btc: 50_000n, starterPkh: terms.recipientPkh };
    const text = encodeSwapCode(invite);
    expect(text.startsWith('lbcswap:')).toBe(true);
    expect(text).toMatch(/^[a-z]+:[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
    expect(decodeSwapCode(`  ${text}\n`)).toEqual(invite);
    const lock = { type: 'lock' as const, network: 'regtest' as const, id: '0123456789abcdef', coin: 'BTC' as const, contract: htlcScript(terms), txid: 'ab'.repeat(32), vout: 2, joinerPkh: terms.refundPkh };
    expect(decodeSwapCode(encodeSwapCode(lock))).toEqual(lock);
    const { joinerPkh: _, ...plain } = lock;
    expect(decodeSwapCode(encodeSwapCode(plain))).toEqual(plain);
  });

  it('notices damaged or foreign codes', () => {
    const text = encodeSwapCode({ type: 'invite', network: 'mainnet', id: '0123456789abcdef', starterGives: 'BTC', lbc: 10n ** 10n, btc: 30_000n, starterPkh: terms.recipientPkh });
    const body = text.slice(8, -9);
    const flipped = text.slice(0, 20) + (text[20] === 'A' ? 'B' : 'A') + text.slice(21);
    expect(() => decodeSwapCode(flipped)).toThrow(/not a valid swap code/);
    expect(() => decodeSwapCode(text.slice(0, -3))).toThrow();
    expect(() => decodeSwapCode(`hello:${body}`)).toThrow();
    expect(() => decodeSwapCode('')).toThrow();
  });
});

describe('swap protocol', () => {
  const now = 1_760_000_000;
  const contract = htlcScript({ ...terms, locktime: now + 48 * 3600 });
  const base = { contract, value: 100_000n, confirmations: 2, coin: 'BTC' as const, ourPkh: terms.recipientPkh, amount: 100_000n, locktimeMin: now + 36 * 3600, locktimeMax: now + 72 * 3600 };

  it('accepts a contract that pays us enough, long enough, and is confirmed', () => {
    expect(checkContract(base).problems).toEqual([]);
    expect(checkContract({ ...base, secretHash: terms.secretHash }).problems).toEqual([]);
  });

  it('names every problem', () => {
    expect(checkContract({ ...base, confirmations: 1 }).problems).toEqual(['unconfirmed']);
    expect(checkContract({ ...base, value: 99_999n }).problems).toEqual(['amount-too-low']);
    expect(checkContract({ ...base, ourPkh: terms.refundPkh }).problems).toEqual(['wrong-recipient']);
    expect(checkContract({ ...base, secretHash: sha256(secret).map((b) => b ^ 1) }).problems).toEqual(['wrong-secret-hash']);
    expect(checkContract({ ...base, locktimeMin: now + 49 * 3600 }).problems).toEqual(['locktime-too-early']);
    expect(checkContract({ ...base, locktimeMax: now + 47 * 3600 }).problems).toEqual(['locktime-too-late']);
    expect(checkContract({ ...base, contract: fromHex('51') }).problems).toEqual(['not-a-contract']);
    // LBC needs more confirmations than Bitcoin.
    expect(checkContract({ ...base, coin: 'LBC', confirmations: 11 }).problems).toEqual(['unconfirmed']);
  });

  it('gives the starter 24 hours, ending well before the joiner', () => {
    expect(starterLocktime(now, now + 48 * 3600)).toBe(now + SWAP_TIMING.starterLock);
    expect(starterLocktime(now, now + 30 * 3600)).toBe(now + 30 * 3600 - SWAP_TIMING.lockGap);
  });

  it('waits for the chain clock before refunding', () => {
    expect(refundOpen(now, 'BTC', now)).toBe(false);
    expect(refundOpen(now, 'BTC', now + 90 * 60)).toBe(true);
    expect(refundOpen(now, 'LBC', now + 20 * 60)).toBe(true);
  });
});

describe('Bitcoin through several explorers', () => {
  const funding = (height: number, value = 500_000): EsploraTx => ({
    txid: 'aa'.repeat(32),
    vin: [],
    vout: [{ scriptpubkey: `a914${'00'.repeat(20)}87`, value }],
    status: height > 0 ? { confirmed: true, block_height: height } : { confirmed: false },
  });
  const theirClaim: EsploraTx = { txid: 'bb'.repeat(32), vin: [{ txid: 'aa'.repeat(32), vout: 0, scriptsig: '00' }], vout: [], status: { confirmed: false } };
  /** Explorers answering an address lookup with fixed lists. */
  const explorers = (answers: Record<string, EsploraTx[]>) => {
    const http: EsploraHttp = {
      getJson: async (url) => answers[Object.keys(answers).find((base) => url.startsWith(base))!],
      postText: async () => {
        throw new Error('read-only');
      },
    };
    const [first, ...others] = Object.keys(answers).map((base) => new EsploraClient(base, http));
    return esploraSwapChain(first!, others);
  };
  const claim = { address: '3Contract', txid: 'aa'.repeat(32), vout: 0, value: 500_000n, height: 100 };

  it('sees a transaction that one explorer hides', async () => {
    const chain = explorers({ 'https://a.example/api': [funding(100)], 'https://b.example/api': [theirClaim, funding(100)] });
    expect((await chain.addressTxs('3Contract')).map((t) => t.txid).sort()).toEqual(['aa'.repeat(32), 'bb'.repeat(32)]);
  });

  it('counts a payment as unconfirmed while any explorer says so', async () => {
    const chain = explorers({ 'https://a.example/api': [funding(100)], 'https://b.example/api': [funding(0)] });
    expect((await chain.addressTxs('3Contract'))[0]!.height).toBe(0);
  });

  it('trusts the other side\'s payment only when every explorer reports it the same way', async () => {
    expect(await explorers({ 'https://a.example/api': [funding(100)], 'https://b.example/api': [funding(100)] }).verifyFunding(claim)).toEqual({ ok: true });
    expect(await explorers({ 'https://a.example/api': [funding(100)], 'https://b.example/api': [funding(101)] }).verifyFunding(claim)).toMatchObject({ ok: false, reason: 'disagreement' });
    expect(await explorers({ 'https://a.example/api': [funding(100, 400_000)], 'https://b.example/api': [funding(100)] }).verifyFunding(claim)).toMatchObject({ ok: false, reason: 'disagreement' });
    expect(await explorers({ 'https://a.example/api': [funding(100)], 'https://b.example/api': [] }).verifyFunding(claim)).toMatchObject({ ok: false, reason: 'unconfirmed' });
  });
});
