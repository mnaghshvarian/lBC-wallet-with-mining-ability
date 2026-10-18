/**
 * Starts the desktop app for a test and hands back its window: the development
 * build with Electron's own binary, or a packaged/installed build (whose fuses
 * disable the Node inspector) over the Chrome DevTools protocol.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { _electron as electron, chromium, type Page } from 'playwright-core';
import electronPath from 'electron';

const appDir = resolve(__dirname, '..');

export interface RunningApp {
  page: Page;
  close(): Promise<void>;
}

/** Ends a process and its children (on Windows, kill() only ends the process itself). */
export function forceKill(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGKILL');
}

/** Runs the app from the electron-vite build output with the development Electron binary. */
export async function launchDev(dataDir: string): Promise<RunningApp> {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: ['--no-sandbox', appDir],
    env: { ...process.env, LBC_WALLET_DATA_DIR: dataDir, ...(process.env.LBCD_BIN ? { LBC_WALLET_LBCD_BIN: process.env.LBCD_BIN } : {}) },
  });
  return { page: await app.firstWindow(), close: () => app.close() };
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => res(port));
    });
  });
}

/** Runs a packaged build and attaches to its window over the DevTools protocol. */
export async function launchPackaged(executable: string, dataDir: string, log: (msg: string) => void): Promise<RunningApp> {
  const port = await freePort();
  const args = [`--remote-debugging-port=${port}`];
  // Chromium refuses to run as root with its sandbox; CI runs as a normal user with the sandbox on.
  if (process.env.NO_SANDBOX === '1' || process.getuid?.() === 0) args.push('--no-sandbox');
  const child = spawn(executable, args, { env: { ...process.env, LBC_WALLET_DATA_DIR: dataDir }, stdio: ['ignore', 'inherit', 'inherit'] });
  const exited = new Promise<void>((res) => child.once('exit', () => res()));
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`packaged app exited with code ${child.exitCode}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error('packaged app did not open a DevTools endpoint');
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = context.pages().find((p) => p.url().startsWith('file:')) ?? (await context.waitForEvent('page', { timeout: 30_000 }));
  log(`attached to packaged app ${executable}`);
  return {
    page,
    close: async () => {
      // Quit the way the app's own menu does, so it shuts its services down cleanly (Windows has no SIGTERM).
      await page.evaluate(() => void (window as unknown as { lbc: { app: { quit(): Promise<void> } } }).lbc.app.quit()).catch(() => undefined);
      await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000))]);
      await browser.close().catch(() => undefined);
      if (child.exitCode === null) {
        child.kill('SIGTERM'); // Electron quits gracefully on SIGTERM (Linux, macOS)
        await Promise.race([exited, new Promise((r) => setTimeout(r, 10_000))]);
      }
      if (child.exitCode === null) forceKill(child);
    },
  };
}

/** APP_EXECUTABLE (a packaged or installed build) when set, otherwise the development build. */
export function launchApp(dataDir: string, log: (msg: string) => void): Promise<RunningApp> {
  return process.env.APP_EXECUTABLE ? launchPackaged(resolve(process.env.APP_EXECUTABLE), dataDir, log) : launchDev(dataDir);
}

/** Accepts the first-run disclaimer and checks that it cannot be skipped. */
export async function acceptDisclaimer(page: Page, beforeAccepting?: () => Promise<void>): Promise<void> {
  await page.getByText('Read this before you start').waitFor();
  const agree = page.getByRole('button', { name: /I agree/ });
  if (!(await agree.isDisabled())) throw new Error('the disclaimer can be accepted without ticking the boxes');
  await beforeAccepting?.();
  for (const box of await page.locator('.check-row input').all()) await box.check();
  await agree.click();
  await page.getByText('A non-custodial wallet for LBRY Credits').waitFor();
}
