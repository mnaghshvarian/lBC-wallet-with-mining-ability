/**
 * End-to-end test of the real Android app on a device or emulator, against a
 * local LBC regtest network on this computer (lbcd + hub emulator; the
 * emulator reaches it at 10.0.2.2). Drives the WebView over the Chrome
 * DevTools protocol and saves phone screenshots.
 *
 *   npm run build:android:debug -w lbc-wallet-mobile
 *   LBCD_BIN=/path/to/lbcd npm run test:device -w lbc-wallet-mobile
 *
 * Needs `adb` with exactly one device/emulator attached, and the debug APK
 * (debuggable: needed for `run-as` and WebView debugging). Uses Playwright's
 * Android support to drive the WebView.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { _android as android, type AndroidDevice, type Page } from 'playwright-core';
import { REGTEST } from '../../../packages/core/src/networks';
import { AddressDeriver, deriveAccountKey, publicOnly } from '../../../packages/core/src/keys/hd';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appDir, '../..');
const PKG = 'io.github.mnaghshvarian.lbcwallet';
const APK = process.env.APK ?? join(appDir, 'android/app/build/outputs/apk/debug/app-debug.apk');
const ADB = process.env.ADB ?? 'adb';
const shotsDir = process.env.SCREENSHOT_DIR ?? join(appDir, 'e2e', 'screenshots');
const PASSWORD = 'correct horse battery staple';

const log = (msg: string) => console.log(`[device-e2e] ${msg}`);
const adb = (...args: string[]) => execFileSync(ADB, args, { encoding: 'utf8' });

async function startNetwork() {
  const child = spawn(process.execPath, [join(repoRoot, 'node_modules/tsx/dist/cli.mjs'), join(repoRoot, 'packages/core/e2e/dev-regtest.ts')], {
    env: { ...process.env, HUB_PORT: '50181', POOL_PORT: '33381' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const rl = createInterface({ input: child.stdout! });
  const info = await new Promise<{ hubPort: number; fundedPhrase: string }>((resolveInfo, reject) => {
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

let device: AndroidDevice;

/** A full-screen phone screenshot (status bar included), as users see it. */
async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  for (let i = 0; i < 6 && (await page.locator('.toast').count()) > 0; i++) {
    await page.locator('.toast').first().click({ timeout: 1000 }).catch(() => undefined);
  }
  await device.screenshot({ path: join(shotsDir, `${name}.png`) });
  log(`screenshot ${name}`);
}

/**
 * True when the middle of the screen is black, which is what Android captures
 * for a window with FLAG_SECURE. Reads the raw frame buffer (RGBA after a header).
 */
function screenIsBlackedOut(): boolean {
  const raw = execFileSync(ADB, ['exec-out', 'screencap'], { maxBuffer: 256 * 1024 * 1024 });
  const width = raw.readUInt32LE(0);
  const height = raw.readUInt32LE(4);
  const header = raw.length - width * height * 4;
  let bright = 0;
  let samples = 0;
  for (let y = Math.floor(height * 0.25); y < height * 0.75; y += 8) {
    for (let x = Math.floor(width * 0.1); x < width * 0.9; x += 8) {
      const i = header + (y * width + x) * 4;
      samples++;
      if (raw[i]! + raw[i + 1]! + raw[i + 2]! > 48) bright++;
    }
  }
  return bright / samples < 0.01;
}

async function attach(): Promise<Page> {
  const [first] = await android.devices();
  if (!first) throw new Error('no Android device or emulator found');
  device = first;
  const webview = await device.webView({ pkg: PKG }, { timeout: 60_000 });
  return webview.page();
}

async function main() {
  mkdirSync(shotsDir, { recursive: true });
  const net = await startNetwork();
  log(`network ready: hub ${net.info.hubPort}`);
  try {
    adb('install', '-r', '-t', APK);
    adb('shell', 'pm', 'clear', PKG);
    // Start on the test network with the host's hub (10.0.2.2 is the host as seen from the emulator).
    const settings = { network: 'regtest', developerMode: true, useDefaultHubs: false, customHubs: [{ host: '10.0.2.2', port: net.info.hubPort }], showFiat: false, autoLockMinutes: 30 };
    execFileSync(ADB, ['shell', `run-as ${PKG} sh -c 'mkdir -p files/lbcwallet && cat > files/lbcwallet/settings.json'`], { input: JSON.stringify(settings) });
    adb('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`);
    const page = await attach();
    page.on('pageerror', (err) => console.error('[webview error]', err));
    log(`attached to ${page.url()}`);

    // ---------------------------------------------------------------- disclaimer and restore
    await page.getByText('Read this before you start').waitFor({ timeout: 60_000 });
    await shot(page, 'android-01-disclaimer');
    for (const box of await page.locator('.check-row input').all()) await box.check();
    await page.getByRole('button', { name: /I agree/ }).click();
    await page.getByText('A non-custodial wallet for LBRY Credits').waitFor();
    await shot(page, 'android-02-welcome');
    await page.getByRole('button', { name: /Restore from a recovery phrase/ }).click();
    await page.getByPlaceholder('word1 word2 word3 …').fill(net.info.fundedPhrase);
    await page.getByText(/Valid 12-word BIP39 phrase/).waitFor();
    // The phrase screen is protected: Android captures it as a black screen.
    await page.waitForTimeout(500);
    if (!screenIsBlackedOut()) throw new Error('the recovery phrase screen was not protected from screenshots');
    log('recovery phrase screen is protected from screenshots');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByText(/Found your wallet/).waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('input').first().fill('Phone wallet');
    await page.locator('input[type="password"]').nth(0).fill(PASSWORD);
    await page.locator('input[type="password"]').nth(1).fill(PASSWORD);
    await page.getByRole('button', { name: 'Restore wallet' }).click();
    await page.getByText('Total balance').waitFor({ timeout: 60_000 });
    await page.getByText(/Maturing mining rewards/).waitFor({ timeout: 60_000 });
    await shot(page, 'android-04-overview');

    // ---------------------------------------------------------------- receive
    await page.locator('.bottom-nav button', { hasText: 'Receive' }).click();
    await page.getByText('Your receiving address').waitFor();
    await shot(page, 'android-05-receive');

    // ---------------------------------------------------------------- send
    const to = new AddressDeriver(publicOnly(deriveAccountKey(net.info.fundedPhrase, 'bip44', REGTEST, { accountIndex: 1 }), REGTEST), REGTEST).derive(0, 0).address;
    await page.locator('.bottom-nav button', { hasText: 'Send' }).click();
    await page.getByPlaceholder(/^bXXXX/).fill(to);
    await page.getByPlaceholder('0.00').fill('1.5');
    await page.getByPlaceholder(/e\.g\. Rent/).fill('Sent from Android');
    await page.getByText(/^Network fee:/).waitFor();
    await page.waitForTimeout(800);
    await shot(page, 'android-06-send');
    await page.getByRole('button', { name: 'Review' }).click();
    await page.locator('.modal input[type="password"]').fill(PASSWORD);
    await shot(page, 'android-07-review');
    await page.locator('.modal').getByRole('button', { name: /^Send / }).click();
    await page.getByText('Transaction sent').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Done' }).click();
    net.mine(1);
    await page.locator('.bottom-nav button', { hasText: 'Activity' }).click();
    await page.locator('.list-row', { hasText: 'Sent from Android' }).getByText(/1 conf\.|Verified|Confirmed/).waitFor({ timeout: 60_000 });
    await shot(page, 'android-08-activity');

    // The hardware back button closes pages and returns to the overview.
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    await page.getByText('Total balance').waitFor({ timeout: 10_000 });

    // ---------------------------------------------------------------- mining monitor and settings
    await page.locator('.bottom-nav button').last().click();
    await page.locator('.sheet').getByText('Mining').click();
    await page.getByText('Mining runs on your computer').waitFor();
    await shot(page, 'android-09-mining');
    await page.locator('.bottom-nav button').last().click();
    await page.locator('.sheet').getByText('Settings').click();
    await page.locator('.tab', { hasText: 'About' }).click();
    await page.getByText(/Android \d+/).first().waitFor();
    await page.locator('.tab', { hasText: 'General' }).click();
    await page.getByRole('combobox', { name: 'Language' }).selectOption('fa');
    await page.waitForFunction(() => document.documentElement.dir === 'rtl');
    await page.locator('.bottom-nav button').first().click();
    await shot(page, 'android-10-overview-fa');
    log('Android end-to-end flow passed');
  } finally {
    await device?.close().catch(() => undefined);
    await net.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
