/**
 * End-to-end UI test: drives the real Electron app against a local LBC regtest
 * network (lbcd + hub emulator + Stratum test pool) and saves screenshots.
 *
 *   npm run build -w lbc-wallet-desktop
 *   LBCD_BIN=/path/to/lbcd xvfb-run -a npm run test:ui -w lbc-wallet-desktop
 *
 * Flow: restore a funded wallet (auto-detecting the derivation), create a
 * second wallet with backup verification, send between them, confirm, mine
 * through the pool, and visit every settings tab.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import electronPath from 'electron';

const appDir = resolve(__dirname, '..');
const repoRoot = resolve(appDir, '../..');
const shotsDir = process.env.SCREENSHOT_DIR ?? join(repoRoot, 'docs', 'screenshots');
const PASSWORD = 'correct horse battery staple';

function log(msg: string) {
  console.log(`[ui-e2e] ${msg}`);
}

async function startNetwork() {
  const child = spawn(process.execPath, [join(repoRoot, 'node_modules/tsx/dist/cli.mjs'), join(repoRoot, 'packages/core/e2e/dev-regtest.ts')], {
    env: { ...process.env, HUB_PORT: '50171', POOL_PORT: '33371', POOL_DIFF: '0.004' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const rl = createInterface({ input: child.stdout! });
  const info = await new Promise<{ hubPort: number; poolPort: number; fundedPhrase: string; rpcUrl: string }>((resolveInfo, reject) => {
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
    stop: () =>
      new Promise<void>((res) => {
        child.once('exit', () => res());
        child.kill('SIGTERM');
      }),
  };
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
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
    }),
  );

  let app: ElectronApplication | null = null;
  try {
    app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: ['--no-sandbox', appDir],
      env: { ...process.env, LBC_WALLET_DATA_DIR: dataDir },
    });
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 820 });
    page.on('pageerror', (err) => console.error('[renderer error]', err));

    // ---------------------------------------------------------------- welcome
    await page.getByText('A non-custodial wallet for LBRY Credits').waitFor();
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
    await page.locator('.stat', { hasText: 'Shares' }).locator('.positive').filter({ hasText: /^[1-9]/ }).waitFor({ timeout: 90_000 });
    await page.waitForTimeout(6000);
    await shot(page, '13-mining');
    await page.getByRole('button', { name: 'Stop mining' }).click();
    await page.getByRole('button', { name: 'Start mining' }).waitFor({ timeout: 15_000 });

    // ---------------------------------------------------------------- settings
    await page.locator('.nav-item', { hasText: 'Settings' }).click();
    await shot(page, '14-settings-general');
    await page.locator('.tab', { hasText: 'Network' }).click();
    await page.getByRole('button', { name: /Test/ }).first().click();
    await page.locator('.badge', { hasText: /ms ·/ }).waitFor({ timeout: 15_000 });
    await shot(page, '15-settings-network');
    await page.locator('.tab', { hasText: 'Security' }).click();
    await shot(page, '16-settings-security');

    // overview after everything
    await page.locator('.nav-item', { hasText: 'Overview' }).click();
    await page.waitForTimeout(1000);
    await shot(page, '17-overview-after');
    log('UI end-to-end flow passed');
  } finally {
    await app?.close().catch(() => undefined);
    await net.stop();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
