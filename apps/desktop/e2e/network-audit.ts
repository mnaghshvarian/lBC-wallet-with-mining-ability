/**
 * Privacy audit: starts the app with a fresh profile, records Chromium's
 * net-log and checks every HTTP(S) request the app made. With fiat prices off
 * there must be none at all (no dictionary downloads, telemetry or update
 * pings); with prices on, only the price APIs.
 *
 *   npm run build -w lbc-wallet-desktop
 *   xvfb-run -a npm run test:privacy -w lbc-wallet-desktop
 *
 * Set APP_EXECUTABLE to audit a packaged build instead of the dev build.
 * (Hub, pool and node connections are plain TCP/TLS sockets opened by Node and
 * only happen once a wallet is open or mining starts; they are not covered here.)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import electronPath from 'electron';

const appDir = resolve(__dirname, '..');
const PRICE_APIS = [/^https:\/\/api\.coinpaprika\.com\/v1\/tickers\/lbc-lbry-credits\?/, /^https:\/\/api\.coingecko\.com\/api\/v3\/simple\/price\?/];

async function requestedUrls(settings: Record<string, unknown>): Promise<string[]> {
  const dataDir = mkdtempSync(join(tmpdir(), 'lbc-wallet-audit-'));
  const netLog = join(dataDir, 'netlog.json');
  writeFileSync(join(dataDir, 'settings.json'), JSON.stringify(settings));
  const executable = process.env.APP_EXECUTABLE ? resolve(process.env.APP_EXECUTABLE) : (electronPath as unknown as string);
  const args = [`--log-net-log=${netLog}`, ...(process.env.APP_EXECUTABLE ? [] : [appDir])];
  if (process.env.NO_SANDBOX === '1' || process.getuid?.() === 0 || !process.env.APP_EXECUTABLE) args.unshift('--no-sandbox');
  const child = spawn(executable, args, { env: { ...process.env, LBC_WALLET_DATA_DIR: dataDir }, stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 12_000));
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM'); // graceful quit, so the net-log is finalised
    await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
    const log = readFileSync(netLog, 'utf8');
    return [...new Set([...log.matchAll(/"url":"(https?:[^"]+)"/g)].map((m) => m[1]!))];
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function main() {
  const quiet = await requestedUrls({ network: 'mainnet', showFiat: false });
  console.log(`[audit] fiat off: ${quiet.length} request(s)${quiet.length ? `\n  ${quiet.join('\n  ')}` : ''}`);
  if (quiet.length > 0) throw new Error('the app made network requests with every optional feature off');

  const priced = await requestedUrls({ network: 'mainnet', showFiat: true });
  console.log(`[audit] fiat on: ${priced.length} request(s)\n  ${priced.join('\n  ')}`);
  const unexpected = priced.filter((u) => !PRICE_APIS.some((re) => re.test(u)));
  if (unexpected.length > 0) throw new Error(`unexpected requests: ${unexpected.join(', ')}`);
  if (priced.length === 0) throw new Error('expected a price request (is the audit seeing traffic?)');
  console.log('[audit] network privacy audit passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
