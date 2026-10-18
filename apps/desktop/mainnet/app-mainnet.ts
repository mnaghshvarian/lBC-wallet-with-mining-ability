/**
 * The desktop app on the real LBC network, used the way a person would:
 * accept the disclaimer, open a wallet, wait until it has synced with LBRY's
 * public servers, check the LBC supply figures, test the servers from
 * Settings, and read the Bitcoin network fee for swaps from the public
 * explorers. Nothing is mined.
 *
 * With MAINNET_TEST_PHRASE (the recovery phrase of a small, dedicated test
 * wallet) it restores that wallet, checks that its history is verified against
 * proof-of-work headers, sends 0.01 LBC to the wallet's own next address
 * through the Send screen and waits for the confirmation. Without it, it
 * creates a new, empty wallet.
 *
 *   npm run build -w lbc-wallet-desktop
 *   npx tsx apps/desktop/mainnet/app-mainnet.ts                      (development build)
 *   APP_EXECUTABLE="…/LBC Wallet.exe" npx tsx apps/desktop/mainnet/app-mainnet.ts
 *
 * Screenshots go to SCREENSHOT_DIR; none is taken while a recovery phrase is
 * on screen. LBC_TEST_HUB=host:port runs the same steps on a local regtest
 * network instead (to try changes to this script).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Page } from 'playwright-core';
import { acceptDisclaimer, launchApp, type RunningApp } from '../e2e/app-driver';

const shotsDir = process.env.SCREENSHOT_DIR ?? mkdtempSync(join(tmpdir(), 'lbc-wallet-mainnet-shots-'));
const phrase = (process.env.MAINNET_TEST_PHRASE ?? '').trim();
const testHub = process.env.LBC_TEST_HUB ?? '';
const mainnet = !testHub;
const PASSWORD = randomBytes(12).toString('hex');
const MINUTE = 60_000;

function log(msg: string) {
  console.log(`[app-mainnet] ${msg}`);
}

/** While true, nothing may capture the window (a recovery phrase is on screen). */
let secretOnScreen = false;

async function shot(page: Page, name: string) {
  if (secretOnScreen) return;
  await page.waitForTimeout(400);
  for (let i = 0; i < 6 && (await page.locator('.toast').count()) > 0; i++) {
    await page.locator('.toast').first().click({ timeout: 1000 }).catch(() => undefined);
  }
  await page.screenshot({ path: join(shotsDir, `${name}.png`) });
  log(`screenshot ${name}`);
}

const nav = (page: Page, name: string) => page.locator('.nav-item', { hasText: name }).click();

async function restoreTestWallet(page: Page) {
  await page.getByRole('button', { name: /Restore from a recovery phrase/ }).click();
  secretOnScreen = true;
  await page.getByPlaceholder('word1 word2 word3 …').fill(phrase);
  await page.getByRole('button', { name: 'Continue' }).click();
  // The wallet finds which derivation (LBRY Desktop or BIP44) has history.
  await page.getByText(/Found your wallet|No transactions found yet/).waitFor({ timeout: 2 * MINUTE });
  if (await page.getByText('No transactions found yet').isVisible()) throw new Error('the test wallet has no history on this network; send it a little LBC first');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('input').first().fill('Mainnet test');
  secretOnScreen = false;
  const pw = page.locator('input[type="password"]');
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Restore wallet' }).click();
}

async function createWallet(page: Page) {
  await page.getByRole('button', { name: /Create a new wallet/ }).click();
  await page.locator('input').first().fill('Mainnet check');
  await page.locator('input[type="password"]').nth(0).fill(PASSWORD);
  await page.locator('input[type="password"]').nth(1).fill(PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  secretOnScreen = true;
  await page.getByRole('button', { name: 'Reveal recovery phrase' }).click();
  const words = await page.locator('.word .selectable').allInnerTexts();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  const labels = await page.locator('.field > label').allInnerTexts();
  const inputs = page.locator('.field input');
  for (let i = 0; i < labels.length; i++) await inputs.nth(i).fill(words[Number(/#(\d+)/.exec(labels[i]!)![1]) - 1]!);
  await page.getByRole('button', { name: 'Create wallet' }).click();
  await page.getByText('Total balance').waitFor({ timeout: MINUTE });
  secretOnScreen = false;
}

/** The block height in the sidebar's connection status ("server · #1234567"). */
async function connectedHeight(page: Page, minHeight: number): Promise<{ server: string; height: number }> {
  const status = page.locator('.sidebar .net-status');
  await status.getByText('Connected').waitFor({ timeout: 3 * MINUTE });
  for (const deadline = Date.now() + 3 * MINUTE; ; ) {
    const line = (await status.locator('.line2').innerText()).trim();
    const m = /^(.*?)\s*·\s*#([\d,.\s]+)$/.exec(line);
    const height = m ? Number(m[2]!.replace(/[^\d]/g, '')) : 0;
    if (height >= minHeight) return { server: m![1]!, height };
    if (Date.now() > deadline) throw new Error(`no chain height in the connection status: "${line}"`);
    await page.waitForTimeout(2000);
  }
}

async function main() {
  mkdirSync(shotsDir, { recursive: true });
  const dataDir = mkdtempSync(join(tmpdir(), 'lbc-wallet-mainnet-'));
  const [hubHost, hubPort] = testHub.split(':');
  writeFileSync(
    join(dataDir, 'settings.json'),
    JSON.stringify(
      mainnet
        ? { network: 'mainnet', theme: 'dark', showFiat: false, autoLockMinutes: 60 }
        : { network: 'regtest', theme: 'dark', showFiat: false, autoLockMinutes: 60, developerMode: true, useDefaultHubs: false, customHubs: [{ host: hubHost, port: Number(hubPort) }] },
    ),
  );
  log(`${mainnet ? 'LBC mainnet' : `test network at ${testHub}`}; ${phrase ? 'restoring the test wallet' : 'creating a new wallet'}`);

  let app: RunningApp | null = null;
  try {
    app = await launchApp(dataDir, log);
    const page = app.page;
    await page.setViewportSize({ width: 1280, height: 820 });
    page.on('pageerror', (err) => console.error('[renderer error]', err));

    await acceptDisclaimer(page);
    if (phrase) await restoreTestWallet(page);
    else await createWallet(page);
    await page.getByText('Total balance').waitFor({ timeout: MINUTE });

    // Synced with the public servers, at the real chain height.
    const { server, height } = await connectedHeight(page, mainnet ? 2_000_000 : 1);
    await page.getByText('Synced', { exact: true }).first().waitFor({ timeout: 5 * MINUTE });
    log(`synced with ${server} at block ${height}`);
    await shot(page, 'm1-overview');

    // Every payment the wallet shows is checked against a proof-of-work block header.
    if (phrase) {
      await nav(page, 'Activity');
      const confirmed = page.locator('.list-row').filter({ hasNotText: /Pending|Waiting/ }).first();
      await confirmed.click();
      await page.locator('.drawer').getByText('Verified against the block header').waitFor({ timeout: 3 * MINUTE });
      await shot(page, 'm2-verified-history');
      await page.keyboard.press('Escape');
      log('history verified against proof-of-work headers');
    }

    // LBC supply from the real chain height (mainnet only).
    await nav(page, 'Mining');
    if (mainnet) {
      await page.getByText('LBC supply', { exact: true }).waitFor();
      await page.getByText('Left to mine', { exact: true }).waitFor();
      await shot(page, 'm3-mining-supply');
      log('supply card shown');
    }

    // The public servers answer the server test in Settings (one that is down may fail).
    await nav(page, 'Settings');
    await page.locator('.tab', { hasText: 'Network' }).click();
    for (const button of await page.locator('table').getByRole('button', { name: /^\s*Test\s*$/ }).all()) await button.click();
    await page.locator('.badge', { hasText: /ms ·/ }).first().waitFor({ timeout: MINUTE });
    await shot(page, 'm4-settings-network');
    log('server test answered');

    // Swaps read the Bitcoin fee from blockstream.info.
    if (mainnet) {
      await nav(page, 'Swap');
      await page.getByRole('button', { name: 'Start a swap' }).click();
      await page.getByText(/Bitcoin network fee to collect or refund: about [\d,]+ sats/).waitFor({ timeout: MINUTE });
      await shot(page, 'm5-swap-btc-fee');
      log('Bitcoin explorer reachable for swaps');
    }

    // A real payment through the Send screen: 0.01 LBC to the wallet's own next address.
    if (phrase) {
      await nav(page, 'Receive');
      const address = (await page.locator('.address-box').first().innerText()).trim();
      await nav(page, 'Send');
      await page.getByPlaceholder(/^bXXXX/).fill(address);
      await page.getByPlaceholder('0.00').fill('0.01');
      await page.getByPlaceholder(/e\.g\. Rent/).fill('mainnet app test');
      await page.getByText(/^Network fee:/).waitFor();
      await page.getByRole('button', { name: 'Review' }).click();
      await page.locator('.modal input[type="password"]').fill(PASSWORD);
      await shot(page, 'm6-send-review');
      await page.locator('.modal').getByRole('button', { name: /^Send / }).click();
      await page.getByText('Transaction sent').waitFor({ timeout: MINUTE });
      await page.getByRole('button', { name: 'Done' }).click();
      log(`sent 0.01 LBC to ${address}; waiting for a block (about 2.5 minutes on average)`);
      await nav(page, 'Activity');
      const row = page.locator('.list-row', { hasText: 'mainnet app test' }).first();
      await row.waitFor({ timeout: MINUTE });
      await row.getByText(/1 conf\.|Verified|Confirmed/).waitFor({ timeout: 40 * MINUTE });
      await row.click();
      await page.locator('.drawer').getByText('Verified against the block header').waitFor({ timeout: 5 * MINUTE });
      await shot(page, 'm7-payment-confirmed');
      await page.keyboard.press('Escape');
      log('the payment is confirmed and verified');
    }
    log(mainnet ? 'the app works on the real network' : 'all steps passed on the test network');
  } catch (err) {
    if (app) await shot(app.page, 'failure').catch(() => undefined);
    throw err;
  } finally {
    await app?.close().catch(() => undefined);
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
