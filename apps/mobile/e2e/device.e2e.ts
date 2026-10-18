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
  const info = await new Promise<{ hubPort: number; poolPort: number; fundedPhrase: string }>((resolveInfo, reject) => {
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

/** Closes system dialogs (e.g. "launcher isn't responding" on a busy emulator) that would cover screenshots. */
function closeSystemDialogs(): void {
  try {
    adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.CLOSE_SYSTEM_DIALOGS');
  } catch {
    // not fatal
  }
}

/** A full-screen phone screenshot (status bar included), as users see it. */
async function shot(page: Page, name: string) {
  for (let i = 0; i < 6 && (await page.locator('.toast').count()) > 0; i++) {
    await page.locator('.toast').first().click({ timeout: 1000 }).catch(() => undefined);
  }
  closeSystemDialogs();
  // The emulator draws in software: wait until the page has painted, then for the display to catch up.
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await page.waitForTimeout(1500);
  for (let i = 0; i < 20 && screenLooksBlank(); i++) await page.waitForTimeout(500);
  await device.screenshot({ path: join(shotsDir, `${name}.png`) });
  log(`screenshot ${name}`);
}

/** Raw RGBA frame from screencap, or null when the screen cannot be captured. */
function captureFrame(): { width: number; height: number; pixel: (x: number, y: number) => [number, number, number] } | null {
  let raw: Buffer;
  try {
    raw = execFileSync(ADB, ['exec-out', 'screencap'], { maxBuffer: 256 * 1024 * 1024 });
  } catch {
    return null;
  }
  if (raw.length < 16) return null;
  const width = raw.readUInt32LE(0);
  const height = raw.readUInt32LE(4);
  const header = raw.length - width * height * 4;
  if (width === 0 || height === 0 || header < 0) return null;
  return {
    width,
    height,
    pixel: (x, y) => {
      const i = header + (y * width + x) * 4;
      return [raw[i]!, raw[i + 1]!, raw[i + 2]!];
    },
  };
}

/** True while the middle of the screen is one flat colour (the WebView has not painted yet). */
function screenLooksBlank(): boolean {
  const frame = captureFrame();
  if (!frame) return false;
  const counts = new Map<string, number>();
  let samples = 0;
  for (let y = Math.floor(frame.height * 0.25); y < frame.height * 0.75; y += 16) {
    for (let x = Math.floor(frame.width * 0.1); x < frame.width * 0.9; x += 16) {
      const key = frame.pixel(x, y).join(',');
      counts.set(key, (counts.get(key) ?? 0) + 1);
      samples++;
    }
  }
  return Math.max(...counts.values()) / samples > 0.995;
}

/**
 * True when the screen cannot be captured, which is what FLAG_SECURE does:
 * depending on the Android version, screencap is refused (no frame at all) or
 * returns a black frame. Reads the raw frame buffer (RGBA after a header).
 */
function screenIsProtected(): boolean {
  const frame = captureFrame();
  if (!frame) return true;
  let bright = 0;
  let samples = 0;
  for (let y = Math.floor(frame.height * 0.25); y < frame.height * 0.75; y += 8) {
    for (let x = Math.floor(frame.width * 0.1); x < frame.width * 0.9; x += 8) {
      const [r, g, b] = frame.pixel(x, y);
      samples++;
      if (r + g + b > 48) bright++;
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

/** What CI needs to explain a failure: the screen, whether the app still runs, and the device log. */
function saveDiagnostics(): void {
  try {
    writeFileSync(join(shotsDir, 'failure.png'), execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    log(`no failure screenshot: ${(err as Error).message}`);
  }
  try {
    const pid = execFileSync(ADB, ['shell', 'pidof', PKG], { encoding: 'utf8' }).trim();
    log(`app process: ${pid || 'not running'}`);
  } catch {
    log('app process: not running');
  }
  try {
    const logcat = execFileSync(ADB, ['logcat', '-d', '-v', 'time'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    writeFileSync(join(shotsDir, 'logcat.txt'), logcat);
    const interesting = logcat
      .split('\n')
      .filter((l) => /AndroidRuntime|FATAL|ANR in|lbcwallet|Capacitor|chromium|WebView|cr_|Console|am_crash|am_kill|lowmemorykiller|Process .* has died/i.test(l));
    console.log(`---- logcat (${interesting.length} relevant lines, last 150) ----\n${interesting.slice(-150).join('\n')}\n---- end of logcat ----`);
  } catch (err) {
    log(`no logcat: ${(err as Error).message}`);
  }
}

async function main() {
  mkdirSync(shotsDir, { recursive: true });
  const net = await startNetwork();
  log(`network ready: hub ${net.info.hubPort}`);
  try {
    // System error dialogs (another app being slow on a busy emulator) would cover the screenshots.
    try {
      adb('shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1');
    } catch {
      log('could not hide system error dialogs');
    }
    closeSystemDialogs();
    adb('install', '-r', '-t', APK);
    adb('shell', 'pm', 'clear', PKG);
    // Start on the test network with the host's hub (10.0.2.2 is the host as seen from the emulator).
    const settings = { network: 'regtest', developerMode: true, useDefaultHubs: false, customHubs: [{ host: '10.0.2.2', port: net.info.hubPort }], showFiat: false, autoLockMinutes: 30 };
    execFileSync(ADB, ['shell', `run-as ${PKG} sh -c 'mkdir -p files/lbcwallet && cat > files/lbcwallet/settings.json'`], { input: JSON.stringify(settings) });
    adb('logcat', '-c');
    adb('shell', 'am', 'start', '-W', '-n', `${PKG}/.MainActivity`);
    const page = await attach();
    page.on('pageerror', (err) => console.error('[webview error]', err));
    page.on('console', (msg) => console.log(`[webview ${msg.type()}] ${msg.text()}`));
    page.on('close', () => log('the WebView page closed'));
    log(`attached to ${page.url()}`);

    // ---------------------------------------------------------------- disclaimer and restore
    await page.getByText('Read this before you start').waitFor({ timeout: 60_000 });
    await shot(page, 'android-01-disclaimer');
    for (const box of await page.locator('.check-row input').all()) await box.check();
    await page.getByRole('button', { name: /I agree/ }).click();
    await page.getByText('A non-custodial wallet for LBRY Credits').waitFor();
    await shot(page, 'android-02-welcome');
    // Control: an ordinary screen can be captured, so the check below can tell the difference.
    if (screenIsProtected()) throw new Error('screen capture does not work on this device, so screenshot blocking cannot be checked');
    await page.getByRole('button', { name: /Restore from a recovery phrase/ }).click();
    await page.getByPlaceholder('word1 word2 word3 …').fill(net.info.fundedPhrase);
    await page.getByText(/Valid 12-word BIP39 phrase/).waitFor();
    // The phrase screen is protected: Android refuses to capture it (or captures black).
    let protectedScreen = false;
    for (let i = 0; i < 20 && !protectedScreen; i++) {
      await page.waitForTimeout(500);
      protectedScreen = screenIsProtected();
    }
    if (!protectedScreen) throw new Error('the recovery phrase screen was not protected from screenshots');
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

    // ---------------------------------------------------------------- mining on the phone
    await page.locator('.bottom-nav button').last().click();
    await page.locator('.sheet').getByText('Mining').click();
    await page.getByText('Mining on a phone').waitFor();
    // The test pool on this computer (it pays the funded wallet).
    await page.getByRole('combobox', { name: 'Pool' }).selectOption('custom');
    await page.getByPlaceholder('stratum+tcp://pool.example.com:3334').fill(`stratum+tcp://10.0.2.2:${net.info.poolPort}`);
    await page.getByRole('button', { name: 'Start mining' }).click();
    // Real hashing in Web Workers, shares over the native sockets.
    await page.waitForFunction(() => Number(document.querySelector('.stat .v .positive')?.textContent?.replace(/\D/g, '') || 0) >= 3, undefined, { timeout: 120_000 });
    await page.getByText(/hashing thread/).first().waitFor();
    log('the phone mined shares that the pool accepted');
    await shot(page, 'android-09-mining');
    // Unplugged: mining waits for a charger, and starts again by itself.
    adb('shell', 'dumpsys', 'battery', 'unplug');
    await page.getByText(/Waiting for a charger/).waitFor({ timeout: 30_000 });
    log('mining paused on battery');
    adb('shell', 'dumpsys', 'battery', 'reset');
    await page.getByText('Current hashrate').waitFor({ timeout: 60_000 });
    log('mining resumed on the charger');
    await page.getByRole('button', { name: 'Stop mining' }).click();
    await page.getByText('Miner is idle').waitFor({ timeout: 30_000 });
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
  } catch (err) {
    saveDiagnostics();
    throw err;
  } finally {
    await device?.close().catch(() => undefined);
    await net.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
