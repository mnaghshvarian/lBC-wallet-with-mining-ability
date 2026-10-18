import { afterEach, describe, expect, it, vi } from 'vitest';
import { LbryScanner, simdSupported } from '../src/mining/scanner.js';
import { bitsToTarget, hashToBigInt, lbryPowHash } from '../src/crypto/pow.js';
import { ByteWriter, fromHex, hashFromHex, toHex, concatBytes } from '../src/encoding/bytes.js';
import { sha256d } from '../src/crypto/hash.js';
import { blockSubsidy, estimateEarnings, formatHashrate, issuedSupply, LAST_REWARD_HEIGHT, networkHashrateFromBits, nextRewardChange, supplyFacts, TOTAL_SUPPLY } from '../src/mining/economics.js';
import {
  assembleHeader,
  checkNonce,
  extranonce2For,
  hashesPerShare,
  parseLbryNotify,
  setNonce,
  shareTargetForDifficulty,
  stratumWork,
  submitParams,
  swapWords,
} from '../src/mining/work.js';
import { coinbaseMerkleBranch, merkleRoot, merkleRootFromBranch } from '../src/wallet/verify.js';
import { MAX_PENDING_SUBMITS, MAX_SHARE_DIFFICULTY, MIN_SHARE_DIFFICULTY, StratumClient } from '../src/mining/stratum.js';
import { MinerCoordinator, type HashThreads } from '../src/mining/coordinator.js';
import { LineRpcClient } from '../src/net/line-rpc.js';
import type { LineTransport, LineTransportFactory, SocketEndpoint } from '../src/net/transport.js';

const genesis = new ByteWriter(112)
  .i32LE(1)
  .bytes(new Uint8Array(32))
  .bytes(hashFromHex('b8211c82c3d15bcd78bba57005b86fed515149a53a425eb592c07af99fe559cc'))
  .bytes(hashFromHex('0000000000000000000000000000000000000000000000000000000000000001'))
  .u32LE(1446058291)
  .u32LE(0x1f00ffff)
  .u32LE(0)
  .toBytes();

describe.each(['simd', 'scalar'] as const)('WASM LBRY scanner (%s)', (flavor) => {
  it('matches the reference implementation for many nonces and headers', async () => {
    const scanner = await LbryScanner.create(flavor);
    expect(scanner.flavor).toBe(flavor);
    for (let trial = 0; trial < 5; trial++) {
      const header = genesis.slice();
      header[40] = trial; // vary the merkle root (first 64 bytes → midstate)
      header[90] = trial * 7; // vary the claimtrie (tail block)
      scanner.setWork(header, 0n);
      for (const nonce of [0, 1, 2, 255, 256, 65535, 1287, 0x7fffffff, 0xffffffff, 123456789]) {
        const h = header.slice();
        setNonce(h, nonce);
        expect(toHex(scanner.hash(nonce))).toBe(toHex(lbryPowHash(h)));
      }
    }
  });

  it('finds the genesis nonce at the genesis target', async () => {
    const scanner = await LbryScanner.create(flavor);
    scanner.setWork(genesis, bitsToTarget(0x1f00ffff));
    const r = scanner.scan(1200, 200);
    expect(r.found).toBe(true);
    // the first hit at or after 1200 must be genuine, and nonce 1287 is the actual genesis nonce
    const header = genesis.slice();
    setNonce(header, r.nonce!);
    expect(hashToBigInt(lbryPowHash(header)) <= bitsToTarget(0x1f00ffff)).toBe(true);
    expect(r.nonce! <= 1287).toBe(true);
    expect(toHex(r.hash!)).toBe(toHex(lbryPowHash(header)));
  });

  it('reports every hit in nonce order with the exact hash, for any slice length', async () => {
    const scanner = await LbryScanner.create(flavor);
    const header = genesis.slice();
    header[77] = 0x5a;
    const target = 1n << 252n; // about one hash in sixteen qualifies
    scanner.setWork(header, target);
    const expected: number[] = [];
    for (let n = 1000; n < 2200; n++) {
      setNonce(header, n);
      if (hashToBigInt(lbryPowHash(header)) <= target) expected.push(n);
    }
    const hits: number[] = [];
    let next = 1000;
    let step = 0;
    while (next < 2200) {
      const count = Math.min([1, 2, 3, 4, 5, 7, 8, 13, 64][step++ % 9]!, 2200 - next);
      const r = scanner.scan(next, count);
      if (r.found) {
        expect(r.hashes).toBe(r.nonce! - next + 1);
        setNonce(header, r.nonce!);
        expect(toHex(r.hash!)).toBe(toHex(lbryPowHash(header)));
        hits.push(r.nonce!);
      } else {
        expect(r.hashes).toBe(count);
      }
      next += r.hashes;
    }
    expect(expected.length).toBeGreaterThan(40);
    expect(hits).toEqual(expected);
  });

  it('reports no hit for an impossible target and counts hashes', async () => {
    const scanner = await LbryScanner.create(flavor);
    scanner.setWork(genesis, 1n);
    expect(scanner.scan(0, 5000)).toEqual({ hashes: 5000, found: false });
    expect(scanner.scan(0xffffffff - 6, 7)).toEqual({ hashes: 7, found: false });
  });

  it('runs fast enough to be useful (> 50 kH/s even on slow CI)', async () => {
    const scanner = await LbryScanner.create(flavor);
    scanner.setWork(genesis, 0n);
    scanner.scan(0, 20_000); // warm up (lets the engine tier up the module)
    const n = 200_000;
    const t = performance.now();
    scanner.scan(0, n);
    const seconds = (performance.now() - t) / 1000;
    const rate = n / seconds;
    console.log(`WASM scanner (${flavor}): ${formatHashrate(rate)} on one thread`);
    expect(rate).toBeGreaterThan(50_000);
  });
});

it('uses the SIMD scanner by default', async () => {
  expect(simdSupported()).toBe(true);
  expect((await LbryScanner.create()).flavor).toBe('simd');
});

describe('Stratum work (LBRY pools)', () => {
  // A notify built the way NOMP/yiimp build it from a getblocktemplate response.
  const template = {
    previousblockhash: '20e4102baa1503707a871b7ee97aa5bdd482f3f2c150c5f0a06234f9b85fd28c',
    claimtrie: '0000000000000000000000000000000000000000000000000000000000000001',
    version: 536870912,
    bits: '207fffff',
    curtime: 1792286924,
  };
  const coinb1 = fromHex('01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff1503');
  const coinb2 = fromHex('ffffffff0100e1f505000000001976a914000000000000000000000000000000000000000088ac00000000');
  const branchHex = ['11'.repeat(32), '22'.repeat(32)];

  /** NOMP util.reverseByteOrder: swap bytes within each word, then reverse the whole buffer. */
  function nompReverseByteOrder(hex: string): string {
    const b = fromHex(hex);
    const swapped = swapWords(b);
    return toHex(swapped.reverse());
  }

  const notify = [
    'job1',
    nompReverseByteOrder(template.previousblockhash),
    nompReverseByteOrder(template.claimtrie),
    toHex(coinb1),
    toHex(coinb2),
    branchHex,
    template.version.toString(16).padStart(8, '0'),
    template.bits,
    template.curtime.toString(16).padStart(8, '0'),
    true,
  ];

  /** Pool-side header reconstruction as in node-stratum-pool's LBRY serializeHeader. */
  function nompSerializeHeader(merkleRootDisplay: string, ntimeHex: string, nonceHex: string): Uint8Array {
    const parts = [
      nonceHex,
      template.bits,
      ntimeHex,
      template.claimtrie,
      merkleRootDisplay,
      template.previousblockhash,
      template.version.toString(16).padStart(8, '0'),
    ];
    return fromHex(parts.join('')).reverse();
  }

  it('parses mining.notify and builds the same header a pool reconstructs', () => {
    const job = parseLbryNotify(notify);
    expect(toHex(job.prevHash)).toBe(toHex(hashFromHex(template.previousblockhash)));
    expect(toHex(job.claimTrie)).toBe(toHex(hashFromHex(template.claimtrie)));
    expect(job.version).toBe(template.version);
    expect(job.bits).toBe(0x207fffff);

    const en1 = fromHex('f000000f');
    const en2 = extranonce2For(42n, 4);
    const work = stratumWork(job, en1, en2, shareTargetForDifficulty(1), bitsToTarget(job.bits));
    const nonce = 0x12345678;
    const [, jobId, en2Hex, ntimeHex, nonceHex] = submitParams('bAddr', work, nonce);
    expect(jobId).toBe('job1');

    // pool side: coinbase → merkle root (display order) → header
    const coinbaseHash = sha256d(concatBytes(coinb1, en1, fromHex(en2Hex), coinb2));
    let root = coinbaseHash;
    for (const b of branchHex) root = sha256d(concatBytes(root, fromHex(b)));
    const poolHeader = nompSerializeHeader(toHex(root.slice().reverse()), ntimeHex, nonceHex);

    const minerHeader = work.header.slice();
    setNonce(minerHeader, nonce);
    expect(toHex(minerHeader)).toBe(toHex(poolHeader));
  });

  it('uses the 256× LBRY difficulty multiplier for share targets', () => {
    expect(shareTargetForDifficulty(1)).toBe(0xffffn << 216n);
    expect(shareTargetForDifficulty(256)).toBe(0xffffn << 208n);
    expect(shareTargetForDifficulty(0.5)).toBe((0xffffn << 216n) * 2n);
    expect(Math.round(hashesPerShare(1) / 1e6)).toBe(17); // ≈ 2^24
  });

  it('rejects non-LBRY notify messages', () => {
    expect(() => parseLbryNotify(notify.filter((_, i) => i !== 2))).toThrow(/claimtrie/);
  });

  it('checkNonce agrees with the scanner', async () => {
    const job = parseLbryNotify(notify);
    const work = stratumWork(job, fromHex('00000000'), extranonce2For(1n, 4), shareTargetForDifficulty(0.0001), bitsToTarget(job.bits));
    const scanner = await LbryScanner.create();
    scanner.setWork(work.header, work.target);
    const r = scanner.scan(0, 2_000_000);
    expect(r.found).toBe(true);
    expect(checkNonce(work, r.nonce!).meetsShare).toBe(true);
  });
});

describe('merkle helpers', () => {
  const txids = ['aa', 'bb', 'cc', 'dd', 'ee'].map((c) => c.repeat(32));
  it('builds coinbase branches consistent with full merkle roots', () => {
    for (let n = 1; n <= txids.length; n++) {
      const all = txids.slice(0, n);
      const branch = coinbaseMerkleBranch(all.slice(1));
      let root = hashFromHex(all[0]!);
      for (const b of branch) root = sha256d(concatBytes(root, b));
      expect(toHex(root.slice().reverse())).toBe(merkleRoot(all));
    }
  });
  it('verifies electrum-style branches', () => {
    const all = txids;
    // branch for index 0 in display hex
    const branch = coinbaseMerkleBranch(all.slice(1)).map((b) => toHex(b.slice().reverse()));
    expect(merkleRootFromBranch(all[0]!, { branch, pos: 0 })).toBe(merkleRoot(all));
  });
});

describe('economics', () => {
  it('matches the lbcd subsidy schedule', () => {
    expect(blockSubsidy(0)).toBe(400_000_000n * 100_000_000n);
    expect(blockSubsidy(1)).toBe(100_000_000n);
    expect(blockSubsidy(5100)).toBe(100_000_000n);
    expect(blockSubsidy(5101)).toBe(2n * 100_000_000n);
    expect(blockSubsidy(55000)).toBe(500n * 100_000_000n);
    expect(blockSubsidy(55001)).toBe(500n * 100_000_000n);
    expect(blockSubsidy(55001 + 32)).toBe(499n * 100_000_000n);
    // height seen on the live network in October 2026
    expect(blockSubsidy(2_198_096)).toBe(135n * 100_000_000n);
  });

  it('adds up the supply: closed form equals the sum of every block reward', () => {
    const checkpoints = new Set([0, 1, 5100, 5101, 5200, 5201, 54_999, 55_000, 55_001, 55_032, 55_033, 1_000_000, 2_198_420, LAST_REWARD_HEIGHT, LAST_REWARD_HEIGHT + 1]);
    let sum = 0n;
    for (let h = 0; h <= LAST_REWARD_HEIGHT + 1; h++) {
      sum += blockSubsidy(h);
      if (checkpoints.has(h) || h % 100_003 === 0) expect(issuedSupply(h), `height ${h}`).toBe(sum);
    }
    expect(TOTAL_SUPPLY).toBe(sum);
    expect(TOTAL_SUPPLY).toBe(1_083_202_000n * 100_000_000n);
    expect(LAST_REWARD_HEIGHT).toBe(4_063_000);
    expect(blockSubsidy(LAST_REWARD_HEIGHT)).toBe(100_000_000n);
    expect(blockSubsidy(LAST_REWARD_HEIGHT + 1)).toBe(0n);
    expect(issuedSupply(-1)).toBe(0n);
  }, 30_000);

  it('finds the next change of the block reward', () => {
    expect(nextRewardChange(0)).toEqual({ height: 1, reward: 100_000_000n });
    expect(nextRewardChange(5000)).toEqual({ height: 5101, reward: 200_000_000n });
    // 500 LBC from block 54901 through the first reduction step
    expect(nextRewardChange(54_950)).toEqual({ height: 55_033, reward: 499n * 100_000_000n });
    expect(nextRewardChange(LAST_REWARD_HEIGHT)).toEqual({ height: LAST_REWARD_HEIGHT + 1, reward: 0n });
    expect(nextRewardChange(LAST_REWARD_HEIGHT + 1)).toBeNull();
    for (const h of [5101, 60_000, 777_777, 2_198_420, 3_999_999]) {
      const next = nextRewardChange(h)!;
      expect(blockSubsidy(next.height - 1)).toBe(blockSubsidy(h));
      expect(next.reward).not.toBe(blockSubsidy(h));
    }
  });

  it('reports the supply figures for the live network', () => {
    // newest block in October 2026
    const f = supplyFacts(2_198_420);
    expect(f.reward).toBe(135n * 100_000_000n);
    expect(f.issued).toBe(963_371_860n * 100_000_000n);
    expect(f.remaining).toBe(119_830_140n * 100_000_000n);
    expect(f.nextChange).toMatchObject({ height: 2_204_153, reward: 134n * 100_000_000n });
    expect(f.nextChange!.days).toBeCloseTo(9.95, 2);
    expect(f.daysToLastReward / 365.25).toBeCloseTo(8.86, 2);
    const end = supplyFacts(LAST_REWARD_HEIGHT);
    expect(end).toMatchObject({ reward: 0n, remaining: 0n, nextChange: null, daysToLastReward: 0 });
  });

  it('estimates earnings and formats hashrates', () => {
    const net = networkHashrateFromBits(0x1a0d5e53);
    expect(net).toBeGreaterThan(0);
    const e = estimateEarnings({ hashrate: 10e6, networkHashrate: 17e12, height: 2_198_096, poolFeePercent: 0.5 });
    expect(e.blockReward).toBe(135);
    expect(e.lbcPerDay).toBeCloseTo(((10e6 / 17e12) * 576 * 135 * 0.995), 6);
    expect(formatHashrate(1_234_567)).toBe('1.23 MH/s');
    expect(formatHashrate(0)).toBe('0 H/s');
  });

  it('assembles headers with the documented field offsets', () => {
    const header = assembleHeader({ version: 2, prevHash: new Uint8Array(32).fill(1), merkleRoot: new Uint8Array(32).fill(2), claimTrie: new Uint8Array(32).fill(3), time: 5, bits: 6, nonce: 7 });
    expect(header[0]).toBe(2);
    expect(header[4]).toBe(1);
    expect(header[36]).toBe(2);
    expect(header[68]).toBe(3);
    expect(header[100]).toBe(5);
    expect(header[104]).toBe(6);
    expect(header[108]).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Stratum client against an in-memory pool
// ---------------------------------------------------------------------------

interface FakePool {
  /** Endpoint of every connection attempt, in order. */
  connections: SocketEndpoint[];
  /** Whether the latest connection is open. */
  open: boolean;
  /** Params of every mining.submit received. */
  submits: unknown[];
  /** When false, submits stay unanswered until `answerSubmits` is called. */
  autoAnswer: boolean;
  /** Answers every submit still waiting. */
  answerSubmits(accepted: boolean): void;
  /** Sends a notification on the open connection. */
  notify(method: string, params: unknown): void;
  /** Sends a raw line on the open connection. */
  push(line: string): void;
  factory: LineTransportFactory;
}

/** A Stratum pool that answers subscribe / authorize / submit and lets a test push server messages. */
function fakePool(): FakePool {
  let onLine: (line: string) => void = () => {};
  let onClose: () => void = () => {};
  const waiting: number[] = [];
  const pool: FakePool = {
    connections: [],
    open: false,
    submits: [],
    autoAnswer: true,
    answerSubmits: (accepted) => {
      for (const id of waiting.splice(0)) pool.push(JSON.stringify({ id, result: accepted, error: null }));
    },
    notify: (method, params) => pool.push(JSON.stringify({ id: null, method, params })),
    push: (line) => {
      if (pool.open) onLine(line);
    },
    factory: (ep) => ({
      connect: async () => {
        pool.connections.push({ ...ep });
        pool.open = true;
      },
      send: (line) => {
        const { id, method, params } = JSON.parse(line) as { id: number; method: string; params: unknown };
        let result: unknown = true;
        if (method === 'mining.subscribe') result = [[['mining.set_difficulty', 'x'], ['mining.notify', 'x']], 'f000000f', 4];
        if (method === 'mining.submit') {
          pool.submits.push(params);
          if (!pool.autoAnswer) {
            waiting.push(id);
            return;
          }
        }
        queueMicrotask(() => pool.push(JSON.stringify({ id, result, error: null })));
      },
      close: () => {
        if (!pool.open) return;
        pool.open = false;
        onClose();
      },
      onLine: (h) => (onLine = h),
      onClose: (h) => (onClose = h),
    }),
  };
  return pool;
}

/** A valid LBRY mining.notify (an all-zero job is enough to build work from). */
const fakeNotify = ['j1', '00'.repeat(32), '00'.repeat(32), 'aa', 'bb', [], '20000000', '207fffff', '6ad2c9cc', true];

describe('Stratum client', () => {
  type LogLine = { level: string; message: string };
  const warnings = (log: LogLine[]) => log.filter((l) => l.level === 'warn').map((l) => l.message);
  const fakeTimers = () => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });

  const running: { stop(): Promise<void> }[] = [];
  afterEach(async () => {
    for (const r of running.splice(0)) {
      const stopping = r.stop();
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(60_000); // it may be sleeping out a reconnect delay
      await stopping;
    }
    vi.useRealTimers();
  });

  async function readyClient(pool: FakePool, endpoint: SocketEndpoint, log: LogLine[]): Promise<StratumClient> {
    const client = new StratumClient({ endpoint, username: 'bAddr.worker', password: 'x', agent: 'test/1.0', transportFactory: pool.factory, log: (level, message) => log.push({ level, message }) });
    running.push(client);
    const ready = new Promise<void>((resolve) => client.on('state', ({ state }) => state === 'ready' && resolve()));
    client.start();
    await ready;
    return client;
  }

  it('refuses client.reconnect to another host and follows a port change on the same host', async () => {
    fakeTimers();
    const pool = fakePool();
    const log: LogLine[] = [];
    const client = await readyClient(pool, { host: 'Pool.Example', port: 3333 }, log);
    const moves: SocketEndpoint[] = [];
    client.on('endpoint', (ep) => moves.push(ep));

    pool.notify('client.reconnect', ['evil.example', 4444, 0]);
    expect(pool.open).toBe(true);
    expect(client.state).toBe('ready');
    expect(moves).toEqual([]);
    expect(warnings(log)).toEqual([expect.stringContaining('evil.example')]);

    // the same host spelled differently, another port: accepted
    pool.notify('client.reconnect', ['pool.example', 4444, 0]);
    expect(pool.open).toBe(false);
    expect(moves).toEqual([{ host: 'Pool.Example', port: 4444 }]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.state).toBe('ready');
    expect(pool.connections).toEqual([{ host: 'Pool.Example', port: 3333 }, { host: 'Pool.Example', port: 4444 }]);

    // no host means this host
    pool.notify('client.reconnect', ['', 5555]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.state).toBe('ready');
    expect(pool.connections.at(-1)).toEqual({ host: 'Pool.Example', port: 5555 });
  });

  it('shows the pool port the miner moved to', async () => {
    fakeTimers();
    const pool = fakePool();
    const threads: HashThreads = { size: 1, assign() {}, idle() {}, destroy: async () => undefined, onHit() {}, onExhausted() {}, onHashes() {} };
    const miner = new MinerCoordinator(threads);
    running.push(miner);
    miner.startPool({ endpoint: { host: 'pool.example', port: 3333 }, username: 'bAddr', password: 'x', agent: 'test/1.0', transportFactory: pool.factory });
    await vi.advanceTimersByTimeAsync(10);
    expect(miner.stats.server).toBe('pool.example:3333');
    pool.notify('client.reconnect', ['evil.example', 4444]);
    expect(miner.stats.server).toBe('pool.example:3333');
    pool.notify('client.reconnect', [null, 4444]);
    expect(miner.stats.server).toBe('pool.example:4444');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pool.connections.at(-1)).toEqual({ host: 'pool.example', port: 4444 });
  });

  it('keeps the previous difficulty when mining.set_difficulty is unusable', async () => {
    const pool = fakePool();
    const log: LogLine[] = [];
    const client = await readyClient(pool, { host: 'pool.example', port: 3333 }, log);
    const jobs: { difficulty: number; shareTarget: bigint }[] = [];
    client.on('job', ({ difficulty, shareTarget }) => jobs.push({ difficulty, shareTarget }));
    const announced: number[] = [];
    client.on('difficulty', (d) => announced.push(d));

    pool.notify('mining.set_difficulty', [0.004]); // what the regtest pool uses
    pool.notify('mining.notify', fakeNotify);
    expect(jobs.map((j) => j.difficulty)).toEqual([0.004]);

    // JSON 1e400 parses as Infinity; 1e308 would make BigInt() throw on every later job
    const unusable = ['1e400', '-1e400', '0', '-1', '1e308', '1e-9', String(2 ** 41), 'null', '"x"', '[]', '{}'];
    for (const value of unusable) {
      pool.push(`{"id":null,"method":"mining.set_difficulty","params":[${value}]}`);
      pool.notify('mining.notify', fakeNotify);
    }
    expect(announced).toEqual([0.004]);
    expect(jobs.map((j) => j.difficulty)).toEqual(new Array(1 + unusable.length).fill(0.004));
    expect(client.difficulty).toBe(0.004);
    expect(warnings(log)).toHaveLength(unusable.length);
    expect(warnings(log)[0]).toMatch(/difficulty \(Infinity\); keeping 0.004/);

    // sane values, the bounds included, are applied (raising takes effect at once)
    pool.notify('mining.set_difficulty', [1]);
    expect(jobs.at(-1)!.difficulty).toBe(1);
    pool.notify('mining.set_difficulty', [MAX_SHARE_DIFFICULTY]);
    expect(jobs.at(-1)!.difficulty).toBe(MAX_SHARE_DIFFICULTY);
    pool.notify('mining.set_difficulty', [MIN_SHARE_DIFFICULTY]);
    pool.notify('mining.notify', fakeNotify);
    expect(jobs.at(-1)!.difficulty).toBe(MIN_SHARE_DIFFICULTY);
    expect(announced).toEqual([0.004, 1, MAX_SHARE_DIFFICULTY, MIN_SHARE_DIFFICULTY]);
    expect(warnings(log)).toHaveLength(unusable.length);
    for (const j of jobs) expect(j.shareTarget).toBe(shareTargetForDifficulty(j.difficulty));
  });

  it('drops hits while too many shares are waiting for the pool', async () => {
    const pool = fakePool();
    pool.autoAnswer = false;
    const log: LogLine[] = [];
    const client = await readyClient(pool, { host: 'pool.example', port: 3333 }, log);
    pool.notify('mining.notify', fakeNotify);
    const job = parseLbryNotify(fakeNotify);
    const work = stratumWork(job, client.extranonce1, extranonce2For(1n, 4), shareTargetForDifficulty(1), bitsToTarget(job.bits));
    const shares: boolean[] = [];
    client.on('share', ({ accepted }) => shares.push(accepted));

    const results = Array.from({ length: MAX_PENDING_SUBMITS + 10 }, (_, nonce) => client.submit(work, nonce));
    expect(pool.submits).toHaveLength(MAX_PENDING_SUBMITS);
    expect(warnings(log)).toEqual([expect.stringMatching(/waiting for the pool's answer; dropping further hits \(1 so far\)/)]);
    expect(await Promise.all(results.slice(MAX_PENDING_SUBMITS))).toEqual(new Array(10).fill(false));
    expect(shares).toEqual([]);

    // once the pool answers, submissions flow again
    pool.answerSubmits(true);
    expect(await Promise.all(results.slice(0, MAX_PENDING_SUBMITS))).toEqual(new Array(MAX_PENDING_SUBMITS).fill(true));
    expect(shares).toEqual(new Array(MAX_PENDING_SUBMITS).fill(true));
    pool.autoAnswer = true;
    expect(await client.submit(work, 999)).toBe(true);
    expect(pool.submits).toHaveLength(MAX_PENDING_SUBMITS + 1);
  });
});

describe('line RPC', () => {
  it('ignores JSON lines that are not messages instead of crashing the connection', async () => {
    let onLine: (line: string) => void = () => {};
    const transport: LineTransport = { connect: async () => undefined, send: () => undefined, close: () => undefined, onLine: (h) => (onLine = h), onClose: () => undefined };
    const warned: string[] = [];
    const client = new LineRpcClient(transport, { warn: (m) => warned.push(m) });
    const notifications: string[] = [];
    client.onNotification((method) => notifications.push(method));
    const reply = client.request('server.ping', [], 5_000);
    for (const line of ['null', '[null]', '42', '"hello"', 'true', '[]', '[[1]]', 'not json']) expect(() => onLine(line)).not.toThrow();
    expect(warned).toHaveLength(6); // [] carries no message, and garbage was always dropped silently
    expect(warned[0]).toContain('null');
    onLine(JSON.stringify({ id: null, method: 'note', params: [] }));
    onLine(JSON.stringify({ id: 1, result: 'pong' }));
    expect(notifications).toEqual(['note']);
    await expect(reply).resolves.toBe('pong');
  });
});
