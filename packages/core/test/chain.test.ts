import { describe, expect, it } from 'vitest';
import { Emitter } from '../src/util/emitter';
import { ByteWriter, fromHex, hashFromHex, toHex } from '../src/encoding/bytes';
import { HEADER_SIZE, blockHash, checkProofOfWork } from '../src/crypto/pow';
import { merkleRoot } from '../src/wallet/verify';
import { EsploraClient, REGTEST, Transaction, backendSwapChain, esploraSwapChain, p2pkhScript, type EsploraHttp, type EsploraTx } from '../src/index';
import type { BackendEvents, BackendStatus, ChainBackend, ChainTip, FetchedTransaction, HistoryItem } from '../src/net/backend';

const START = 1_700_000_000;

/** A regtest header over `txids` on top of `prev` (internal-order hash) with valid proof of work. */
function mineHeader(prev: Uint8Array, txids: string[], time: number): string {
  for (let nonce = 0; ; nonce++) {
    const h = new ByteWriter(HEADER_SIZE).i32LE(1).bytes(prev).bytes(hashFromHex(merkleRoot(txids))).bytes(new Uint8Array(32)).u32LE(time).u32LE(REGTEST.powLimitBits).u32LE(nonce).toBytes();
    if (checkProofOfWork(h, REGTEST.powLimit)) return toHex(h);
  }
}

/** A chain of `n` regtest blocks; block `at` holds `txid` alone, the others a filler transaction. */
function chainWith(n: number, at: number, txid: string, filler = 'c0'.repeat(32)): string[] {
  const out: string[] = [];
  let prev: Uint8Array = new Uint8Array(32);
  for (let h = 0; h < n; h++) {
    const header = mineHeader(prev, [h === at ? txid : filler], START + h);
    out.push(header);
    prev = blockHash(fromHex(header));
  }
  return out;
}

/** A scripted hub for the swap chain: tests decide its headers, transactions and what a second hub says. */
class FakeHub extends Emitter<BackendEvents> implements ChainBackend {
  readonly kind = 'hub' as const;
  readonly untrusted = true;
  txs = new Map<string, FetchedTransaction>();
  /** What the second hub answers: its headers, null for "there is none", or an error. */
  other: string[] | null | Error;

  constructor(public headers: string[]) {
    super();
    this.other = headers;
  }
  get tip(): ChainTip {
    return { height: this.headers.length - 1, header: this.headers[this.headers.length - 1]! };
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  getStatus(): BackendStatus {
    return { connected: true, kind: 'hub', server: 'hub-a' };
  }
  async getTip(): Promise<ChainTip> {
    return this.tip;
  }
  async getHeaders(start: number, count: number): Promise<string[]> {
    return this.headers.slice(start, start + count);
  }
  async subscribeAddresses(addresses: string[]): Promise<(string | null)[]> {
    return addresses.map(() => null);
  }
  async getHistory(): Promise<HistoryItem[]> {
    return [];
  }
  async getTransactions(txids: string[]): Promise<Map<string, FetchedTransaction>> {
    return new Map(txids.filter((t) => this.txs.has(t)).map((t) => [t, this.txs.get(t)!]));
  }
  async broadcast(): Promise<string> {
    throw new Error('not supported');
  }
  async crossCheckHeaders(start: number, count: number): Promise<{ server: string; headers: string[] } | null> {
    if (this.other instanceof Error) throw this.other;
    if (!this.other) return null;
    return { server: 'hub-b', headers: this.other.slice(start, start + count) };
  }
}

describe('verifying a payment into an LBC contract through hubs', () => {
  const FUNDING_HEIGHT = 5;
  const payment = new Transaction();
  payment.inputs.push({ txid: 'ab'.repeat(32), vout: 0, scriptSig: new Uint8Array([0x51]), sequence: 0xffffffff, witness: [] });
  payment.outputs.push({ value: 1_000_000_000n, script: p2pkhScript(new Uint8Array(20).fill(7)) });
  const claim = { address: 'rContract', txid: payment.txid, vout: 0, value: 1_000_000_000n, height: FUNDING_HEIGHT };
  const honest = chainWith(20, FUNDING_HEIGHT, payment.txid);

  function hub(headers = honest): FakeHub {
    const h = new FakeHub(headers);
    h.txs.set(payment.txid, { hex: payment.toHex(), height: FUNDING_HEIGHT, merkle: { branch: [], pos: 0 } });
    return h;
  }
  const chainOf = (h: FakeHub) => backendSwapChain({ backend: () => h, network: REGTEST, tip: () => h.tip, feeRate: () => 100, broadcast: async () => '', now: () => START + 100 });

  it('accepts a payment whose block links up to the tip and that a second hub knows', async () => {
    expect(await chainOf(hub()).verifyFunding(claim)).toEqual({ ok: true });
  });

  it('refuses a forged block that carries the payment but is not part of the chain', async () => {
    // The lying hub's block has valid proof of work and a merkle proof for the payment, but the next
    // real block does not build on it.
    const forged = [...honest];
    forged[FUNDING_HEIGHT] = mineHeader(new Uint8Array(32).fill(9), [payment.txid], START + FUNDING_HEIGHT);
    const h = hub(forged);
    h.other = honest;
    expect(await chainOf(h).verifyFunding(claim)).toMatchObject({ ok: false, reason: 'bad-chain', detail: expect.stringMatching(/block 5 does not follow block 4/) });
  });

  it('refuses a payment the second hub does not have in that block', async () => {
    const h = hub();
    h.other = chainWith(20, FUNDING_HEIGHT, 'dd'.repeat(32));
    expect(await chainOf(h).verifyFunding(claim)).toMatchObject({ ok: false, reason: 'disagreement', detail: expect.stringMatching(/hub-b reports a different block at height 5/) });
  });

  it('waits while the second hub has not seen every confirming block', async () => {
    const h = hub();
    h.other = honest.slice(0, FUNDING_HEIGHT + 6);
    expect(await chainOf(h).verifyFunding(claim)).toMatchObject({ ok: false, reason: 'unconfirmed' });
  });

  it('takes a single configured hub at its word, with a warning, and says when the second could not be asked', async () => {
    const alone = hub();
    alone.other = null;
    const warnings: string[] = [];
    const chain = backendSwapChain({ backend: () => alone, network: REGTEST, tip: () => alone.tip, feeRate: () => 100, broadcast: async () => '', now: () => START + 100, log: (level, m) => level === 'warn' && warnings.push(m) });
    expect(await chain.verifyFunding(claim)).toEqual({ ok: true });
    expect(warnings).toEqual([expect.stringMatching(/only one hub is configured/)]);
    const unreachable = hub();
    unreachable.other = new Error('connect timeout');
    expect(await chainOf(unreachable).verifyFunding(claim)).toMatchObject({ ok: false, reason: 'cross-check-failed', detail: 'connect timeout' });
    const noWay = hub();
    Object.defineProperty(noWay, 'crossCheckHeaders', { value: undefined });
    expect(await chainOf(noWay).verifyFunding(claim)).toMatchObject({ ok: false, reason: 'single-server' });
  });

  it('refuses a transaction the hub swapped for another, and waits for confirmations and headers', async () => {
    const swapped = hub();
    swapped.txs.set(payment.txid, { hex: payment.toHex().replace(/0{8}$/, '00000001'), height: FUNDING_HEIGHT, merkle: { branch: [], pos: 0 } });
    expect(await chainOf(swapped).verifyFunding(claim)).toMatchObject({ ok: false, reason: 'mismatch' });
    const tooNew = hub();
    expect(await chainOf(tooNew).verifyFunding({ ...claim, height: 25 })).toMatchObject({ ok: false, reason: 'unconfirmed' });
    const noProof = hub();
    noProof.txs.set(payment.txid, { hex: payment.toHex(), height: FUNDING_HEIGHT });
    expect(await chainOf(noProof).verifyFunding(claim)).toMatchObject({ ok: false, reason: 'unconfirmed' });
    const short = hub();
    short.getHeaders = async () => honest.slice(0, 10);
    expect(await chainOf(short).verifyFunding(claim)).toMatchObject({ ok: false, reason: 'unconfirmed' });
  });

  it('trusts the user\'s own node', async () => {
    const own = hub();
    Object.defineProperty(own, 'untrusted', { value: false });
    expect(await chainOf(own).verifyFunding(claim)).toEqual({ ok: true });
  });
});

describe('Bitcoin explorers that fail or disagree', () => {
  type Answers = { tip?: number; fees?: Record<string, number>; txs?: unknown[]; down?: boolean };
  /** Explorers answering from fixed data; `down` ones throw. */
  const explorers = (servers: Record<string, Answers>) => {
    const http: EsploraHttp = {
      getJson: async (url) => {
        const base = Object.keys(servers).find((b) => url.startsWith(b))!;
        const a = servers[base]!;
        if (a.down) throw new Error('503 from ' + base);
        if (url.endsWith('/blocks/tip/height')) return a.tip;
        if (url.endsWith('/fee-estimates')) return a.fees;
        return a.txs;
      },
      postText: async () => {
        throw new Error('read-only');
      },
    };
    const [first, ...others] = Object.keys(servers).map((b) => new EsploraClient(b, http));
    return { chain: esploraSwapChain(first!, others), servers };
  };

  it('takes the tip from whichever explorers answer, and keeps the last one when none does', async () => {
    const { chain, servers } = explorers({ 'https://a.example/api': { down: true }, 'https://b.example/api': { tip: 100 }, 'https://c.example/api': { tip: 101 } });
    expect(await chain.tipHeight()).toBe(101);
    servers['https://b.example/api']!.down = true;
    servers['https://c.example/api']!.down = true;
    expect(await chain.tipHeight()).toBe(101);
    await expect(explorers({ 'https://a.example/api': { down: true } }).chain.tipHeight()).rejects.toThrow(/503/);
  });

  it('uses the median fee estimate, so one absurd estimate does not set the fee', async () => {
    const { chain } = explorers({
      'https://a.example/api': { fees: { '2': 2000 } },
      'https://b.example/api': { fees: { '2': 5 } },
      'https://c.example/api': { fees: { '2': 7 } },
    });
    expect(await chain.feeRate()).toBe(7);
    const { chain: twoLeft } = explorers({ 'https://a.example/api': { down: true }, 'https://b.example/api': { fees: { '2': 5 } }, 'https://c.example/api': { fees: { '2': 7 } } });
    expect(await twoLeft.feeRate()).toBe(5);
  });

  it('skips one malformed transaction from one explorer instead of stopping', async () => {
    const good: EsploraTx = { txid: 'aa'.repeat(32), vin: [], vout: [{ scriptpubkey: '51', value: 1000 }], status: { confirmed: false } };
    const bad = { txid: 'bb'.repeat(32), vin: [], vout: [{ scriptpubkey: '51', value: 1.5 }], status: { confirmed: false } };
    const { chain } = explorers({ 'https://a.example/api': { txs: [bad, good] }, 'https://b.example/api': { txs: [good] } });
    expect((await chain.addressTxs('3Contract')).map((t) => t.txid)).toEqual(['aa'.repeat(32)]);
  });
});
