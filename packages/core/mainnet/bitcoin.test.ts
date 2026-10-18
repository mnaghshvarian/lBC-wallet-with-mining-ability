/**
 * Mainnet check of the Bitcoin side of swaps, read-only: the two public
 * Esplora servers the wallet uses by default (DEFAULT_BTC_EXPLORERS in
 * @lbcwallet/services) answer every call a swap makes, agree on the chain, and
 * the cross-check that guards the other side's funding accepts a real
 * confirmed payment and rejects a payment that does not match.
 *
 *   npm run test:mainnet -w @lbcwallet/core       (needs internet access)
 */
import { describe, expect, it } from 'vitest';
import { addressToScript } from '../src/address.js';
import { toHex } from '../src/encoding/bytes.js';
import { EsploraClient, type EsploraHttp } from '../src/net/esplora.js';
import { esploraSwapChain, type FundingClaim } from '../src/swap/chain.js';
import { BITCOIN_NETWORKS } from '../src/swap/protocol.js';

const PRIMARY = 'https://blockstream.info/api';
const CROSS_CHECK = 'https://mempool.space/api';
// The address of Bitcoin's genesis block reward: people still send it small payments.
const BUSY_ADDRESS = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

const http: EsploraHttp = {
  async getJson(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  },
  async postText() {
    throw new Error('read-only test');
  },
};

describe('Bitcoin explorers for swaps (mainnet, read-only)', () => {
  const primary = new EsploraClient(PRIMARY, http);
  const crossCheck = new EsploraClient(CROSS_CHECK, http);

  it('both explorers answer and agree on the chain tip', async () => {
    const [a, b] = await Promise.all([primary.tipHeight(), crossCheck.tipHeight()]);
    console.log(`Bitcoin tip: ${PRIMARY} #${a}, ${CROSS_CHECK} #${b}`);
    expect(a).toBeGreaterThan(900_000);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(3);
  }, 60_000);

  it('gives a usable fee rate', async () => {
    for (const c of [primary, crossCheck]) {
      const rate = await c.feeRate(2);
      console.log(`${c.server}: ${rate} sat/vB for the next blocks`);
      expect(Number.isInteger(rate)).toBe(true);
      expect(rate).toBeGreaterThanOrEqual(1);
      expect(rate).toBeLessThan(5_000);
    }
  }, 60_000);

  it('reads address history, and the funding cross-check accepts a real payment and rejects a wrong one', async () => {
    const chain = esploraSwapChain(primary, [crossCheck]);
    const tip = await chain.tipHeight();
    const script = toHex(addressToScript(BUSY_ADDRESS, BITCOIN_NETWORKS.mainnet));
    const txs = await chain.addressTxs(BUSY_ADDRESS);
    expect(txs.length).toBeGreaterThan(0);
    // A payment with a few confirmations, so both servers have it.
    let claim: FundingClaim | null = null;
    for (const tx of txs) {
      const vout = tx.outputs.findIndex((o) => toHex(o.script) === script);
      if (tx.height > 0 && tx.height <= tip - 3 && vout >= 0) {
        claim = { address: BUSY_ADDRESS, txid: tx.txid, vout, value: tx.outputs[vout]!.value, height: tx.height };
        break;
      }
    }
    expect(claim, 'no confirmed payment to the address in the first page of its history').not.toBeNull();
    console.log(`checking payment ${claim!.txid}:${claim!.vout} (${claim!.value} sat at #${claim!.height}) on both servers`);
    expect(await chain.verifyFunding(claim!)).toBe(true);
    expect(await chain.verifyFunding({ ...claim!, value: claim!.value + 1n })).toBe(false);
    expect(await chain.verifyFunding({ ...claim!, height: claim!.height + 1 })).toBe(false);
    expect(await chain.verifyFunding({ ...claim!, txid: '00'.repeat(32) })).toBe(false);
  }, 120_000);
});
