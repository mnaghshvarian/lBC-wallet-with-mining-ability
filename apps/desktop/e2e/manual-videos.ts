/**
 * Records the video manual: drives the real app on a local LBC regtest network like
 * the UI test, but slowly, with captions on screen and a visible pointer, and writes a
 * timeline of chapters and captions that scripts/manual-video.py turns into narrated
 * chapter videos.
 *
 *   npm run build -w lbc-wallet-desktop
 *   npx playwright install ffmpeg          # once: the recorder's video encoder
 *   npm run -s videos:captions -w lbc-wallet-desktop > /tmp/videos/captions.json  # the texts to speak
 *   python3 scripts/manual-video.py tts /tmp/videos                               # speaks and measures them
 *   VIDEO_DIR=/tmp/videos LBCD_BIN=… xvfb-run -a npm run videos -w lbc-wallet-desktop
 *   python3 scripts/manual-video.py build /tmp/videos                             # cuts, title cards, narration → MP4
 *
 * Every caption is held on screen for as long as its narration takes (narration.json,
 * written by the tts step); without narration, for a time that depends on its length.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Locator, Page } from 'playwright-core';
import { createWebSocket, newNostrSecret, offerEvent, randomBytes, toHex } from '@lbcwallet/core';
import { nodeByteTransport } from '@lbcwallet/core/node';
import { forceKill, launchDev, type RunningApp } from './app-driver';

const appDir = resolve(__dirname, '..');
const repoRoot = resolve(appDir, '../..');
const videoDir = process.env.VIDEO_DIR ?? join(appDir, 'e2e', 'videos');
const PASSWORD = 'correct horse battery staple';
const WIDTH = 1280;
const HEIGHT = 820;
const BTC_ADDRESS = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

/** Everything the narrator says, in order of appearance. */
const C = {
  disclaimer: 'This is LBC Wallet. On the first start it shows a disclaimer. Please read it: this software is experimental and not audited, and you use it at your own risk.',
  agree: 'Tick the three boxes to confirm you understood, then click I agree.',
  welcome: 'You can create a new wallet, or restore one you already have from its recovery phrase. Let us create a new one first.',
  namePassword: 'Choose a name and a strong password. The password protects the wallet file on this computer; you will need it to send coins.',
  phraseIntro: 'Now the most important step. Click Reveal recovery phrase, take a pen and paper, and write the twelve words down in order.',
  phraseWrite: 'These twelve words are your wallet. Anyone who has them can take your coins, and nobody from the project will ever ask for them. Never keep them in a screenshot or a chat.',
  verify: 'To make sure your paper is right, the app asks you to type three of the words back.',
  walletReady: 'Your wallet is ready. The balance is zero for now.',
  restoreIntro: 'If you already have a wallet, from LBRY Desktop or Odysee for example, restore it from its recovery phrase: lock this wallet, open Other wallets, and choose Restore.',
  restorePhrase: 'Type or paste the twelve words. The app checks them as you type.',
  restoreFound: 'The wallet looks up its history on the network and tells you what it found. Give it a name and a password, like before.',
  overview: 'This is the overview: your balance, with any coins still maturing or waiting for confirmation, and your latest transactions.',
  receive: 'To receive LBC, open Receive. This is your address: copy it, or let the sender scan the QR code. It is fine to use a fresh address every time.',
  sendIntro: 'To send, open Send and paste the address of the person you are paying. Type the amount, and a note for yourself if you like. The network fee is shown before anything happens.',
  sendReview: 'Click Review. Check the address and the amount once more on the review screen, then enter your password.',
  sendConfirm: 'Click Send, and the transaction goes out to the network.',
  sent: 'Done. The payment is on its way.',
  activity: 'Every payment appears under Activity, with its confirmations as new blocks are found. Click one to see its details.',
  miningIntro: 'LBC Wallet can mine. In pool mode, the recommended one, your computer joins a mining pool and receives a share of the rewards the pool finds.',
  miningExpect: 'Be realistic: a normal computer earns very little, because LBC is mined mostly by specialised hardware. Mine to support the network, not for profit. Click Start mining.',
  miningRunning: 'The hashrate, your shares and the log appear here. You can pause when the laptop is on battery, mine only when the computer is idle, and stop at any time.',
  nodeIntro: 'For advanced users, the wallet can run a full LBRY node, like the Monero GUI runs its daemon. It downloads the whole blockchain, about one hundred gigabytes, and then your wallet no longer depends on public servers.',
  nodeSyncing: 'Click Start node. On the real network the first download takes hours to days; here, on the test network, it is done in seconds.',
  nodeRunning: 'Once the node is in sync, the wallet reads the chain from it, and you can mine solo through it. Stop node ends it; the app also stops it when you quit.',
  marketIntro: 'The Market is an order board: other users of LBC Wallet offer to buy or sell LBC for Bitcoin, and a taken offer settles as an atomic swap between the two wallets. There is no exchange, no account, and nobody holds your coins.',
  marketWarning: 'Read its warning first: the people on the board are strangers, and a trade can keep your coins locked for up to forty-eight hours. Tick both boxes and open the board.',
  board: 'Offers to sell LBC are under Buy LBC, offers to buy it under Sell LBC. Prices are in sats per LBC, and the market price is shown next to them for comparison.',
  takeDialog: 'To take an offer, click Buy, type how much LBC you want, and enter your Bitcoin address for a refund. The window shows exactly what you give and what you get.',
  takeWaiting: 'The other wallet answers when it is online. If it accepts, you pay the Bitcoin first into a contract, and from there both wallets finish the swap by themselves. Keep the app open until the trade says Done.',
  postIntro: 'To post your own offer, click Post an offer: choose whether you buy or sell LBC, the amount, and your price in sats.',
  posted: 'Your offer is on the board while this wallet is open, and comes down when you lock it. Take down removes it at any time.',
  swapPage: 'Under Swap you can also swap directly with someone you know, by exchanging codes, without the board.',
  settingsGeneral: 'Settings. General: your language, the theme, fiat prices, and how Bitcoin amounts are shown; with Automatic, small amounts appear in sats.',
  settingsNetwork: 'Network: the wallet reads the blockchain from public servers by default, or from your own node. You can route everything through Tor with a SOCKS5 proxy.',
  settingsSecurity: 'Security: the wallet locks itself after a while without use. Keep Ask for the password on every send switched on; it is on by default.',
  lock: 'Lock the wallet whenever you step away. Your password opens it again.',
  outro: 'That is LBC Wallet. Start with small amounts, write your recovery phrase on paper, and download only from the project page on GitHub. The written manual has every detail.',
};

type Timeline = { width: number; height: number; chapters: { title: string; at: number }[]; captions: { at: number; text: string; hold: number }[] };

function log(msg: string) {
  console.log(`[videos] ${msg}`);
}

async function startNetwork() {
  const child = spawn(process.execPath, [join(repoRoot, 'node_modules/tsx/dist/cli.mjs'), join(repoRoot, 'packages/core/e2e/dev-regtest.ts')], {
    env: { ...process.env, HUB_PORT: '50181', POOL_PORT: '33381', RELAY_PORT: '7481', POOL_DIFF: '0.004' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const rl = createInterface({ input: child.stdout! });
  const info = await new Promise<{ hubPort: number; poolPort: number; p2pPort: number; relayUrl: string; fundedPhrase: string }>((resolveInfo, reject) => {
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

/** Someone else's offer on the test relay: 200,000 LBC at 2.05 sats each. */
async function postForeignOffer(relayUrl: string) {
  const ws = createWebSocket(relayUrl, (endpoint) => nodeByteTransport(endpoint, { connectTimeoutMs: 5000 }));
  await ws.connect();
  const terms = { give: 'LBC' as const, lbc: 200_000n * 100_000_000n, btc: 410_000n, min: 10_000n * 100_000_000n };
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

/** The caption bar and the pointer, drawn by the page itself so they are in the recording. */
class Presenter {
  private cursor = { x: WIDTH / 2, y: HEIGHT / 2 };
  readonly timeline: Timeline = { width: WIDTH, height: HEIGHT, chapters: [], captions: [] };
  private readonly narration: Record<string, number>;

  constructor(
    private readonly page: Page,
    private readonly t0: number,
  ) {
    const file = join(videoDir, 'narration.json');
    this.narration = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, number>) : {};
  }

  private now(): number {
    return (Date.now() - this.t0) / 1000;
  }

  private async overlay(): Promise<void> {
    await this.page.evaluate(() => {
      if (document.getElementById('mv-caption')) return;
      const cap = document.createElement('div');
      cap.id = 'mv-caption';
      Object.assign(cap.style, {
        position: 'fixed',
        left: '50%',
        bottom: '26px',
        transform: 'translateX(-50%)',
        maxWidth: '74%',
        padding: '12px 20px',
        background: 'rgba(8, 10, 22, 0.9)',
        color: '#fff',
        font: '600 19px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif',
        borderRadius: '12px',
        boxShadow: '0 6px 24px rgba(0, 0, 0, 0.45)',
        border: '1px solid rgba(255, 255, 255, 0.14)',
        zIndex: '2147483646',
        textAlign: 'center',
        opacity: '0',
        transition: 'opacity 0.25s',
        pointerEvents: 'none',
      });
      document.body.appendChild(cap);
      const cur = document.createElement('div');
      cur.id = 'mv-cursor';
      cur.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18.5 L12 28 L16 26.2 L12.2 17 L20 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      Object.assign(cur.style, {
        position: 'fixed',
        left: `${window.innerWidth / 2}px`,
        top: `${window.innerHeight / 2}px`,
        zIndex: '2147483647',
        pointerEvents: 'none',
        transition: 'transform 0.12s',
        filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6))',
      });
      document.body.appendChild(cur);
    });
  }

  chapter(title: string): void {
    this.timeline.chapters.push({ title, at: this.now() });
    log(`chapter: ${title}`);
  }

  /** Shows a caption and holds it for as long as its narration takes (or its length suggests). */
  async say(text: string, extraMs = 0): Promise<void> {
    await this.overlay();
    const spoken = this.narration[text];
    const hold = (spoken !== undefined ? spoken * 1000 + 700 : Math.max(2600, 1400 + text.length * 52)) + extraMs;
    this.timeline.captions.push({ at: this.now(), text, hold: hold / 1000 });
    await this.page.evaluate((t) => {
      const c = document.getElementById('mv-caption')!;
      c.textContent = t;
      c.style.opacity = '1';
    }, text);
    await this.page.waitForTimeout(hold);
  }

  async clearCaption(): Promise<void> {
    await this.page.evaluate(() => {
      const c = document.getElementById('mv-caption');
      if (c) c.style.opacity = '0';
    });
  }

  /** Moves the pointer to the element along an eased path. */
  async moveTo(locator: Locator): Promise<void> {
    await locator.first().waitFor();
    const box = await locator.first().boundingBox();
    if (!box) throw new Error('element has no box');
    await this.overlay();
    const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      const e = k < 0.5 ? 2 * k * k : -1 + (4 - 2 * k) * k;
      const x = this.cursor.x + (target.x - this.cursor.x) * e;
      const y = this.cursor.y + (target.y - this.cursor.y) * e;
      await this.page.mouse.move(x, y);
      await this.page.evaluate(([px, py]) => {
        const c = document.getElementById('mv-cursor');
        if (c) {
          c.style.left = `${px}px`;
          c.style.top = `${py}px`;
        }
      }, [x, y]);
      await this.page.waitForTimeout(16);
    }
    this.cursor = target;
    await this.page.waitForTimeout(180);
  }

  async click(locator: Locator): Promise<void> {
    await this.moveTo(locator);
    await this.page.evaluate(() => {
      const c = document.getElementById('mv-cursor');
      if (c) c.style.transform = 'scale(0.8)';
    });
    await locator.first().click();
    await this.page.waitForTimeout(140);
    await this.page.evaluate(() => {
      const c = document.getElementById('mv-cursor');
      if (c) c.style.transform = 'scale(1)';
    });
    await this.page.waitForTimeout(500);
  }

  /** Ticks a checkbox: by clicking its row when the box itself is drawn by CSS. */
  async check(locator: Locator): Promise<void> {
    const box = await locator.first().boundingBox();
    if (box && box.width > 0) await this.click(locator);
    else {
      const row = locator.first().locator('xpath=ancestor::label[1]');
      if ((await row.count()) > 0) await this.click(row);
      else await locator.first().check();
    }
    await this.page.waitForTimeout(350);
  }

  async type(locator: Locator, text: string, delay = 45): Promise<void> {
    await this.click(locator);
    if (await locator.first().inputValue()) await locator.first().fill(''); // some fields come pre-filled
    await locator.first().pressSequentially(text, { delay });
    await this.page.waitForTimeout(400);
  }

  /** Puts a value in at once, the way a pasted address arrives. */
  async paste(locator: Locator, text: string): Promise<void> {
    await this.click(locator);
    await locator.first().fill(text);
    await this.page.waitForTimeout(700);
  }

  async pause(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }
}

async function main() {
  if (process.argv.includes('--captions')) {
    process.stdout.write(`${JSON.stringify(Object.values(C), null, 2)}\n`);
    return;
  }
  mkdirSync(videoDir, { recursive: true });
  const net = await startNetwork();
  log(`network ready: hub ${net.info.hubPort}, pool ${net.info.poolPort}`);
  const dataDir = mkdtempSync(join(tmpdir(), 'lbc-wallet-video-'));
  writeFileSync(
    join(dataDir, 'settings.json'),
    JSON.stringify({
      network: 'regtest',
      theme: 'dark',
      useDefaultHubs: false,
      customHubs: [{ host: '127.0.0.1', port: net.info.hubPort }],
      developerMode: true,
      showFiat: false,
      autoLockMinutes: 30,
      mining: { mode: 'pool', poolUrl: `stratum+tcp://127.0.0.1:${net.info.poolPort}`, poolApi: '', threads: 2, workerName: 'video', poolPassword: 'x', lowPriority: true, pauseOnBattery: false, payoutAddress: '' },
      node: { enabled: false, dataDir: '', listen: false, peers: [`127.0.0.1:${net.info.p2pPort}`] },
      market: { relays: [net.info.relayUrl] },
    }),
  );
  let app: RunningApp | null = null;
  let timeline: Timeline | null = null;
  try {
    const t0 = Date.now();
    app = await launchDev(dataDir, { dir: videoDir, width: WIDTH, height: HEIGHT });
    const page = app.page;
    page.setDefaultTimeout(60_000);
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    page.on('pageerror', (err) => console.error('[renderer error]', err));
    const p = new Presenter(page, t0);
    timeline = p.timeline;

    // ---------------------------------------------------------------- 1. first start, new wallet
    await page.getByText('Read this before you start').waitFor();
    await p.pause(1500);
    p.chapter('First start and your first wallet');
    await p.say(C.disclaimer);
    await p.say(C.agree, -1500);
    for (const row of await page.locator('.check-row').all()) await p.click(row);
    await p.click(page.getByRole('button', { name: /I agree/ }));
    await page.getByText('A non-custodial wallet for LBRY Credits').waitFor();
    await p.say(C.welcome);
    await p.click(page.getByRole('button', { name: /Create a new wallet/ }));
    await p.say(C.namePassword, -2500);
    await p.type(page.locator('input').first(), 'My wallet');
    await p.type(page.locator('input[type="password"]').nth(0), PASSWORD, 25);
    await p.type(page.locator('input[type="password"]').nth(1), PASSWORD, 25);
    await p.click(page.getByRole('button', { name: 'Continue' }));
    await p.say(C.phraseIntro, -1500);
    await p.click(page.getByRole('button', { name: 'Reveal recovery phrase' }));
    const words = await page.locator('.word .selectable').allInnerTexts();
    if (words.length !== 12) throw new Error(`expected 12 words, got ${words.length}`);
    await p.say(C.phraseWrite);
    await p.check(page.getByRole('checkbox'));
    await p.click(page.getByRole('button', { name: 'Continue' }));
    await p.say(C.verify, -1000);
    const labels = await page.locator('.field > label').allInnerTexts();
    const inputs = page.locator('.field input');
    for (let i = 0; i < labels.length; i++) {
      const n = Number(/#(\d+)/.exec(labels[i]!)![1]);
      await p.type(inputs.nth(i), words[n - 1]!, 70);
      await inputs.nth(i).blur(); // closes the word suggestions, which would cover the next field
      await p.pause(300);
    }
    await p.click(page.getByRole('button', { name: 'Create wallet' }));
    await page.getByText('Total balance').waitFor({ timeout: 30_000 });
    await p.say(C.walletReady);
    await p.click(page.locator('.nav-item', { hasText: 'Receive' }));
    const myAddress = (await page.locator('.address-box').first().innerText()).trim();
    await p.pause(600);

    // ---------------------------------------------------------------- 2. restore, receive, send
    p.chapter('Restore a wallet, receive and send');
    await p.say(C.restoreIntro, -4000);
    await p.click(page.locator('.nav-item', { hasText: 'Lock wallet' }));
    await page.getByText('Enter your password to unlock.').waitFor();
    await p.click(page.getByText('Other wallets'));
    await p.click(page.getByRole('button', { name: /Restore from a recovery phrase/ }));
    await p.say(C.restorePhrase, -2000);
    await p.type(page.getByPlaceholder('word1 word2 word3 …'), net.info.fundedPhrase, 35);
    await page.getByText(/Valid 12-word BIP39 phrase/).waitFor();
    await p.click(page.getByRole('button', { name: 'Continue' }));
    await page.getByText(/Found your wallet/).waitFor({ timeout: 60_000 });
    await p.say(C.restoreFound, -2000);
    await p.click(page.getByRole('button', { name: 'Continue' }));
    await p.type(page.locator('input').first(), 'Main wallet');
    await p.type(page.locator('input[type="password"]').nth(0), PASSWORD, 25);
    await p.type(page.locator('input[type="password"]').nth(1), PASSWORD, 25);
    await p.click(page.getByRole('button', { name: 'Restore wallet' }));
    await page.getByText('Total balance').waitFor({ timeout: 30_000 });
    await page.getByText(/Maturing mining rewards/).waitFor({ timeout: 60_000 });
    await p.say(C.overview);
    await p.click(page.getByRole('button', { name: 'Receive', exact: true }).first());
    await page.getByText('Your receiving address').waitFor();
    await p.say(C.receive);
    await p.click(page.locator('.nav-item', { hasText: 'Send' }));
    await p.say(C.sendIntro, -4500);
    await p.paste(page.getByPlaceholder(/^bXXXX/), myAddress);
    await p.type(page.getByPlaceholder('0.00'), '2.5', 120);
    await p.type(page.getByPlaceholder(/e\.g\. Rent/), 'Move to savings', 60);
    await page.getByText(/^Network fee:/).waitFor();
    await p.pause(1200);
    await p.say(C.sendReview, -2500);
    await p.click(page.getByRole('button', { name: 'Review' }));
    await p.pause(1500);
    await p.type(page.locator('.modal input[type="password"]'), PASSWORD, 25);
    await p.say(C.sendConfirm, -800);
    await p.click(page.locator('.modal').getByRole('button', { name: /^Send / }));
    await page.getByText('Transaction sent').waitFor({ timeout: 30_000 });
    await p.say(C.sent);
    await p.click(page.getByRole('button', { name: 'Done' }));
    net.mine(1);
    await p.click(page.locator('.nav-item', { hasText: 'Activity' }));
    await page.getByText('Move to savings').waitFor();
    await page.locator('.list-row', { hasText: 'Move to savings' }).getByText(/1 conf\.|Verified|Confirmed/).waitFor({ timeout: 30_000 });
    await p.say(C.activity, -2500);
    await p.click(page.locator('.list-row', { hasText: 'Move to savings' }));
    await page.locator('.drawer').getByText('Transaction ID').waitFor();
    await p.pause(3000);
    await page.keyboard.press('Escape');
    await p.pause(600);

    // ---------------------------------------------------------------- 3. mining and the node
    p.chapter('Mining and the built-in node');
    await p.click(page.locator('.nav-item', { hasText: 'Mining' }));
    await p.say(C.miningIntro);
    await p.say(C.miningExpect, -1500);
    await p.click(page.getByRole('button', { name: 'Start mining' }));
    await page.getByText(/hashing threads? \(WebAssembly SIMD/).waitFor({ timeout: 30_000 });
    await page.locator('.stat', { hasText: 'Shares' }).locator('.positive').filter({ hasText: /^[1-9]/ }).waitFor({ timeout: 90_000 });
    await p.say(C.miningRunning);
    await p.pause(2500);
    await p.click(page.getByRole('button', { name: 'Stop mining' }));
    await page.getByRole('button', { name: 'Start mining' }).waitFor({ timeout: 15_000 });
    await p.click(page.locator('.nav-item', { hasText: 'Node' }));
    await page.getByText('Run a full LBRY node on this computer').waitFor();
    await p.say(C.nodeIntro);
    if (process.env.LBCD_BIN) {
      await p.say(C.nodeSyncing, -3500);
      await p.click(page.getByRole('button', { name: 'Start node' }));
      await page.locator('.page-header .badge', { hasText: /Syncing|Running/ }).waitFor({ timeout: 60_000 });
      await page.locator('.page-header .badge', { hasText: 'Running' }).waitFor({ timeout: 180_000 });
      await page.locator('.sidebar .net-status', { hasText: 'your node' }).waitFor({ timeout: 60_000 });
      await p.say(C.nodeRunning);
    }

    // ---------------------------------------------------------------- 4. the Market
    await postForeignOffer(net.info.relayUrl);
    p.chapter('The Market: buy and sell LBC for Bitcoin');
    await p.click(page.locator('.nav-item', { hasText: 'Market' }));
    await page.getByText('The order board: read this first').waitFor();
    await p.say(C.marketIntro);
    await p.say(C.marketWarning, -2000);
    for (const box of await page.getByRole('checkbox').all()) await p.check(box);
    await p.click(page.getByRole('button', { name: 'I understand — open the board' }));
    await page.getByText('Connected to 1 of 1 relays').waitFor({ timeout: 30_000 });
    const row = page.locator('tr', { hasText: '200,000.00 LBC' });
    await row.waitFor({ timeout: 30_000 });
    await p.say(C.board);
    await p.say(C.takeDialog, -5000);
    await p.click(row.getByRole('button', { name: 'Buy' }));
    const take = page.locator('.modal');
    await p.type(take.locator('input').first(), '10000', 110);
    await p.paste(take.getByPlaceholder('bc1…'), BTC_ADDRESS);
    await take.getByText(/You give 20,500 sats and get 10,000\.00 LBC/).waitFor();
    await p.pause(1500);
    await p.click(take.getByRole('button', { name: /^Buy 10,000/ }));
    await take.getByText(/Waiting for the other wallet to answer/).waitFor({ timeout: 30_000 });
    await p.say(C.takeWaiting);
    await page.keyboard.press('Escape');
    await page.locator('.badge', { hasText: 'Sent' }).waitFor();
    await p.pause(800);
    await p.say(C.postIntro, -3500);
    await p.click(page.getByRole('button', { name: 'Post an offer' }));
    const post = page.locator('.modal');
    await p.click(post.getByRole('tab', { name: 'Buy LBC (pay Bitcoin)' }));
    await p.type(post.locator('input').nth(0), '50000', 110);
    await p.type(post.locator('input').nth(1), '2', 150);
    await p.paste(post.getByPlaceholder('bc1…'), BTC_ADDRESS);
    await post.getByText('You buy 50,000.00 LBC for 0.001 BTC').waitFor();
    await p.pause(1500);
    await p.click(post.getByRole('button', { name: 'Post the offer' }));
    await page.getByText('Your offers').waitFor();
    await page.getByText(/^On 1 relay/).waitFor({ timeout: 30_000 });
    await p.click(page.getByRole('tab', { name: 'Sell LBC' }));
    await page.locator('tr', { hasText: '50,000.00 LBC' }).getByText('Yours').waitFor({ timeout: 30_000 });
    await p.say(C.posted, -1500);
    await p.click(page.getByRole('button', { name: 'Take down' }));
    await page.locator('.badge', { hasText: 'Closed' }).waitFor();
    await p.click(page.locator('.nav-item', { hasText: 'Swap' }));
    await page.getByText('How a swap works').waitFor();
    await p.say(C.swapPage);

    // ---------------------------------------------------------------- 5. settings and security
    p.chapter('Settings and security');
    await p.click(page.locator('.nav-item', { hasText: 'Settings' }));
    await p.say(C.settingsGeneral, -2500);
    await p.moveTo(page.getByRole('combobox', { name: 'Bitcoin unit' }));
    await p.pause(1500);
    await p.click(page.locator('.tab', { hasText: 'Network' }));
    await p.say(C.settingsNetwork);
    await p.click(page.locator('.tab', { hasText: 'Security' }));
    await p.say(C.settingsSecurity);
    await p.say(C.lock, -1500);
    await p.click(page.locator('.nav-item', { hasText: 'Lock wallet' }));
    await page.getByText('Enter your password to unlock.').waitFor();
    await p.pause(800);
    await p.type(page.locator('input[type="password"]'), PASSWORD, 25);
    await p.click(page.getByRole('button', { name: 'Unlock' }));
    await page.getByText('Total balance').waitFor();
    await p.click(page.locator('.nav-item', { hasText: 'Overview' }));
    await p.say(C.outro);
    await p.clearCaption();
    await p.pause(1500);
    log('recording finished');
  } catch (err) {
    if (app) await app.page.screenshot({ path: join(videoDir, 'failure.png') }).catch(() => undefined);
    throw err;
  } finally {
    await app?.close().catch(() => undefined);
    await net.stop();
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch {
      // temp dir
    }
  }
  // Playwright names the video after the page; keep the newest as manual.webm with its timeline.
  const videos = readdirSync(videoDir)
    .filter((f) => f.endsWith('.webm') && f !== 'manual.webm')
    .map((f) => ({ f, t: statSync(join(videoDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (videos.length === 0) throw new Error('no video was recorded (Playwright records with its own ffmpeg build: run `npx playwright install ffmpeg`)');
  renameSync(join(videoDir, videos[0]!.f), join(videoDir, 'manual.webm'));
  writeFileSync(join(videoDir, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
  log(`wrote ${join(videoDir, 'manual.webm')} and timeline.json (${timeline!.captions.length} captions, ${timeline!.chapters.length} chapters)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
