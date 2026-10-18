/**
 * Mainnet smoke test: checks the wallet's network code against the real LBC
 * network without mining or spending anything.
 *
 *   npm run test:mainnet -w @lbcwallet/core       (needs internet access)
 *
 * - every default hub answers, and they agree on the chain tip;
 * - headers from the hubs link up and carry valid LBRY proof of work, and the
 *   genesis block is LBRY's;
 * - a real transaction's merkle proof checks out against its block header (the
 *   same SPV check the wallet runs for every confirmation);
 * - address history lookups work;
 * - LBRYPool accepts a Stratum login and sends work for the current chain tip
 *   (no hashing, no shares submitted).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAINNET } from '../src/networks.js';
import { HubBackend, probeHub } from '../src/net/hub.js';
import { LineRpcClient } from '../src/net/line-rpc.js';
import { nodeLineTransport } from '../src/node/index.js';
import { checkProofOfWork, parseHeader } from '../src/crypto/pow.js';
import { concatBytes, fromHex, toHex } from '../src/encoding/bytes.js';
import { verifyTransactionInclusion } from '../src/wallet/verify.js';
import { Transaction } from '../src/tx/transaction.js';
import { scriptToAddress } from '../src/address.js';
import { parseLbryNotify } from '../src/mining/work.js';
import { AddressDeriver, deriveAccountKey, publicOnly } from '../src/keys/hd.js';
import type { ChainTip } from '../src/net/backend.js';

const CLIENT = 'LBC Wallet mainnet smoke test';
const transportFactory = (ep: { host: string; port: number; tls?: boolean }) => nodeLineTransport(ep, { connectTimeoutMs: 10_000 });
const reversedHex = (bytes: Uint8Array) => Buffer.from(bytes).reverse().toString('hex');

describe('LBC mainnet (read-only)', () => {
  let backend: HubBackend;
  let tip: ChainTip;
  let poolPayout: string | null = null;

  beforeAll(async () => {
    backend = new HubBackend({ servers: MAINNET.defaultHubs, transportFactory, network: MAINNET, clientName: CLIENT });
    await backend.start();
    tip = await backend.getTip();
  }, 60_000);

  afterAll(async () => {
    await backend?.stop();
  });

  it('reaches the default hubs, which agree on the chain tip', async () => {
    const results = await Promise.all(MAINNET.defaultHubs.map((h) => probeHub(h, transportFactory, MAINNET, CLIENT)));
    const ok = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok);
    for (const [i, r] of results.entries()) console.log(`${MAINNET.defaultHubs[i]!.host}:${MAINNET.defaultHubs[i]!.port} → ${r.ok ? `#${r.height} in ${r.latencyMs} ms (${r.version})` : r.error}`);
    expect(ok.length).toBeGreaterThanOrEqual(2);
    const heights = ok.map((r) => r.height);
    // Servers may lag a few blocks behind each other.
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(12);
    expect(tip.height).toBeGreaterThan(1_900_000);
  }, 60_000);

  it('serves LBRY genesis and a chain of recent headers with valid proof of work', async () => {
    const [genesis] = await backend.getHeaders(0, 1);
    expect(parseHeader(fromHex(genesis!)).hash).toBe(MAINNET.genesisHash);

    const start = tip.height - 99;
    const headers = await backend.getHeaders(start, 100);
    expect(headers).toHaveLength(100);
    for (let i = 0; i < headers.length; i++) {
      const raw = fromHex(headers[i]!);
      expect(checkProofOfWork(raw, MAINNET.powLimit), `PoW of block ${start + i}`).toBe(true);
      if (i > 0) expect(parseHeader(raw).prevHash, `link to block ${start + i - 1}`).toBe(parseHeader(fromHex(headers[i - 1]!)).hash);
    }
    // Blocks come about every 2.5 minutes: 100 blocks span hours, not weeks.
    const span = parseHeader(fromHex(headers[99]!)).timestamp - parseHeader(fromHex(headers[0]!)).timestamp;
    expect(span).toBeGreaterThan(60 * 60);
    expect(span).toBeLessThan(3 * 24 * 60 * 60);
  }, 60_000);

  it('serves real transactions that match the headers (SPV) and the address index', async () => {
    // LBRY's first blocks hold only their coinbase, so the header's merkle root is that transaction's id.
    for (const height of [1, 2, 3]) {
      const [headerHex] = await backend.getHeaders(height, 1);
      const txid = parseHeader(fromHex(headerHex!)).merkleRoot;
      const fetched = (await backend.getTransactions([txid])).get(txid);
      expect(fetched, `coinbase of block ${height}`).toBeDefined();
      const tx = Transaction.fromHex(fetched!.hex);
      expect(tx.txid).toBe(txid);
      if (fetched!.merkle) expect(verifyTransactionInclusion(txid, fetched!.merkle, headerHex!, height, MAINNET, tip)).toMatchObject({ ok: true });
      const address = tx.outputs.map((o) => scriptToAddress(o.script, MAINNET)).find((a): a is string => !!a);
      expect(address, `payout address of block ${height}`).toBeTruthy();
      expect((await backend.getHistory(address!)).some((h) => h.txid === txid)).toBe(true);
    }
  }, 120_000);

  it('gets mining work for the current chain from LBRYPool (login only, no hashing)', async () => {
    const address = new AddressDeriver(publicOnly(deriveAccountKey('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'bip44', MAINNET), MAINNET), MAINNET).derive(0, 0).address;
    const client = new LineRpcClient(transportFactory({ host: 'lbrypool.net', port: 3334 }), { jsonrpc2: false, defaultTimeoutMs: 20_000 });
    const job = new Promise<ReturnType<typeof parseLbryNotify>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no mining.notify within 60 s')), 60_000);
      client.onNotification((method, params) => {
        if (method !== 'mining.notify') return;
        clearTimeout(timer);
        try {
          resolve(parseLbryNotify(params));
        } catch (err) {
          reject(err);
        }
      });
    });
    try {
      await client.connect();
      const sub = await client.request<unknown[]>('mining.subscribe', ['LBCWallet-smoke/1.0']);
      // [subscriptions, extranonce1, extranonce2_size]
      expect(Array.isArray(sub)).toBe(true);
      expect(await client.request<boolean>('mining.authorize', [`${address}.smoke`, 'x'])).toBe(true);
      const work = await job;
      // The coinbase outputs (in coinb2) show where the pool collects block rewards.
      const extranonce = new Uint8Array(Number(sub[2] ?? 4) + String(sub[1] ?? '').length / 2);
      const coinbase = Transaction.fromHex(toHex(concatBytes(work.coinb1, extranonce, work.coinb2)));
      poolPayout = coinbase.outputs.map((o) => scriptToAddress(o.script, MAINNET)).find((x): x is string => !!x) ?? null;
      console.log(`pool coinbase pays to ${poolPayout}`);
      // The pool builds on the tip the hubs report (or a block newer than it).
      const latest = await backend.getTip();
      const recent = await backend.getHeaders(latest.height - 3, 4);
      const prev = reversedHex(work.prevHash);
      const known = recent.map((h) => parseHeader(fromHex(h)).hash);
      console.log(`pool job ${work.jobId} builds on ${prev} (hub tip #${latest.height} ${known[3]})`);
      expect(known.includes(prev) || work.ntime >= parseHeader(fromHex(latest.header)).timestamp).toBe(true);
      // Same difficulty regime as the chain (bits within a factor of 16).
      const tipBits = parseHeader(fromHex(latest.header)).bits;
      const ratio = Number(tipBits & 0xffffff) / Number(work.bits & 0xffffff) * 256 ** ((tipBits >>> 24) - (work.bits >>> 24));
      expect(ratio).toBeGreaterThan(1 / 16);
      expect(ratio).toBeLessThan(16);
    } finally {
      client.close();
    }
  }, 90_000);

  it('verifies merkle proofs of recent transactions with several transactions per block', async () => {
    // The payout address of LBRYPool (taken from its coinbase in the pool test) receives block rewards.
    if (!poolPayout) return console.log('no pool payout address; skipped');
    const history = (await backend.getHistory(poolPayout)).filter((h) => h.height > 0).slice(-5);
    console.log(`${poolPayout}: ${history.length} recent confirmed transactions`);
    if (history.length === 0) return;
    const fetched = await backend.getTransactions(history.map((h) => h.txid));
    let checked = 0;
    for (const h of history) {
      const t = fetched.get(h.txid);
      if (!t?.merkle) continue;
      const [headerHex] = await backend.getHeaders(h.height, 1);
      const result = verifyTransactionInclusion(h.txid, t.merkle, headerHex!, h.height, MAINNET, tip);
      console.log(`tx ${h.txid} in block ${h.height}: merkle branch of ${t.merkle.branch.length}, ${result.ok ? 'verified' : result.reason}`);
      expect(result).toMatchObject({ ok: true });
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);

});
