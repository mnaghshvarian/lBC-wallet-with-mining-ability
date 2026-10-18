/**
 * Atomic swaps end to end: two wallets swap LBC for Bitcoin on real nodes —
 * lbcd (LBC regtest, through the LBRY hub emulator) and btcd (Bitcoin regtest,
 * through an Esplora emulator) — using the wallet's own services, with the
 * time rules shortened from days to minutes.
 *
 *   LBCD_BIN=/path/to/lbcd BTCD_BIN=/path/to/btcd npm run test:e2e -w @lbcwallet/services
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  REGTEST,
  addressFromPublicKey,
  addressToScript,
  decodeSwapCode,
  encodeSwapCode,
  generateMnemonic,
  hash160,
  htlcAddress,
  htlcScript,
  publicKeyOf,
  randomBytes,
  secretHashOf,
  type SwapTiming,
} from '@lbcwallet/core';
import { nodeLineTransport } from '@lbcwallet/core/node';
import { SettingsStore, SwapService, WalletService, memoryFiles, type Platform, type SwapView } from '../src/index';
import { btcdAvailable, lbcdAvailable, startBtcRegtest, startRegtest, waitFor, type RegtestNode } from '../../core/e2e/harness';
import { startRegtestHub, type RegtestHub } from '../../core/e2e/regtest-hub';
import { startEsploraEmulator, type EsploraEmulator } from '../../core/e2e/esplora-emulator';
import { BTC, BTC_MINER_KEY, LBC_MINER_KEY, PASSWORD, btcAddress, payFromMiner, receivedBtc } from './chain-helpers';

describe.skipIf(!lbcdAvailable() || !btcdAvailable())('LBC ↔ BTC atomic swaps on regtest', () => {
  let lbc: RegtestNode;
  let btc: RegtestNode;
  let hub: RegtestHub;
  let esplora: EsploraEmulator;
  const lbcUsed = new Set<string>();
  const btcUsed = new Set<string>();
  const parties: { wallets: WalletService; swaps: SwapService }[] = [];

  beforeAll(async () => {
    lbc = await startRegtest(addressFromPublicKey(publicKeyOf(LBC_MINER_KEY), REGTEST));
    // CHECKLOCKTIMEVERIFY is enforced on LBC regtest from block 1351 (on Bitcoin regtest from block 1).
    await lbc.generate(1400);
    hub = await startRegtestHub(lbc.rpc, { pollMs: 200 });
    btc = await startBtcRegtest(addressFromPublicKey(publicKeyOf(BTC_MINER_KEY), BTC));
    await btc.generate(150);
    esplora = await startEsploraEmulator(btc.rpc);
  }, 300_000);

  afterAll(async () => {
    for (const p of parties) await p.wallets.shutdown();
    await esplora?.close();
    await hub?.close();
    await btc?.stop();
    await lbc?.stop();
  });

  /** One person's app: a wallet and its swap service, with shortened time rules. */
  async function party(name: string, timing: SwapTiming) {
    const files = memoryFiles();
    const platform: Platform = {
      kind: 'desktop',
      clientName: `LBC Wallet e2e/${name}`,
      files,
      log: (level, scope, message) => {
        if (level !== 'info' || scope === 'swap') console.log(`[${name}] ${scope}: ${message}`);
      },
      lineTransport: (endpoint, options) => nodeLineTransport(endpoint, options),
      fetchJson: async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      },
      postText: async (url, body) => {
        const r = await fetch(url, { method: 'POST', body });
        const text = await r.text();
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${text}`);
        return text;
      },
      cpuCount: 2,
    };
    const settings = new SettingsStore(files, 2);
    settings.update({ network: 'regtest', useDefaultHubs: false, customHubs: [{ host: '127.0.0.1', port: hub.port }], requirePasswordToSend: true, swap: { btcExplorer: esplora.url } });
    const wallets = new WalletService(platform, settings, { changed: () => undefined, locked: () => undefined, network: () => undefined, notice: () => undefined });
    const swaps = new SwapService(platform, settings, { wallet: () => wallets.swapWallet(), changed: () => undefined, notice: () => undefined, timing });
    await wallets.create({ name, password: PASSWORD, source: { type: 'mnemonic', mnemonic: generateMnemonic(12), scheme: 'bip44' } });
    parties.push({ wallets, swaps });
    return { wallets, swaps, address: () => wallets.overview()!.receiveAddress };
  }

  /** Runs the swap service until the swap reaches a state. */
  async function until(p: { swaps: SwapService }, id: string, done: (v: SwapView) => boolean, label: string, timeoutMs = 90_000): Promise<SwapView> {
    return waitFor(
      async () => {
        await p.swaps.poll();
        await new Promise((r) => setTimeout(r, 300));
        return p.swaps.list().find((v) => v.id === id)!;
      },
      done,
      timeoutMs,
      label,
    );
  }

  async function fundLbc(p: { wallets: WalletService; address: () => string }, lbcAmount: bigint) {
    await payFromMiner(lbc, LBC_MINER_KEY, REGTEST, addressToScript(p.address(), REGTEST), lbcAmount, 100, lbcUsed);
    await lbc.generate(1);
    await waitFor(() => p.wallets.overview(), (o) => !!o && BigInt(o.balance.available) >= lbcAmount, 60_000, 'funded LBC wallet');
  }

  it('swaps 20 LBC for 0.01 BTC: both get paid, the secret moves through the chains', async () => {
    const timing: SwapTiming = { joinerLock: 900, starterLock: 400, starterMinRemaining: 600, lockGap: 120, claimMargin: 60, clockLag: { LBC: 0, BTC: 0 } };
    const alice = await party('alice', timing);
    const bob = await party('bob', timing);
    await fundLbc(alice, 30n * 100_000_000n);
    const aliceBtc = btcAddress(31);

    // Alice starts: 20 LBC for 0.01 BTC, paid to her Bitcoin address.
    const invite = alice.swaps.start({ give: 'LBC', lbc: String(20n * 100_000_000n), btc: '1000000', btcAddress: aliceBtc });
    expect(invite.stage).toBe('send-invite');
    expect(invite.code).toMatch(/^lbcswap:/);
    expect(alice.swaps.inspect(invite.code!)).toMatchObject({ type: 'invite', youGive: 'BTC', known: true });

    // Bob joins and locks his Bitcoin first, paying from another wallet.
    expect(bob.swaps.inspect(invite.code!)).toMatchObject({ type: 'invite', youGive: 'BTC', btc: '1000000', known: false });
    const joined = bob.swaps.join({ code: invite.code!, btcAddress: btcAddress(32) });
    expect(joined.stage).toBe('lock');
    const pay = await bob.swaps.lock({ id: joined.id });
    expect(pay.stage).toBe('pay-btc');
    expect(pay.payTo).toEqual({ address: pay.ours!.address, amount: '1000000' });
    await payFromMiner(btc, BTC_MINER_KEY, BTC, addressToScript(pay.payTo!.address, BTC), 1_000_000n, 2, btcUsed);
    const bobLocked = await until(bob, joined.id, (v) => v.stage === 'send-lock' && !!v.code, 'Bob sees his payment');
    expect(bobLocked.expectsCode).toBe(true);

    // Alice takes Bob's lock code and waits for 2 Bitcoin confirmations.
    expect(() => alice.swaps.accept({ code: invite.code! })).toThrow();
    alice.swaps.accept({ code: bobLocked.code! });
    expect((await until(alice, joined.id, (v) => v.stage === 'checking', 'Alice checks')).theirs!.required).toBe(2);
    await btc.generate(2);
    await until(alice, joined.id, (v) => v.stage === 'lock', 'Bob\'s Bitcoin confirmed');

    // Alice locks her LBC (with her password, like a payment).
    await expect(alice.swaps.lock({ id: joined.id, password: 'wrong password' })).rejects.toMatchObject({ code: 'incorrectPassword' });
    const aliceLocked = await alice.swaps.lock({ id: joined.id, password: PASSWORD });
    expect(aliceLocked.stage).toBe('send-lock');
    expect(aliceLocked.ours!.locktime).toBeLessThan(bobLocked.ours!.locktime - timing.lockGap + 1);

    // Bob takes it, waits for 12 LBC confirmations, then claims the LBC — revealing the secret.
    bob.swaps.accept({ code: aliceLocked.code! });
    await until(bob, joined.id, (v) => v.stage === 'checking', 'Bob checks');
    await lbc.generate(12);
    const bobClaiming = await until(bob, joined.id, (v) => !!v.claimTxid, 'Bob claims');
    await lbc.generate(1);
    await until(bob, joined.id, (v) => v.stage === 'completed', 'Bob completed');
    await waitFor(() => bob.wallets.transactions(), (list) => list.some((t) => t.txid === bobClaiming.claimTxid && t.type === 'receive'), 30_000, 'LBC in Bob\'s wallet');

    // Alice's wallet reads the secret from Bob's claim and claims the Bitcoin.
    const aliceClaiming = await until(alice, joined.id, (v) => !!v.claimTxid, 'Alice claims');
    expect(aliceClaiming.stage).toBe('claiming');
    await btc.generate(1);
    await until(alice, joined.id, (v) => v.stage === 'completed', 'Alice completed');
    const got = await receivedBtc(btc, aliceBtc);
    expect(got).toBeGreaterThan(1_000_000n - 5_000n);
    expect(got).toBeLessThan(1_000_000n);
    // Finished swaps can be removed.
    alice.swaps.remove(joined.id);
    expect(alice.swaps.list()).toEqual([]);
  }, 600_000);

  it('gives the joiner their Bitcoin back when the starter never locks', async () => {
    const timing: SwapTiming = { joinerLock: 40, starterLock: 20, starterMinRemaining: 30, lockGap: 5, claimMargin: 5, clockLag: { LBC: 0, BTC: 0 } };
    const carol = await party('carol', timing);
    const dave = await party('dave', timing);
    const refundTo = btcAddress(41);
    const invite = carol.swaps.start({ give: 'LBC', lbc: String(15n * 100_000_000n), btc: '500000', btcAddress: btcAddress(40) });
    const joined = dave.swaps.join({ code: invite.code!, btcAddress: refundTo });
    const pay = await dave.swaps.lock({ id: joined.id });
    await payFromMiner(btc, BTC_MINER_KEY, BTC, addressToScript(pay.payTo!.address, BTC), 500_000n, 2, btcUsed);
    await btc.generate(1);
    const locked = await until(dave, joined.id, (v) => v.stage === 'send-lock', 'Dave locked');
    // Too early: nothing happens.
    expect((await until(dave, joined.id, () => true, 'poll')).refundTxid).toBeUndefined();
    // After the lock time (and blocks that move the chain's clock past it), the refund goes out.
    await new Promise((r) => setTimeout(r, Math.max(0, (locked.ours!.locktime + 2) * 1000 - Date.now())));
    await btc.generate(11);
    await until(dave, joined.id, (v) => !!v.refundTxid, 'Dave refunds');
    await btc.generate(1);
    await until(dave, joined.id, (v) => v.stage === 'refunded', 'Dave refunded');
    const back = await receivedBtc(btc, refundTo);
    expect(back).toBeGreaterThan(500_000n - 5_000n);
  }, 300_000);

  it('gives the starter their LBC back when the joiner never claims', async () => {
    const timing: SwapTiming = { joinerLock: 120, starterLock: 30, starterMinRemaining: 60, lockGap: 10, claimMargin: 5, clockLag: { LBC: 0, BTC: 0 } };
    const erin = await party('erin', timing);
    const frank = await party('frank', timing);
    await fundLbc(erin, 20n * 100_000_000n);
    const invite = erin.swaps.start({ give: 'LBC', lbc: String(12n * 100_000_000n), btc: '400000', btcAddress: btcAddress(50) });
    const joined = frank.swaps.join({ code: invite.code!, btcAddress: btcAddress(51) });
    const pay = await frank.swaps.lock({ id: joined.id });
    await payFromMiner(btc, BTC_MINER_KEY, BTC, addressToScript(pay.payTo!.address, BTC), 400_000n, 2, btcUsed);
    const frankLocked = await until(frank, joined.id, (v) => v.stage === 'send-lock', 'Frank locked');
    erin.swaps.accept({ code: frankLocked.code! });
    await btc.generate(2);
    await until(erin, joined.id, (v) => v.stage === 'lock', 'Erin may lock');
    const balanceBefore = BigInt(erin.wallets.overview()!.balance.total);
    const erinLocked = await erin.swaps.lock({ id: joined.id, password: PASSWORD });
    await lbc.generate(1);
    // Frank never claims. After Erin's lock time her LBC comes back to her wallet.
    await new Promise((r) => setTimeout(r, Math.max(0, (erinLocked.ours!.locktime + 2) * 1000 - Date.now())));
    await lbc.generate(11);
    const refunding = await until(erin, joined.id, (v) => !!v.refundTxid, 'Erin refunds');
    await lbc.generate(1);
    await until(erin, joined.id, (v) => v.stage === 'refunded', 'Erin refunded');
    await waitFor(() => erin.wallets.overview(), (o) => !!o && BigInt(o.balance.total) > balanceBefore - 100_000_000n, 30_000, 'LBC back in Erin\'s wallet');
    expect(erin.wallets.transactions().some((t) => t.txid === refunding.refundTxid)).toBe(true);
  }, 300_000);

  it('locks nothing for a lock code whose contract would not pay as agreed', async () => {
    const timing: SwapTiming = { joinerLock: 900, starterLock: 400, starterMinRemaining: 600, lockGap: 120, claimMargin: 60, clockLag: { LBC: 0, BTC: 0 } };
    const grace = await party('grace', timing);
    await fundLbc(grace, 20n * 100_000_000n);
    const invite = grace.swaps.start({ give: 'LBC', lbc: String(15n * 100_000_000n), btc: '500000', btcAddress: btcAddress(60) });
    const decoded = decodeSwapCode(invite.code!);
    if (decoded.type !== 'invite') throw new Error('expected an invite');
    // Mallory answers with contracts of her own making instead of joining honestly.
    const malloryPkh = hash160(publicKeyOf(new Uint8Array(32).fill(61)));
    const secretHash = secretHashOf(randomBytes(32));
    const now = Math.floor(Date.now() / 1000);
    const lockCode = (contract: Uint8Array, txid: string) => encodeSwapCode({ type: 'lock', network: 'regtest', id: invite.id, coin: 'BTC', contract, txid, vout: 0, joinerPkh: malloryPkh });

    // A contract that pays Mallory herself is refused at once.
    const toMallory = htlcScript({ secretHash, recipientPkh: malloryPkh, refundPkh: malloryPkh, locktime: now + 900 });
    let refused: unknown;
    try {
      grace.swaps.accept({ code: lockCode(toMallory, 'ab'.repeat(32)) });
    } catch (err) {
      refused = err;
    }
    expect(refused).toMatchObject({ code: 'swapContractMismatch' });

    // One that pays Grace, but less than agreed and with a lock time that ends too soon,
    // is refused once it is on the chain: the swap stops before Grace locks anything.
    const short = htlcScript({ secretHash, recipientPkh: decoded.starterPkh, refundPkh: malloryPkh, locktime: now + 120 });
    const txid = await payFromMiner(btc, BTC_MINER_KEY, BTC, addressToScript(htlcAddress(short, BTC), BTC), 300_000n, 2, btcUsed);
    await btc.generate(2);
    const balanceBefore = grace.wallets.overview()!.balance.total;
    grace.swaps.accept({ code: lockCode(short, txid) });
    const stopped = await until(grace, invite.id, (v) => v.stage === 'cancelled', 'Grace refuses the contract');
    expect(stopped.problem?.code).toBe('their-contract-invalid');
    expect(String(stopped.problem?.params?.reasons).split(',').sort()).toEqual(['amount-too-low', 'locktime-too-early']);
    expect(stopped.ours).toBeUndefined();
    await expect(grace.swaps.lock({ id: invite.id, password: PASSWORD })).rejects.toMatchObject({ code: 'swapNotReady' });
    expect(grace.wallets.overview()!.balance.total).toBe(balanceBefore);
  }, 300_000);
});
