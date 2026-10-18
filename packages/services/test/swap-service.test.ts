import { describe, expect, it } from 'vitest';
import {
  BITCOIN_NETWORKS,
  REGTEST,
  SWAP_CHAINS,
  buildHtlcSpend,
  encodeSegwitAddress,
  encodeSwapCode,
  fromHex,
  hash160,
  htlcAddress,
  htlcOutputScript,
  htlcScript,
  p2pkhAddress,
  p2pkhScript,
  publicKeyOf,
  secretHashOf,
  toHex,
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
  async feeRate(): Promise<number> {
    return this.coin === 'BTC' ? 2 : 100;
  }
  async verifyFunding() {
    return { ok: true as const };
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

/** Alice starts a swap (she gives LBC), takes Bob's Bitcoin lock code and locks her LBC. */
async function aliceLocked() {
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
    pay: async () => ({ txid: 'ee'.repeat(32), vout: 0 }),
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
  const started = swaps.start({ give: 'LBC', lbc: LBC_AMOUNT.toString(), btc: BTC_AMOUNT.toString(), btcAddress: encodeSegwitAddress(0, pkhOf(4), BITCOIN_NETWORKS.regtest) });
  const record = () => stored.find((r) => r.id === started.id)!;
  // Bob made the secret; his Bitcoin contract pays Alice's claim key and is confirmed.
  const secret = new Uint8Array(32).fill(0x42);
  const bobContract = htlcScript({ secretHash: secretHashOf(secret), recipientPkh: hash160(publicKeyOf(fromHex(record().getKey))), refundPkh: pkhOf(6), locktime: Math.floor(clock / 1000) + TIMING.joinerLock });
  const bobFunding: SwapTx = { txid: 'bb'.repeat(32), height: btc.tip - 5, inputs: [], outputs: [{ value: BTC_AMOUNT, script: htlcOutputScript(bobContract) }] };
  btc.add(htlcAddress(bobContract, BITCOIN_NETWORKS.regtest), bobFunding);
  swaps.accept({ code: encodeSwapCode({ type: 'lock', network: 'regtest', id: started.id, coin: 'BTC', contract: bobContract, txid: bobFunding.txid, vout: 0, joinerPkh: pkhOf(7) }) });
  await swaps.poll();
  const locked = await swaps.lock({ id: started.id });
  const aliceContract = fromHex(record().ours!.contract);
  lbc.add(locked.ours!.address, { txid: 'ee'.repeat(32), height: lbc.tip - 20, inputs: [], outputs: [{ value: LBC_AMOUNT, script: htlcOutputScript(aliceContract) }] });
  // poll() is single-flight: the first call may return the round lock() started before the funding was added.
  await swaps.poll();
  await swaps.poll();
  expect(record().ours!.funding!.height).toBe(lbc.tip - 20);
  return { swaps, lbc, btc, record, secret, aliceContract, aliceAddress: locked.ours!.address, bobFunding, bobKey: keyOf(7), setClock: (ms: number) => (clock = ms) };
}

const asSwapTx = (tx: Transaction): SwapTx => ({
  txid: tx.txid,
  height: 0,
  inputs: tx.inputs.map((i) => ({ txid: i.txid, vout: i.vout, scriptSig: i.scriptSig, witness: i.witness })),
  outputs: tx.outputs.map((o) => ({ value: o.value, script: o.script })),
});

describe('the starter against a server that lists a false spend first', () => {
  it('still finds the claim that carries the secret behind it, and claims the Bitcoin', async () => {
    const s = await aliceLocked();
    const { tx: bobsClaim } = buildHtlcSpend({
      contract: s.aliceContract,
      output: { txid: 'ee'.repeat(32), vout: 0, value: LBC_AMOUNT },
      privateKey: s.bobKey,
      destination: p2pkhScript(pkhOf(8)),
      feeRate: 100,
      dust: SWAP_CHAINS.LBC.dust,
      path: { kind: 'redeem', secret: s.secret },
    });
    s.lbc.add(s.aliceAddress, forgedSpend('ee'.repeat(32), 0));
    s.lbc.add(s.aliceAddress, asSwapTx(bobsClaim));
    await s.swaps.poll();
    await s.swaps.poll();
    expect(s.record().secret).toBe(toHex(s.secret));
    expect(s.btc.broadcasts.at(-1)!.inputs[0]).toMatchObject({ txid: s.bobFunding.txid, vout: 0 });
  });

  it('bounds a wild fee estimate so a claim is not burnt in fees', async () => {
    const s = await aliceLocked();
    const { tx: bobsClaim } = buildHtlcSpend({
      contract: s.aliceContract,
      output: { txid: 'ee'.repeat(32), vout: 0, value: LBC_AMOUNT },
      privateKey: s.bobKey,
      destination: p2pkhScript(pkhOf(8)),
      feeRate: 100,
      dust: SWAP_CHAINS.LBC.dust,
      path: { kind: 'redeem', secret: s.secret },
    });
    s.lbc.add(s.aliceAddress, asSwapTx(bobsClaim));
    s.btc.feeRate = async () => 50_000; // sat/vB: a broken or hostile estimate
    await s.swaps.poll();
    await s.swaps.poll();
    const claim = s.btc.broadcasts.at(-1)!;
    const fee = BTC_AMOUNT - claim.outputs.reduce((sum, o) => sum + o.value, 0n);
    expect(fee).toBeLessThanOrEqual(BTC_AMOUNT / 4n);
  });
});
