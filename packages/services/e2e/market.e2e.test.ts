/**
 * The order board end to end: one wallet posts an offer on a Nostr relay,
 * another finds it and takes part of it, and the two wallets' market services
 * set up and run the atomic swap between themselves — on real nodes (lbcd
 * through the hub emulator, btcd through the Esplora emulator) and a local
 * relay, with the time rules shortened.
 *
 *   LBCD_BIN=/path/to/lbcd BTCD_BIN=/path/to/btcd npm run test:e2e -w @lbcwallet/services
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGTEST, addressFromPublicKey, addressToScript, generateMnemonic, publicKeyOf, type SwapTiming } from '@lbcwallet/core';
import { nodeByteTransport, nodeLineTransport } from '@lbcwallet/core/node';
import { MARKET_TERMS_VERSION, MarketService, SettingsStore, SwapService, WalletService, memoryFiles, type MarketTiming, type MarketView, type Platform, type SwapView } from '../src/index';
import { btcdAvailable, lbcdAvailable, startBtcRegtest, startRegtest, waitFor, type RegtestNode } from '../../core/e2e/harness';
import { startRegtestHub, type RegtestHub } from '../../core/e2e/regtest-hub';
import { startEsploraEmulator, type EsploraEmulator } from '../../core/e2e/esplora-emulator';
import { startTestRelay, type TestRelay } from '../../core/e2e/nostr-relay';
import { BTC, BTC_MINER_KEY, LBC_MINER_KEY, PASSWORD, btcAddress, payFromMiner, receivedBtc } from './chain-helpers';

const LBC = 100_000_000n;
const SWAP_TIMING: SwapTiming = { joinerLock: 900, starterLock: 400, starterMinRemaining: 600, lockGap: 120, claimMargin: 60, clockLag: { LBC: 0, BTC: 0 } };
const MARKET_TIMING: MarketTiming = { inviteWait: 20, lockWithin: 60, makerWait: 90, takeMaxAge: 15 };
const PRICE = async () => ({ usd: 0.0016, sats: 2, xmr: 0.0000028, btcUsd: 80_000, xmrUsd: 580, source: 'test', updatedAt: Date.now() });

describe.skipIf(!lbcdAvailable() || !btcdAvailable())('the order board on regtest', () => {
  let lbc: RegtestNode;
  let btc: RegtestNode;
  let hub: RegtestHub;
  let esplora: EsploraEmulator;
  let relay: TestRelay;
  const lbcUsed = new Set<string>();
  const btcUsed = new Set<string>();
  const parties: { wallets: WalletService; market: MarketService }[] = [];

  beforeAll(async () => {
    lbc = await startRegtest(addressFromPublicKey(publicKeyOf(LBC_MINER_KEY), REGTEST));
    // CHECKLOCKTIMEVERIFY is enforced on LBC regtest from block 1351.
    await lbc.generate(1400);
    hub = await startRegtestHub(lbc.rpc, { pollMs: 200 });
    btc = await startBtcRegtest(addressFromPublicKey(publicKeyOf(BTC_MINER_KEY), BTC));
    await btc.generate(150);
    esplora = await startEsploraEmulator(btc.rpc);
    relay = await startTestRelay();
  }, 300_000);

  afterAll(async () => {
    for (const p of parties) {
      p.market.unwatch();
      await p.wallets.shutdown();
    }
    await relay?.close();
    await esplora?.close();
    await hub?.close();
    await btc?.stop();
    await lbc?.stop();
  });

  /** One person's app: wallet, swaps and the market, talking to the local relay. */
  async function party(name: string) {
    const files = memoryFiles();
    const platform: Platform = {
      kind: 'desktop',
      clientName: `LBC Wallet e2e/${name}`,
      files,
      log: (level, scope, message) => {
        if (level !== 'info' || scope === 'market') console.log(`[${name}] ${scope}: ${message}`);
      },
      lineTransport: (endpoint, options) => nodeLineTransport(endpoint, options),
      byteTransport: (endpoint, options) => nodeByteTransport(endpoint, options),
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
    settings.update({
      network: 'regtest',
      useDefaultHubs: false,
      customHubs: [{ host: '127.0.0.1', port: hub.port }],
      requirePasswordToSend: true,
      swap: { btcExplorer: esplora.url },
      market: { relays: [relay.url] },
      acceptedMarketTerms: MARKET_TERMS_VERSION,
    });
    const wallets = new WalletService(platform, settings, { changed: () => undefined, locked: () => undefined, network: () => undefined, notice: () => undefined });
    let market: MarketService | null = null;
    const notices: string[] = [];
    const swaps = new SwapService(platform, settings, {
      wallet: () => wallets.swapWallet(),
      changed: (v) => market?.swapChanged(v),
      notice: (n) => notices.push(n.code),
      timing: SWAP_TIMING,
    });
    market = new MarketService(platform, settings, { wallet: () => wallets.marketWallet(), swaps, changed: () => undefined, notice: (n) => notices.push(n.code), timing: MARKET_TIMING, price: PRICE });
    await wallets.create({ name, password: PASSWORD, source: { type: 'mnemonic', mnemonic: generateMnemonic(12), scheme: 'bip44' } });
    parties.push({ wallets, market });
    return { wallets, swaps, market, notices, address: () => wallets.overview()!.receiveAddress };
  }

  type Party = Awaited<ReturnType<typeof party>>;

  /** Runs one round of everything a party's app does on its timers. */
  async function step(...ps: Party[]): Promise<void> {
    for (const p of ps) {
      await p.swaps.poll();
      await p.market.tick();
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  async function untilView(p: Party, others: Party[], done: (v: MarketView) => boolean, label: string, timeoutMs = 60_000): Promise<MarketView> {
    return waitFor(
      async () => {
        await step(p, ...others);
        return p.market.view();
      },
      done,
      timeoutMs,
      label,
    );
  }

  async function untilSwap(p: Party, others: Party[], id: () => string | undefined, done: (v: SwapView) => boolean, label: string, timeoutMs = 90_000): Promise<SwapView> {
    return waitFor(
      async () => {
        await step(p, ...others);
        const swapId = id();
        return swapId ? p.swaps.list().find((v) => v.id === swapId) : undefined;
      },
      (v) => !!v && done(v),
      timeoutMs,
      label,
    ) as Promise<SwapView>;
  }

  async function fundLbc(p: Party, amount: bigint) {
    await payFromMiner(lbc, LBC_MINER_KEY, REGTEST, addressToScript(p.address(), REGTEST), amount, 100, lbcUsed);
    await lbc.generate(1);
    await waitFor(() => p.wallets.overview(), (o) => !!o && BigInt(o.balance.available) >= amount, 60_000, 'funded LBC wallet');
  }

  it('an offer on the board becomes a swap: both sides get paid', async () => {
    const alice = await party('alice');
    const bob = await party('bob');
    await fundLbc(alice, 60n * LBC);
    const aliceBtc = btcAddress(71);

    // Alice offers 40 LBC for 0.02 BTC, in parts of at least 10 LBC.
    await expect(alice.market.post({ give: 'LBC', lbc: String(400n * LBC), btc: '20000000', min: String(10n * LBC), btcAddress: aliceBtc })).rejects.toMatchObject({ code: 'marketNotEnoughLbc' });
    await expect(alice.market.post({ give: 'LBC', lbc: String(40n * LBC), btc: '2000000', min: String(1n * LBC), btcAddress: aliceBtc })).rejects.toMatchObject({ code: 'marketMinTooSmall' });
    const posted = await alice.market.post({ give: 'LBC', lbc: String(40n * LBC), btc: '2000000', min: String(10n * LBC), btcAddress: aliceBtc });
    expect(posted.mine).toHaveLength(1);
    await untilView(alice, [], (v) => v.mine[0]!.relays === 1, 'the offer reaches the relay');
    expect(relay.events().filter((e) => e.tags.some((t) => t[1] === 'lbc-wallet-offer:regtest'))).toHaveLength(1);

    // Bob sees it on the board, priced against the reference.
    const board = await untilView(bob, [alice], (v) => v.loaded && v.offers.length === 1, 'Bob sees the offer');
    const offer = board.offers[0]!;
    expect(offer).toMatchObject({ give: 'LBC', lbc: String(40n * LBC), btc: '2000000', min: String(10n * LBC), left: String(40n * LBC), mine: false });
    expect(offer.price).toBeCloseTo(50_000, 6);
    expect(offer.premium).toBeCloseTo((50_000 / 2 - 1) * 100, 6);
    await expect(bob.market.take({ key: offer.key, lbc: String(50n * LBC), btcAddress: btcAddress(72) })).rejects.toMatchObject({ code: 'marketOutOfRange' });
    await expect(alice.market.take({ key: offer.key, lbc: String(20n * LBC), btcAddress: btcAddress(72) })).rejects.toMatchObject({ code: 'marketOwnOffer' });

    // Bob takes 20 LBC (for 0.01 BTC). Alice's wallet answers with the swap's invite on its own.
    const take = await bob.market.take({ key: offer.key, lbc: String(20n * LBC), btcAddress: btcAddress(72) });
    expect(take).toMatchObject({ role: 'taker', give: 'BTC', get: 'LBC', btc: '1000000', status: 'waiting' });
    const accepted = await untilView(bob, [alice], (v) => v.trades[0]?.status === 'swapping', 'Alice\'s wallet answers');
    expect(bob.notices).toContain('marketAccepted');
    expect(alice.notices).toContain('marketTaken');
    const aliceView = alice.market.view();
    expect(aliceView.trades[0]).toMatchObject({ role: 'maker', status: 'invited', lbc: String(20n * LBC) });
    expect(aliceView.mine[0]!.left).toBe(String(20n * LBC));
    const bobSwapId = () => bob.market.view().trades[0]?.swapId;
    const aliceSwapId = () => alice.market.view().trades[0]?.swapId;
    expect(bobSwapId()).toBe(aliceSwapId());

    // Bob locks his Bitcoin first, from another wallet, before the deadline.
    const lockView = await bob.swaps.lock({ id: bobSwapId()! });
    expect(lockView.stage).toBe('pay-btc');
    expect(lockView.lockBy).toBeGreaterThan(Date.now() / 1000);
    await payFromMiner(btc, BTC_MINER_KEY, BTC, addressToScript(lockView.payTo!.address, BTC), 1_000_000n, 2, btcUsed);

    // His lock code travels to Alice's wallet by itself; after 2 confirmations she may lock.
    await untilSwap(alice, [bob], aliceSwapId, (v) => v.stage === 'checking', 'Alice gets Bob\'s lock code');
    expect(alice.market.view().trades[0]!.status).toBe('swapping');
    await btc.generate(2);
    await untilSwap(alice, [bob], aliceSwapId, (v) => v.stage === 'lock', 'Bob\'s Bitcoin confirmed');
    expect(alice.notices).toContain('swapReadyToLock');
    await alice.swaps.lock({ id: aliceSwapId()!, password: PASSWORD });

    // Alice's lock code travels back; Bob claims the LBC after 12 confirmations, revealing the secret.
    await untilSwap(bob, [alice], bobSwapId, (v) => v.stage === 'checking' && !!v.theirs, 'Bob gets Alice\'s lock code');
    await lbc.generate(12);
    await untilSwap(bob, [alice], bobSwapId, (v) => !!v.claimTxid, 'Bob claims');
    await lbc.generate(1);
    await untilSwap(bob, [alice], bobSwapId, (v) => v.stage === 'completed', 'Bob completed');
    await untilSwap(alice, [bob], aliceSwapId, (v) => !!v.claimTxid, 'Alice claims');
    await btc.generate(1);
    await untilSwap(alice, [bob], aliceSwapId, (v) => v.stage === 'completed', 'Alice completed');
    const got = await receivedBtc(btc, aliceBtc);
    expect(got).toBeGreaterThan(1_000_000n - 5_000n);

    // Both trades are done; the rest of the offer stays up.
    const aliceDone = await untilView(alice, [bob], (v) => v.trades[0]?.status === 'done', 'Alice\'s trade done');
    expect(aliceDone.mine[0]).toMatchObject({ status: 'open', left: String(20n * LBC), running: 0 });
    const bobDone = await untilView(bob, [alice], (v) => v.trades[0]?.status === 'done', 'Bob\'s trade done');
    expect(bobDone.trades[0]!.unsent).toBe(false);
    await bob.market.dismiss(bobDone.trades[0]!.id);
    expect(bob.market.view().trades).toEqual([]);

    // Alice takes the rest down: it leaves Bob's board.
    await alice.market.withdraw(aliceDone.mine[0]!.id);
    await untilView(bob, [alice], (v) => v.offers.length === 0, 'the offer leaves the board');
  }, 600_000);

  it('turns down takes that do not fit, and gives a take up when nobody answers', async () => {
    const carol = await party('carol');
    const dave = await party('dave');
    // Carol buys LBC: she gives 0.005 BTC for 25 LBC, all at once.
    await carol.market.post({ give: 'BTC', lbc: String(25n * LBC), btc: '500000', min: String(25n * LBC), btcAddress: btcAddress(81) });
    const board = await untilView(dave, [carol], (v) => v.offers.some((o) => o.give === 'BTC'), 'Dave sees Carol\'s offer');
    const offer = board.offers.find((o) => o.give === 'BTC')!;
    // Dave has no LBC to give.
    await expect(dave.market.take({ key: offer.key, lbc: String(25n * LBC), btcAddress: btcAddress(82) })).rejects.toMatchObject({ code: 'marketNotEnoughLbc' });
    await fundLbc(dave, 30n * LBC);
    // Carol's app goes offline (her offer stays on the relay until it expires): Dave's take gives up.
    carol.market.unwatch();
    const take = await dave.market.take({ key: offer.key, lbc: String(25n * LBC), btcAddress: btcAddress(82) });
    expect(take.status).toBe('waiting');
    await untilView(dave, [], (v) => v.trades[0]?.status === 'expired', 'Dave gives up', 60_000);
    expect(dave.wallets.overview()!.balance.available).toBe(String(30n * LBC));
    // Carol's app comes back: the stale take is not answered.
    carol.market.watch();
    await untilView(carol, [dave], (v) => v.mine[0]!.relays === 1, 'Carol is back');
    expect(carol.market.view().trades).toEqual([]);
    // When her wallet locks, her offer is taken down.
    await carol.wallets.lock('manual');
    await carol.market.tick();
    await untilView(dave, [], (v) => !v.offers.some((o) => o.key === offer.key), 'Carol\'s offer is gone');
  }, 300_000);
});
