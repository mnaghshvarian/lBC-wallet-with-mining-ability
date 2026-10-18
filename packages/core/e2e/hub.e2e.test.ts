import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lbcdAvailable, startRegtest, waitFor, type RegtestNode } from './harness.js';
import { startRegtestHub, type RegtestHub } from './regtest-hub.js';
import { REGTEST, DEWIES_PER_LBC } from '../src/networks.js';
import { AddressDeriver, deriveAccountKey, derivePrivateKey, publicOnly } from '../src/keys/hd.js';
import { HubBackend, probeHub } from '../src/net/hub.js';
import { nodeLineTransport } from '../src/node/index.js';
import { WalletEngine } from '../src/wallet/engine.js';
import { emptyWalletState } from '../src/wallet/types.js';
import { createWalletFile, WalletSession } from '../src/wallet/keystore.js';
import { scanSchemes, chooseScheme } from '../src/wallet/restore.js';
import type { HDKey } from '@scure/bip32';

const PHRASE_A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE_B = 'carbon smart garage balance margin twelve chest sword toast envelope bottom stomach absent';
const LBC = DEWIES_PER_LBC;

describe.skipIf(!lbcdAvailable())('wallet over the Electrum hub protocol (TCP)', () => {
  let node: RegtestNode;
  let hub: RegtestHub;
  const accountA = deriveAccountKey(PHRASE_A, 'bip44', REGTEST);

  const backend = () =>
    new HubBackend({
      servers: [
        { host: '127.0.0.1', port: 1 }, // dead server first: exercises failover
        { host: '127.0.0.1', port: hub.port },
      ],
      transportFactory: (ep) => nodeLineTransport(ep, { connectTimeoutMs: 1000 }),
      network: REGTEST,
      clientName: 'LBC Wallet e2e',
    });

  function engineFor(account: HDKey) {
    return new WalletEngine({
      network: REGTEST,
      deriver: new AddressDeriver(publicOnly(account, REGTEST), REGTEST),
      backend: backend(),
      state: emptyWalletState(),
      persist: () => undefined,
    });
  }

  beforeAll(async () => {
    node = await startRegtest(new AddressDeriver(publicOnly(accountA, REGTEST), REGTEST).derive(0, 0).address);
    await node.generate(105);
    hub = await startRegtestHub(node.rpc, { pollMs: 150 });
  }, 60_000);

  afterAll(async () => {
    await hub?.close();
    await node?.stop();
  });

  it('probes a hub', async () => {
    const r = await probeHub({ host: '127.0.0.1', port: hub.port }, (ep) => nodeLineTransport(ep), REGTEST, 'probe');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.height).toBe(105);
  });

  it('syncs, SPV-verifies every confirmed transaction, and follows live notifications', async () => {
    const A = engineFor(accountA);
    await A.start();
    try {
      expect(A.getBalance().total).toBe(105n * LBC);
      const txs = A.getTransactions();
      expect(txs).toHaveLength(105);
      // every confirmed tx was checked against a PoW-valid header via its merkle proof
      expect(txs.every((t) => t.verified === true)).toBe(true);
      expect(txs.every((t) => t.time > 1_600_000_000)).toBe(true);

      // A new block arrives as a notification and updates confirmations/maturity.
      const availableBefore = A.getBalance().available;
      await node.generate(1);
      await waitFor(() => A.tipHeight, (h) => h === 106, 10_000, 'tip notification');
      await waitFor(() => A.getBalance().total, (t) => t === 106n * LBC, 10_000, 'new coinbase');
      expect(A.getBalance().available).toBe(availableBefore + LBC);
    } finally {
      await A.stop();
    }
  }, 60_000);

  it('sends through the hub and the receiver is notified (mempool, then confirmed)', async () => {
    const accountB = deriveAccountKey(PHRASE_B, 'lbry', REGTEST);
    const A = engineFor(accountA);
    const B = engineFor(accountB);
    await A.start();
    await B.start();
    try {
      const draft = A.createPayment({ address: B.getReceiveAddress(), amount: 3n * LBC });
      const txid = await A.broadcast(A.sign(draft, (c, i) => derivePrivateKey(accountA, c, i)));
      // the hub reports mempool history, so B sees it before it confirms
      await waitFor(() => B.getBalance().pending, (v) => v === 3n * LBC, 10_000, 'pending incoming');
      await node.generate(1);
      await waitFor(() => B.getBalance().available, (v) => v === 3n * LBC, 10_000, 'confirmed incoming');
      const view = await waitFor(() => B.getTransaction(txid), (t) => t?.verified === true, 10_000, 'SPV verification');
      expect(view!.outputs.some((o) => o.mine && o.value === 3n * LBC)).toBe(true);
    } finally {
      await A.stop();
      await B.stop();
    }
  }, 60_000);

  it('restores from a phrase by detecting which derivation scheme has funds', async () => {
    const b = backend();
    await b.start();
    try {
      const lbry = await scanSchemes(PHRASE_B, REGTEST, b);
      expect(lbry.map((r) => r.scheme)).toEqual(['lbry']); // not a BIP39 phrase (13 words, no checksum)
      expect(chooseScheme(lbry)).toBe('lbry');
      const bip = await scanSchemes(PHRASE_A, REGTEST, b);
      expect(chooseScheme(bip)).toBe('bip44');
      expect(bip.find((r) => r.scheme === 'bip44')!.usedAddresses).toBeGreaterThan(0);
      expect(bip.find((r) => r.scheme === 'lbry')!.usedAddresses).toBe(0);
    } finally {
      await b.stop();
    }
  }, 60_000);

  it('runs a full encrypted wallet session: create, unlock, sync, sign with password, change password', async () => {
    const file = await createWalletFile({
      name: 'E2E',
      network: 'regtest',
      source: { type: 'mnemonic', mnemonic: PHRASE_A, scheme: 'bip44' },
      password: 'first password',
      kdfCost: { N: 1 << 12, r: 8, p: 1 },
    });
    const session = await WalletSession.unlock(file, 'first password');
    expect(session.keysInMemory).toBe(false);
    const engine = new WalletEngine({ network: REGTEST, deriver: session.deriver, backend: backend(), state: session.state, persist: (s) => session.snapshot(s) });
    await engine.start();
    try {
      expect(engine.getBalance().total).toBeGreaterThan(0n);
      const draft = engine.createPayment({ address: engine.getReceiveAddress(), amount: LBC });
      await expect(session.keyProvider('wrong')).rejects.toThrow(/Incorrect password/);
      const keys = await session.keyProvider('first password');
      const tx = engine.sign(draft, keys.provider);
      keys.release();
      await engine.broadcast(tx);
      engine.flush();
      // state survives a lock/unlock cycle
      const saved = session.snapshot(engine.state);
      const changed = await session.changePassword('first password', 'second password', { N: 1 << 12, r: 8, p: 1 });
      const again = await WalletSession.unlock({ ...changed, state: saved.state }, 'second password');
      expect(Object.keys(again.state.txs)).toContain(tx.txid);
      await expect(WalletSession.unlock(changed, 'first password')).rejects.toThrow(/Incorrect password/);
      expect((await again.revealSecret('second password')).type).toBe('mnemonic');
    } finally {
      await engine.stop();
    }
  }, 60_000);
});
