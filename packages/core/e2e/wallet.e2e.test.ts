import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lbcdAvailable, startRegtest, waitFor, type RegtestNode } from './harness.js';
import { REGTEST, DEWIES_PER_LBC } from '../src/networks.js';
import { AddressDeriver, deriveAccountKey, derivePrivateKey, publicOnly } from '../src/keys/hd.js';
import { LbcdBackend } from '../src/net/lbcd.js';
import { WalletEngine } from '../src/wallet/engine.js';
import { emptyWalletState } from '../src/wallet/types.js';
import { addressToScript } from '../src/address.js';
import { OP, concatBytesForTest, pushData, supportScript } from './script-helpers.js';
import { assembleTransaction, selectCoins, signTransaction } from '../src/tx/builder.js';
import type { HDKey } from '@scure/bip32';

const PHRASE_A = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE_B = 'carbon smart garage balance margin twelve chest sword toast envelope bottom stomach absent';
const LBC = DEWIES_PER_LBC;

function makeWallet(account: HDKey, node: RegtestNode) {
  const deriver = new AddressDeriver(publicOnly(account, REGTEST), REGTEST);
  const backend = new LbcdBackend(node.rpc, REGTEST, { pollIntervalMs: 200 });
  const engine = new WalletEngine({ network: REGTEST, deriver, backend, state: emptyWalletState(), persist: () => undefined });
  return { engine, deriver, keys: (c: number, i: number) => derivePrivateKey(account, c, i) };
}

describe.skipIf(!lbcdAvailable())('wallet against lbcd regtest', () => {
  let node: RegtestNode;
  const accountA = deriveAccountKey(PHRASE_A, 'bip44', REGTEST);
  const accountB = deriveAccountKey(PHRASE_B, 'lbry', REGTEST);
  let A: ReturnType<typeof makeWallet>;
  let B: ReturnType<typeof makeWallet>;

  beforeAll(async () => {
    const minerAddress = new AddressDeriver(publicOnly(accountA, REGTEST), REGTEST).derive(0, 0).address;
    node = await startRegtest(minerAddress);
    await node.generate(110);
    A = makeWallet(accountA, node);
    B = makeWallet(accountB, node);
    await A.engine.start();
    await B.engine.start();
  }, 120_000);

  afterAll(async () => {
    await A?.engine.stop();
    await B?.engine.stop();
    await node?.stop();
  });

  it('syncs mined coins and applies coinbase maturity', () => {
    const balance = A.engine.getBalance();
    expect(balance.total).toBe(110n * LBC);
    // tip 110: coinbases at heights 1..11 have >= 100 confirmations
    expect(balance.available).toBe(11n * LBC);
    expect(balance.immature).toBe(99n * LBC);
    const txs = A.engine.getTransactions();
    expect(txs).toHaveLength(110);
    expect(txs.every((t) => t.type === 'mining')).toBe(true);
  });

  it('sends a payment that lbcd accepts, and the receiver sees it', async () => {
    const to = B.engine.getReceiveAddress();
    const draft = A.engine.createPayment({ address: to, amount: 25n * LBC / 10n, feePerByte: 50 });
    const tx = A.engine.sign(draft, A.keys);
    const txid = await A.engine.broadcast(tx);
    expect(txid).toBe(tx.txid);
    // spent immediately in the local view (no double-spend on a quick second send)
    expect(A.engine.getBalance().available).toBe(11n * LBC - draft.total);
    await node.generate(1);
    await waitFor(() => B.engine.getBalance().available, (v) => v === 25n * LBC / 10n, 20_000, 'receiver balance');
    const received = B.engine.getTransactions().find((t) => t.txid === txid)!;
    expect(received.type).toBe('receive');
    expect(received.amount).toBe(25n * LBC / 10n);
    const sent = await waitFor(() => A.engine.getTransactions().find((t) => t.txid === txid)!, (t) => t.confirmations === 1, 20_000, 'confirmation');
    expect(sent.type).toBe('send');
    expect(sent.amount).toBe(-draft.total);
    expect(sent.fee).toBe(draft.fee);
    expect(sent.counterparty).toBe(to);
  }, 60_000);

  it('creates a support (tip) and unlocks it again with a claim-prefixed signature', async () => {
    const ownAddress = A.deriver.derive(0, 5).address;
    const claimId = new Uint8Array(20).map((_, i) => i + 1);
    const script = supportScript('e2e-claim', claimId, addressToScript(ownAddress, REGTEST));
    const utxos = A.engine.spendableUtxos().map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, script: u.script, address: u.address, height: u.height }));
    const changeScript = addressToScript(A.deriver.derive(1, 7).address, REGTEST);
    const sel = selectCoins(utxos, [{ script, value: 3n * LBC }], changeScript, 50);
    const payment = assembleTransaction(sel.inputs, [{ script, value: 3n * LBC }], { script: changeScript, value: sel.change });
    const tx = signTransaction(payment, (u) => {
      const info = A.engine.addressInfo(u.address)!;
      return A.keys(info.chain, info.index);
    });
    await A.engine.broadcast(tx);
    await node.generate(1);
    expect(A.engine.getBalance().supports).toBe(3n * LBC); // visible immediately as pending
    const supportTx = await waitFor(() => A.engine.getTransactions().find((t) => t.txid === tx.txid), (t) => (t?.confirmations ?? 0) >= 1, 20_000, 'support confirmation');
    expect(supportTx!.type).toBe('support');

    const unlock = A.engine.createUnlockSupports(50);
    const signed = A.engine.sign(unlock, A.keys);
    await A.engine.broadcast(signed); // lbcd verifies the signature over the full claim script
    await node.generate(1);
    await waitFor(() => A.engine.getBalance().supports, (v) => v === 0n, 20_000, 'supports unlocked');
    const view = A.engine.getTransactions().find((t) => t.txid === signed.txid)!;
    expect(view.type).toBe('unlock');
    expect(view.amount).toBe(-unlock.fee);
  }, 60_000);

  it('reports claim outputs as locked, not spendable', async () => {
    const ownAddress = A.deriver.derive(0, 6).address;
    const name = new TextEncoder().encode('e2e-content');
    const claimScript = concatBytesForTest(
      new Uint8Array([OP.OP_CLAIM_NAME]),
      pushData(name),
      pushData(new Uint8Array([1, 2, 3, 4])),
      new Uint8Array([OP.OP_2DROP, OP.OP_DROP]),
      addressToScript(ownAddress, REGTEST),
    );
    const utxos = A.engine.spendableUtxos().map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, script: u.script, address: u.address, height: u.height }));
    const changeScript = addressToScript(A.deriver.derive(1, 8).address, REGTEST);
    const sel = selectCoins(utxos, [{ script: claimScript, value: LBC }], changeScript, 50);
    const payment = assembleTransaction(sel.inputs, [{ script: claimScript, value: LBC }], { script: changeScript, value: sel.change });
    const tx = signTransaction(payment, (u) => {
      const info = A.engine.addressInfo(u.address)!;
      return A.keys(info.chain, info.index);
    });
    await A.engine.broadcast(tx);
    await node.generate(1);
    await waitFor(() => A.engine.getTransactions().find((t) => t.txid === tx.txid), (t) => (t?.confirmations ?? 0) >= 1, 20_000, 'claim confirmation');
    expect(A.engine.getBalance().claims).toBe(LBC);
    expect(A.engine.getTransactions().find((t) => t.txid === tx.txid)?.type).toBe('claim');
    expect(A.engine.spendableUtxos().some((u) => u.kind !== 'standard')).toBe(false);
  }, 60_000);

  it('discovers funds beyond the first addresses via the gap limit on restore', async () => {
    const far = B.deriver.derive(0, 15).address;
    const farther = new AddressDeriver(publicOnly(accountB, REGTEST), REGTEST).derive(0, 30).address;
    for (const [address, amount] of [
      [far, LBC],
      [farther, 2n * LBC],
    ] as const) {
      const d = A.engine.createPayment({ address, amount, feePerByte: 50 });
      await A.engine.broadcast(A.engine.sign(d, A.keys));
      await node.generate(1);
    }
    const fresh = makeWallet(accountB, node);
    await fresh.engine.start();
    try {
      // index 15 is inside the first window of 20; index 30 is found only after extending past 15.
      expect(fresh.engine.getBalance().available).toBe(25n * LBC / 10n + 3n * LBC);
      expect(fresh.engine.isMine(farther)).toBe(true);
    } finally {
      await fresh.engine.stop();
    }
  }, 60_000);

  it('rejects overspending with a clear error', () => {
    expect(() => B.engine.createPayment({ address: A.engine.getReceiveAddress(), amount: 1_000_000n * LBC })).toThrow(/Insufficient funds/);
  });
});
