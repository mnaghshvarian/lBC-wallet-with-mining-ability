import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lbcdAvailable, startRegtest, waitFor, type RegtestNode } from './harness.js';
import { startTestPool, type TestPool } from './test-pool.js';
import { REGTEST } from '../src/networks.js';
import { AddressDeriver, deriveAccountKey, derivePrivateKey, publicOnly } from '../src/keys/hd.js';
import { addressToScript } from '../src/address.js';
import { InProcessThreads, MinerCoordinator } from '../src/mining/coordinator.js';
import { nodeLineTransport } from '../src/node/index.js';
import { LbcdBackend } from '../src/net/lbcd.js';
import { WalletEngine } from '../src/wallet/engine.js';
import { emptyWalletState } from '../src/wallet/types.js';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe.skipIf(!lbcdAvailable())('mining against lbcd regtest', () => {
  let node: RegtestNode;
  const account = deriveAccountKey(PHRASE, 'bip44', REGTEST);
  const deriver = new AddressDeriver(publicOnly(account, REGTEST), REGTEST);
  const payout = deriver.derive(0, 2).address;

  beforeAll(async () => {
    node = await startRegtest(deriver.derive(0, 0).address);
    await node.generate(101);
  }, 60_000);

  afterAll(async () => {
    await node?.stop();
  });

  it('solo-mines blocks (including mempool transactions) that lbcd accepts', async () => {
    // Put a transaction in the mempool so the template is non-trivial.
    const engine = new WalletEngine({ network: REGTEST, deriver, backend: new LbcdBackend(node.rpc, REGTEST, { pollIntervalMs: 200 }), state: emptyWalletState(), persist: () => undefined });
    await engine.start();
    const draft = engine.createPayment({ address: deriver.derive(0, 9).address, amount: 50_000_000n });
    const txid = await engine.broadcast(engine.sign(draft, (c, i) => derivePrivateKey(account, c, i)));

    const before = await node.rpc.call<number>('getblockcount');
    const threads = await InProcessThreads.create(2);
    const miner = new MinerCoordinator(threads);
    const blocks: { accepted: boolean; reason?: string }[] = [];
    miner.on('block', (b) => blocks.push(b));
    await miner.startSolo(node.rpc, addressToScript(payout, REGTEST));
    try {
      await waitFor(() => miner.stats.blocksFound, (n) => n >= 3, 30_000, 'three solo blocks');
    } finally {
      await miner.stop();
      await threads.destroy();
    }
    expect(blocks.every((b) => b.accepted)).toBe(true);
    const after = await node.rpc.call<number>('getblockcount');
    expect(after - before).toBeGreaterThanOrEqual(3);

    // the mempool transaction got mined, and the rewards are ours
    const tx = await node.rpc.call<{ confirmations?: number }>('getrawtransaction', [txid, 1]);
    expect(tx.confirmations).toBeGreaterThan(0);
    await waitFor(() => engine.getTransactions().filter((t) => t.type === 'mining' && t.height > before).length, (n) => n >= 3, 20_000, 'rewards in wallet');
    expect(engine.getBalance().immature).toBeGreaterThanOrEqual(3n * 100_000_000n);
    await engine.stop();
  }, 90_000);

  it('mines through a Stratum pool: shares accepted and blocks built by the pool are valid', async () => {
    const pool: TestPool = await startTestPool(node.rpc, addressToScript(payout, REGTEST), 0.002);
    const threads = await InProcessThreads.create(1);
    const miner = new MinerCoordinator(threads);
    const before = await node.rpc.call<number>('getblockcount');
    miner.startPool({
      endpoint: { host: '127.0.0.1', port: pool.port },
      username: payout,
      password: 'e2e-worker',
      agent: 'LBCWallet-e2e/1.0',
      transportFactory: (ep) => nodeLineTransport(ep),
    });
    try {
      await waitFor(() => miner.stats.accepted, (n) => n >= 5, 45_000, 'accepted shares');
      // Wait for the main chain, not the pool's count: two shares can solve the same job
      // before new work arrives, which makes two blocks at one height.
      await waitFor(() => node.rpc.call<number>('getblockcount'), (h) => h - before >= 2, 45_000, 'two pool blocks on the main chain');
    } finally {
      await miner.stop();
      await threads.destroy();
      await waitFor(() => pool.inFlight, (n) => n === 0, 10_000, 'pending block submissions');
      await pool.close();
    }
    expect(pool.rejectReasons.filter((r) => !/Job not found/.test(r))).toEqual([]);
    expect(miner.stats.accepted).toBeGreaterThanOrEqual(5);
    expect(pool.accepted).toBeGreaterThanOrEqual(miner.stats.accepted);
    expect(miner.stats.totalHashes).toBeGreaterThan(0);
    const after = await node.rpc.call<number>('getblockcount');
    // Several shares can solve the same (trivial regtest) job; extra blocks at the
    // same height are valid side-chain blocks. lbcd must know every one of them.
    expect(after - before).toBeGreaterThanOrEqual(2);
    expect(after - before).toBeLessThanOrEqual(pool.blocks.length);
    let mainChain = 0;
    for (const hash of pool.blocks) {
      try {
        await node.rpc.call('getblockheader', [hash, true]);
        mainChain++;
      } catch (err) {
        expect((err as Error).message).toMatch(/not in the main chain/);
      }
    }
    expect(mainChain).toBe(after - before);
  }, 120_000);
});
