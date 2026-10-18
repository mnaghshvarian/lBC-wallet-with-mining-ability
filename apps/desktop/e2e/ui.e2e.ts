/**
 * End-to-end UI test: drives the real Electron app against a local LBC regtest
 * network (lbcd + hub emulator + Stratum test pool) and saves screenshots.
 *
 *   npm run build -w lbc-wallet-desktop
 *   LBCD_BIN=/path/to/lbcd xvfb-run -a npm run test:ui -w lbc-wallet-desktop
 *
 * Screenshots go to apps/desktop/e2e/screenshots (or SCREENSHOT_DIR); THEME=light
 * switches the theme.
 *
 * Flow: accept the first-run disclaimer, restore a funded wallet
 * (auto-detecting the derivation), create a second wallet with backup
 * verification, send between them, confirm, mine through the pool, use the
 * order board (read an offer, take it, post and take down an offer), start and
 * stop the built-in node (when LBCD_BIN is set), visit every settings tab, and
 * check the Persian (right-to-left) and phone layouts.
 *
 * Set APP_EXECUTABLE to a packaged build (e.g. release/1.0.0/linux-unpacked/lbc-wallet)
 * to run the same flow against the fused production binary. Its Node inspector
 * is disabled by the fuses, so the test drives the window over the Chrome
 * DevTools protocol instead.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Page } from 'playwright-core';
import { createWebSocket, newNostrSecret, offerEvent, randomBytes, toHex } from '@lbcwallet/core';
import { nodeByteTransport } from '@lbcwallet/core/node';
import { acceptDisclaimer, forceKill, launchApp, type RunningApp } from './app-driver';

const appDir = resolve(__dirname, '..');
const repoRoot = resolve(appDir, '../..');
const shotsDir = process.env.SCREENSHOT_DIR ?? join(appDir, 'e2e', 'screenshots');
const PASSWORD = 'correct horse battery staple';
const MEXC_PRICES = { LBCUSDT: '0.001647', BTCUSDT: '82134.06', XMRUSDT: '582.56' };

function log(msg: string) {
  console.log(`[ui-e2e] ${msg}`);
}

async function startNetwork() {
  const child = spawn(process.execPath, [join(repoRoot, 'node_modules/tsx/dist/cli.mjs'), join(repoRoot, 'packages/core/e2e/dev-regtest.ts')], {
    env: { ...process.env, HUB_PORT: '50171', POOL_PORT: '33371', RELAY_PORT: '7471', POOL_DIFF: '0.004' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const rl = createInterface({ input: child.stdout! });
  const info = await new Promise<{ hubPort: number; poolPort: number; p2pPort: number; relayUrl: string; fundedPhrase: string; rpcUrl: string }>((resolveInfo, reject) => {
    const t = setTimeout(() => reject(new Error('regtest network did not start')), 90_000);
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.ready) {
          clearTimeout(t);
          resolveInfo(msg);
        }
      } catch {
        // not JSON
      }
    });
    child.on('exit', (code) => reject(new Error(`regtest network exited (${code})`)));
  });
  return {
    info,
    mine: (n: number) => child.stdin!.write(`mine ${n}\n`),
    stop: async () => {
      if (child.exitCode !== null) return;
      const exited = new Promise<void>((res) => child.once('exit', () => res()));
      child.stdin!.write('stop\n');
      await Promise.race([exited, new Promise((r) => setTimeout(r, 20_000))]);
      if (child.exitCode === null) forceKill(child);
    },
  };
}

/** Posts an offer to the test relay as another person would (a key of its own, no wallet behind it). */
async function postForeignOffer(relayUrl: string, terms: { give: 'LBC' | 'BTC'; lbc: bigint; btc: bigint; min: bigint }) {
  const ws = createWebSocket(relayUrl, (endpoint) => nodeByteTransport(endpoint, { connectTimeoutMs: 5000 }));
  await ws.connect();
  const event = await offerEvent(toHex(randomBytes(8)), { network: 'regtest', ...terms, left: terms.lbc, status: 'open' }, newNostrSecret(), Math.floor(Date.now() / 1000));
  const accepted = new Promise<void>((resolveOk, reject) => {
    ws.onMessage((text) => {
      const msg = JSON.parse(text) as unknown[];
      if (msg[0] === 'OK' && msg[1] === event.id) (msg[2] ? resolveOk() : reject(new Error(String(msg[3]))));
    });
  });
  ws.send(JSON.stringify(['EVENT', event]));
  await accepted;
  ws.close();
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  // Notifications are transient (click to dismiss); keep them out of the screenshots.
  for (let i = 0; i < 6 && (await page.locator('.toast').count()) > 0; i++) {
    await page.locator('.toast').first().click({ timeout: 1000 }).catch(() => undefined);
  }
  await page.screenshot({ path: join(shotsDir, `${name}.png`) });
  log(`screenshot ${name}`);
}

async function main() {
  mkdirSync(shotsDir, { recursive: true });
  const net = await startNetwork();
  log(`network ready: hub ${net.info.hubPort}, pool ${net.info.poolPort}`);
  const dataDir = mkdtempSync(join(tmpdir(), 'lbc-wallet-ui-'));
  writeFileSync(
    join(dataDir, 'settings.json'),
    JSON.stringify({
      network: 'regtest',
      theme: process.env.THEME ?? 'dark',
      useDefaultHubs: false,
      customHubs: [{ host: '127.0.0.1', port: net.info.hubPort }],
      developerMode: true,
      showFiat: false,
      autoLockMinutes: 30,
      mining: { mode: 'pool', poolUrl: `stratum+tcp://127.0.0.1:${net.info.poolPort}`, poolApi: '', threads: 2, workerName: 'e2e', poolPassword: 'x', lowPriority: true, pauseOnBattery: false, payoutAddress: '' },
      // The built-in node syncs from the test network's node.
      node: { enabled: false, dataDir: '', listen: false, peers: [`127.0.0.1:${net.info.p2pPort}`] },
      market: { relays: [net.info.relayUrl] },
    }),
  );

  let app: RunningApp | null = null;
  try {
    app = await launchApp(dataDir, log);
    // The Market's price card with MEXC's prices of 18 October 2026, also where the exchanges
    // cannot be reached (only the development build gives access to the main process).
    await app.electron?.evaluate(({ protocol, net }, prices: Record<string, string>) => {
      protocol.handle('https', (request) => {
        const url = new URL(request.url);
        const symbol = url.searchParams.get('symbol') ?? '';
        if (url.hostname === 'api.mexc.com' && symbol in prices) return Response.json({ symbol, price: prices[symbol] });
        return net.fetch(request, { bypassCustomProtocolHandlers: true });
      });
    }, MEXC_PRICES);
    const page = app.page;
    await page.setViewportSize({ width: 1280, height: 820 });
    page.on('pageerror', (err) => console.error('[renderer error]', err));

    // ---------------------------------------------------------------- disclaimer
    await acceptDisclaimer(page, () => shot(page, '00-disclaimer'));

    // ---------------------------------------------------------------- welcome
    await shot(page, '01-welcome');

    // ---------------------------------------------------------------- restore funded wallet
    await page.getByRole('button', { name: /Restore from a recovery phrase/ }).click();
    await page.getByPlaceholder('word1 word2 word3 …').fill(net.info.fundedPhrase);
    await page.getByText(/Valid 12-word BIP39 phrase/).waitFor();
    await shot(page, '02-restore-phrase');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText(/Found your wallet/).waitFor({ timeout: 60_000 });
    await shot(page, '03-restore-detected');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input').first().fill('Mining rig');
    const pw = page.locator('input[type="password"]');
    await pw.nth(0).fill(PASSWORD);
    await pw.nth(1).fill(PASSWORD);
    await page.getByRole('button', { name: 'Restore wallet' }).click();
    await page.getByText('Total balance').waitFor({ timeout: 30_000 });
    await page.getByText(/Maturing mining rewards/).waitFor({ timeout: 60_000 });
    await shot(page, '04-overview');

    // ---------------------------------------------------------------- receive & activity
    await page.getByRole('button', { name: 'Receive', exact: true }).first().click();
    await page.getByText('Your receiving address').waitFor();
    await shot(page, '05-receive');
    await page.locator('.nav-item', { hasText: 'Activity' }).click();
    await page.getByText(/transactions$/).first().waitFor();
    await shot(page, '06-activity');

    // ---------------------------------------------------------------- create a second wallet
    await page.locator('.nav-item', { hasText: 'Lock wallet' }).click();
    await page.getByText('Enter your password to unlock.').waitFor();
    await page.getByText('Other wallets').click();
    await page.getByRole('button', { name: /Create a new wallet/ }).click();
    await page.locator('input').first().fill('Savings');
    await page.locator('input[type="password"]').nth(0).fill(PASSWORD);
    await page.locator('input[type="password"]').nth(1).fill(PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Reveal recovery phrase' }).click();
    const words = await page.locator('.word .selectable').allInnerTexts();
    if (words.length !== 12) throw new Error(`expected 12 words, got ${words.length}`);
    await shot(page, '07-create-phrase');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Continue' }).click();
    const labels = await page.locator('.field > label').allInnerTexts();
    const inputs = page.locator('.field input');
    for (let i = 0; i < labels.length; i++) {
      const n = Number(/#(\d+)/.exec(labels[i]!)![1]);
      await inputs.nth(i).fill(words[n - 1]!);
    }
    await shot(page, '08-create-verify');
    await page.getByRole('button', { name: 'Create wallet' }).click();
    await page.getByText('Total balance').waitFor({ timeout: 30_000 });
    await page.locator('.nav-item', { hasText: 'Receive' }).click();
    const savingsAddress = (await page.locator('.address-box').first().innerText()).trim();
    log(`savings address ${savingsAddress}`);

    // ---------------------------------------------------------------- send from the funded wallet
    await page.locator('.nav-item', { hasText: 'Lock wallet' }).click();
    await page.getByText('Other wallets').click();
    await page.getByRole('button', { name: /Mining rig/ }).click();
    await page.locator('input[type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.getByText('Total balance').waitFor();
    await page.locator('.nav-item', { hasText: 'Send' }).click();
    await page.getByPlaceholder(/^bXXXX/).fill(savingsAddress);
    await page.getByPlaceholder('0.00').fill('2.5');
    await page.getByPlaceholder(/e\.g\. Rent/).fill('Move to savings');
    await page.getByText(/^Network fee:/).waitFor();
    await page.waitForTimeout(800);
    await shot(page, '09-send');
    await page.getByRole('button', { name: 'Review' }).click();
    await page.locator('.modal input[type="password"]').fill(PASSWORD);
    await shot(page, '10-send-review');
    await page.locator('.modal').getByRole('button', { name: /^Send / }).click();
    await page.getByText('Transaction sent').waitFor({ timeout: 30_000 });
    await shot(page, '11-send-done');
    await page.getByRole('button', { name: 'Done' }).click();
    net.mine(1);
    await page.locator('.nav-item', { hasText: 'Activity' }).click();
    await page.getByText('Move to savings').waitFor();
    await page.locator('.list-row', { hasText: 'Move to savings' }).getByText(/1 conf\.|Verified|Confirmed/).waitFor({ timeout: 30_000 });
    await page.locator('.list-row', { hasText: 'Move to savings' }).click();
    await page.locator('.drawer').getByText('Transaction ID').waitFor();
    await shot(page, '12-tx-detail');
    await page.keyboard.press('Escape');

    // ---------------------------------------------------------------- mining
    await page.locator('.nav-item', { hasText: 'Mining' }).click();
    await page.getByRole('button', { name: 'Start mining' }).click();
    await page.getByText(/hashing threads? \(WebAssembly SIMD/).waitFor({ timeout: 30_000 });
    await page.locator('.stat', { hasText: 'Shares' }).locator('.positive').filter({ hasText: /^[1-9]/ }).waitFor({ timeout: 90_000 });
    await page.waitForTimeout(6000);
    await shot(page, '13-mining');
    // A short sequence for the manual's animation of the miner at work.
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(shotsDir, `anim-mining-${i}.png`) });
    }
    await page.getByRole('button', { name: 'Stop mining' }).click();
    await page.getByRole('button', { name: 'Start mining' }).waitFor({ timeout: 15_000 });

    // "Only when idle": while the computer is in use the miner waits instead of hashing.
    // Checked where the test starts a fresh display (xvfb), so the system idle time is short;
    // a Windows or macOS CI machine may have had no input for hours.
    if (process.platform === 'linux') {
      await page.getByRole('switch', { name: 'Only when idle' }).click();
      await page.getByRole('tab', { name: '30 min' }).click();
      await page.getByRole('button', { name: 'Start mining' }).click();
      await page.locator('.badge', { hasText: 'Waiting for idle' }).waitFor({ timeout: 15_000 });
      await page.getByText(/resumes after 30 minutes idle/).waitFor();
      await shot(page, '13b-mining-idle');
      await page.getByRole('button', { name: 'Stop mining' }).click();
      await page.getByRole('button', { name: 'Start mining' }).waitFor({ timeout: 15_000 });
      await page.getByRole('switch', { name: 'Only when idle' }).click();
    }

    // ---------------------------------------------------------------- swap (the Bitcoin side is covered by the swap end-to-end test)
    await page.locator('.nav-item', { hasText: 'Swap' }).click();
    await page.getByText('How a swap works').waitFor();
    await page.getByRole('button', { name: 'Start a swap' }).click();
    await page.getByPlaceholder('0.00', { exact: true }).fill('25');
    await page.getByPlaceholder('0.00000000').fill('0.0005');
    await page.getByPlaceholder('bc1…').fill('bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080');
    await page.getByRole('button', { name: 'Create the invite' }).click();
    const invite = await page.locator('.address-box', { hasText: 'lbcswap:' }).innerText();
    if (!invite.startsWith('lbcswap:')) throw new Error('no invite code');
    await shot(page, '14a-swap-invite');
    // Pasting your own invite into "Join" is recognised.
    await page.getByRole('button', { name: 'Join with a code' }).click();
    await page.getByPlaceholder('lbcswap:…').fill(invite);
    await page.getByText('You already have this swap').waitFor();
    await page.getByRole('button', { name: 'Join with a code' }).click();
    await page.getByRole('button', { name: 'Cancel swap' }).click();
    await page.getByRole('button', { name: 'Cancel swap' }).click();
    await page.locator('.card-header .badge', { hasText: 'Cancelled' }).waitFor();
    log('swap invite created and cancelled');

    // ---------------------------------------------------------------- market (whole trades are covered by the order board end-to-end test)
    // Someone else's offer on the test relay: 200,000 LBC at 2.05 sats each.
    await postForeignOffer(net.info.relayUrl, { give: 'LBC', lbc: 200_000n * 100_000_000n, btc: 410_000n, min: 10_000n * 100_000_000n });
    await page.locator('.nav-item', { hasText: 'Market' }).click();
    await page.getByText('The order board: read this first').waitFor();
    await shot(page, '14b-market-warning');
    for (const box of await page.getByRole('checkbox').all()) await box.check();
    await page.getByRole('button', { name: 'I understand — open the board' }).click();
    await page.getByText('Connected to 1 of 1 relays').waitFor({ timeout: 30_000 });
    const row = page.locator('tr', { hasText: '200,000.00 LBC' });
    await row.waitFor({ timeout: 30_000 });
    if (app.electron) await page.getByText(/^MEXC · /).waitFor({ timeout: 30_000 });
    await shot(page, '14c-market-board');
    await row.getByRole('button', { name: 'Buy' }).click();
    const take = page.locator('.modal');
    await take.locator('input').first().fill('10000');
    await take.getByPlaceholder('bc1…').fill('bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080');
    await take.getByText(/You give 20,500 sats and get 10,000\.00 LBC/).waitFor();
    await shot(page, '14d-market-take');
    await take.getByRole('button', { name: /^Buy 10,000/ }).click();
    // Nobody answers this offer (no wallet behind it): the take waits, then gives up after 10 minutes.
    await take.getByText(/Waiting for the other wallet to answer/).waitFor({ timeout: 30_000 });
    await shot(page, '14e-market-waiting');
    await page.keyboard.press('Escape');
    await page.locator('.badge', { hasText: 'Sent' }).waitFor();
    // Our own offer: buy 50,000 LBC at 2 sats each.
    await page.getByRole('button', { name: 'Post an offer' }).click();
    const post = page.locator('.modal');
    await post.getByRole('tab', { name: 'Buy LBC (pay Bitcoin)' }).click();
    await post.locator('input').nth(0).fill('50000');
    await post.locator('input').nth(1).fill('2');
    await post.getByPlaceholder('bc1…').fill('bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080');
    await post.getByText('You buy 50,000.00 LBC for 0.001 BTC').waitFor();
    await shot(page, '14f-market-post');
    await post.getByRole('button', { name: 'Post the offer' }).click();
    await page.getByText('Your offers').waitFor();
    await page.getByText(/^On 1 relay/).waitFor({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'Sell LBC' }).click();
    await page.locator('tr', { hasText: '50,000.00 LBC' }).getByText('Yours').waitFor({ timeout: 30_000 });
    await shot(page, '14g-market-mine');
    await page.getByRole('button', { name: 'Take down' }).click();
    await page.locator('.badge', { hasText: 'Closed' }).waitFor();
    log('market: board read, offer taken, own offer posted and taken down');

    // ---------------------------------------------------------------- built-in node
    await page.locator('.nav-item', { hasText: 'Node' }).click();
    await page.getByText('Run a full LBRY node on this computer').waitFor();
    await shot(page, '14-node');
    if (process.env.LBCD_BIN) {
      await page.getByRole('button', { name: 'Start node' }).click();
      await page.locator('.page-header .badge', { hasText: /Syncing|Running/ }).waitFor({ timeout: 60_000 });
      // It syncs from the test network, then the wallet switches to it.
      await page.locator('.page-header .badge', { hasText: 'Running' }).waitFor({ timeout: 180_000 });
      await page.locator('.sidebar .net-status', { hasText: 'your node' }).waitFor({ timeout: 60_000 });
      await shot(page, '15-node-running');
      log('built-in node synced; the wallet reads the chain from it');

      // Solo mining through the built-in node.
      await page.locator('.nav-item', { hasText: 'Mining' }).click();
      await page.getByRole('tab', { name: 'Solo (full node)' }).click();
      await page.getByText('Using the built-in node — ready.').waitFor();
      await page.getByRole('button', { name: 'Start mining' }).click();
      await page.locator('.stat', { hasText: 'Blocks found' }).locator('.v').filter({ hasText: /^[1-9]/ }).waitFor({ timeout: 120_000 });
      await shot(page, '15b-solo-mining');
      await page.getByRole('button', { name: 'Stop mining' }).click();
      await page.getByRole('button', { name: 'Start mining' }).waitFor({ timeout: 15_000 });
      await page.getByRole('tab', { name: 'Pool (recommended)' }).click();
      log('solo-mined a block through the built-in node');

      await page.locator('.nav-item', { hasText: 'Node' }).click();
      await page.getByRole('button', { name: 'Stop node' }).click();
      await page.locator('.page-header .badge', { hasText: 'Off' }).waitFor({ timeout: 120_000 });
      log('built-in node stopped');
    }

    // ---------------------------------------------------------------- settings
    await page.locator('.nav-item', { hasText: 'Settings' }).click();
    await shot(page, '16-settings-general');
    await page.locator('.tab', { hasText: 'Network' }).click();
    await page.getByRole('button', { name: /Test/ }).first().click();
    await page.locator('.badge', { hasText: /ms ·/ }).waitFor({ timeout: 15_000 });
    await shot(page, '17-settings-network');
    await page.locator('.tab', { hasText: 'Security' }).click();
    await shot(page, '18-settings-security');
    await page.locator('.tab', { hasText: 'About' }).click();
    await page.getByText('Not audited — use at your own risk').waitFor();
    await shot(page, '19-settings-about');

    // overview after everything
    await page.locator('.nav-item', { hasText: 'Overview' }).click();
    await page.waitForTimeout(1000);
    await shot(page, '20-overview-after');

    // ---------------------------------------------------------------- phone layout (English)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.bottom-nav button').first().click();
    await page.locator('.page').evaluate((el) => el.scrollTo(0, 0));
    await shot(page, '25-phone-overview');
    await page.locator('.bottom-nav button', { hasText: 'Receive' }).click();
    await shot(page, '26-phone-receive');
    await page.locator('.bottom-nav button', { hasText: 'Send' }).click();
    await shot(page, '27-phone-send');
    await page.locator('.bottom-nav button').last().click();
    await page.locator('.sheet').waitFor();
    await shot(page, '28-phone-more');
    await page.locator('.sheet .nav-item', { hasText: 'Market' }).click();
    await page.getByText('Connected to 1 of 1 relays').waitFor({ timeout: 30_000 });
    await page.locator('.page').evaluate((el) => el.scrollTo(0, 0));
    // The offer's button must be on screen, not behind a sideways scroll.
    const buy = await page.locator('tr', { hasText: '200,000.00 LBC' }).getByRole('button', { name: 'Buy' }).boundingBox();
    if (!buy || buy.x < 0 || buy.x + buy.width > page.viewportSize()!.width) throw new Error(`phone Market: the Buy button is off screen (${JSON.stringify(buy)})`);
    await shot(page, '29-phone-market');
    await page.setViewportSize({ width: 1280, height: 820 });

    // ---------------------------------------------------------------- Persian (right to left)
    await page.locator('.nav-item', { hasText: 'Settings' }).click();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('fa');
    await page.waitForFunction(() => document.documentElement.dir === 'rtl' && document.documentElement.lang === 'fa');
    await page.locator('.nav-item').first().click();
    await page.waitForTimeout(800);
    await shot(page, '21-overview-fa');
    await page.locator('.nav-item').nth(5).click(); // mining
    await shot(page, '22-mining-fa');

    // ---------------------------------------------------------------- phone layout
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.bottom-nav button').first().click();
    await page.waitForTimeout(600);
    await shot(page, '23-phone-overview-fa');
    await page.locator('.sidebar').waitFor({ state: 'hidden' });
    await page.locator('.bottom-nav button').last().click();
    await page.locator('.sheet').waitFor();
    await shot(page, '24-phone-more-fa');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1280, height: 820 });

    // ---------------------------------------------------------------- Hindi (Devanagari, bundled font)
    await page.locator('.sidebar .nav .nav-item').last().click(); // settings
    await page.getByRole('combobox').first().selectOption('hi');
    await page.waitForFunction(() => document.documentElement.lang === 'hi' && document.documentElement.dir === 'ltr');
    await page.waitForFunction(() => document.fonts.check('16px "Noto Sans Devanagari Variable"', 'अवलोकन'));
    await page.locator('.nav-item').first().click();
    await page.waitForTimeout(800);
    await shot(page, '30-overview-hi');
    await page.locator('.nav-item').nth(4).click(); // market
    await page.waitForTimeout(800);
    await shot(page, '31-market-hi');
    log('UI end-to-end flow passed');
  } catch (err) {
    // Leave evidence for the CI artifacts: what the window showed, and the miner/node logs.
    if (app) {
      await app.page.screenshot({ path: join(shotsDir, 'failure.png') }).catch(() => undefined);
      const logs = await app.page.locator('.logbox').allInnerTexts().catch(() => []);
      for (const text of logs) console.error(`[ui-e2e] log box:\n${text}`);
    }
    throw err;
  } finally {
    await app?.close().catch(() => undefined);
    await net.stop();
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch (err) {
      log(`could not remove ${dataDir}: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
