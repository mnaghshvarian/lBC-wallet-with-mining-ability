import { describe, expect, it } from 'vitest';
import {
  BITCOIN_NETWORKS,
  REGTEST,
  encodeSegwitAddress,
  encodeSwapCode,
  fromHex,
  hash160,
  htlcAddress,
  htlcOutputScript,
  htlcScript,
  p2pkhAddress,
  publicKeyOf,
  type SwapChain,
  type SwapRecord,
  type SwapTiming,
  type SwapTx,
  type Transaction,
} from '@lbcwallet/core';
import { SettingsStore, SwapService, memoryFiles, type Platform, type SwapWallet } from '../src/index';

const TIMING: SwapTiming = { joinerLock: 900, starterLock: 400, starterMinRemaining: 600, lockGap: 120, claimMargin: 60, clockLag: { LBC: 0, BTC: 0 } };
const LBC_AMOUNT = 1_500_000_000n;
const BTC_AMOUNT = 500_000n;
const keyOf = (seed: number) => new Uint8Array(32).fill(seed);
const pkhOf = (seed: number) => hash160(publicKeyOf(keyOf(seed)));

/** A chain that reports whatever the test puts into it, the way a server (honest or not) would. */
class FakeChain implements SwapChain {
  readonly server = 'test server';
  tip = 1_000;
  readonly broadcasts: Transaction[] = [];
  private readonly byAddress = new Map<string, SwapTx[]>();

  constructor(readonly coin: 'LBC' | 'BTC') {}

  add(address: string, tx: SwapTx): void {
    this.byAddress.set(address, [...(this.byAddress.get(address) ?? []), tx]);
  }

  async tipHeight() {
    return this.tip;
  }
  async addressTxs(address: string) {
    return this.byAddress.get(address) ?? [];
  }
  async broadcast(tx: Transaction) {
    this.broadcasts.push(tx);
    return tx.txid;
  }
  async feeRate() {
    return this.coin === 'BTC' ? 2 : 100;
  }
  async verifyFunding() {
    return true;
  }
}

/** A forged transaction "spending" an outpoint without the secret or a valid signature. */
const forgedSpend = (txid: string, vout: number): SwapTx => ({ txid: 'f0'.repeat(32), height: 0, inputs: [{ txid, vout, scriptSig: new Uint8Array([0x00]), witness: [] }], outputs: [] });

/** Bob joins Alice's invite (she gives LBC, he gives Bitcoin) and pays his Bitcoin contract. */
async function bobLocked() {
  let clock = Date.parse('2026-10-18T00:00:00Z');
  const lbc = new FakeChain('LBC');
  const btc = new FakeChain('BTC');
  let stored: SwapRecord[] = [];
  const wallet: SwapWallet = {
    network: 'regtest',
    watchOnly: false,
    records: () => stored,
    saveRecords: (records) => (stored = records),
    receiveAddress: () => p2pkhAddress(pkhOf(3), REGTEST),
    lbc,
    pay: async () => {
      throw new Error('Bob pays his Bitcoin from another wallet');
    },
  };
  const platform: Platform = {
    kind: 'desktop',
    clientName: 'test',
    files: memoryFiles(),
    log: () => undefined,
    lineTransport: () => {
      throw new Error('no network in this test');
    },
    fetchJson: async () => null,
    cpuCount: 2,
  };
  const settings = new SettingsStore(memoryFiles(), 2);
  settings.update({ network: 'regtest' });
  const swaps = new SwapService(platform, settings, { wallet: () => wallet, changed: () => undefined, notice: () => undefined, bitcoin: () => btc, now: () => clock, timing: TIMING });

  const invite = encodeSwapCode({ type: 'invite', network: 'regtest', id: '0123456789abcdef', starterGives: 'LBC', lbc: LBC_AMOUNT, btc: BTC_AMOUNT, starterPkh: pkhOf(5) });
  const joined = swaps.join({ code: invite, btcAddress: encodeSegwitAddress(0, pkhOf(4), BITCOIN_NETWORKS.regtest) });
  const pay = await swaps.lock({ id: joined.id });
  expect(pay.stage).toBe('pay-btc');
  const record = () => stored.find((r) => r.id === joined.id)!;
  const funding: SwapTx = { txid: 'aa'.repeat(32), height: btc.tip - 5, inputs: [], outputs: [{ value: BTC_AMOUNT, script: htlcOutputScript(fromHex(record().ours!.contract)) }] };
  btc.add(pay.ours!.address, funding);
  await swaps.poll();
  expect(swaps.list()[0]!.stage).toBe('send-lock');
  return {
    swaps,
    lbc,
    btc,
    record,
    funding,
    ourAddress: pay.ours!.address,
    setClock: (ms: number) => (clock = ms),
    nowSeconds: () => Math.floor(clock / 1000),
  };
}

describe('swap engine against a dishonest server', () => {
  it('still refunds when a server reports a spend of its contract that does not carry the secret', async () => {
    const s = await bobLocked();
    s.btc.add(s.ourAddress, forgedSpend(s.funding.txid, 0));
    s.setClock((s.record().ours!.locktime + 1) * 1000);
    await s.swaps.poll();
    const view = s.swaps.list()[0]!;
    expect(view.refundTxid).toBeDefined();
    expect(s.btc.broadcasts.at(-1)!.inputs[0]).toMatchObject({ txid: s.funding.txid, vout: 0 });
  });

  it('still collects when a server reports a spend of their contract before its lock time', async () => {
    const s = await bobLocked();
    const r = s.record();
    // Alice's honest LBC contract: pays Bob's key with his secret hash, ends well before his.
    const contract = htlcScript({ secretHash: fromHex(r.secretHash!), recipientPkh: hash160(publicKeyOf(fromHex(r.getKey))), refundPkh: pkhOf(6), locktime: s.nowSeconds() + 400 });
    const address = htlcAddress(contract, REGTEST);
    const funding: SwapTx = { txid: 'cc'.repeat(32), height: s.lbc.tip - 20, inputs: [], outputs: [{ value: LBC_AMOUNT, script: htlcOutputScript(contract) }] };
    s.lbc.add(address, funding);
    s.lbc.add(address, forgedSpend(funding.txid, 0));
    s.swaps.accept({ code: encodeSwapCode({ type: 'lock', network: 'regtest', id: r.id, coin: 'LBC', contract, txid: funding.txid, vout: 0 }) });
    await s.swaps.poll();
    await s.swaps.poll();
    const view = s.swaps.list()[0]!;
    expect(view.claimTxid).toBeDefined();
    expect(s.lbc.broadcasts.at(-1)!.inputs[0]).toMatchObject({ txid: funding.txid, vout: 0 });
  });
});
