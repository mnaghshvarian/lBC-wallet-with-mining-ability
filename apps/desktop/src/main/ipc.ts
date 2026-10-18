import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { cpus } from 'node:os';
import { probeHub, getNetwork, WrongPasswordError } from '@lbcwallet/core';
import type { CreateSource, HubEndpoint, Settings } from '../shared/api';
import type { WalletService } from './wallet-service';
import { UserError } from './wallet-service';
import type { SettingsStore } from './settings';
import type { MinerService } from './miner-service';
import type { PriceService } from './price-service';
import { CLIENT_NAME, lbcdRpc, transportFactory } from './backend';
import { logger } from './log';

const log = logger('ipc');

export interface Services {
  wallets: WalletService;
  settings: SettingsStore;
  miner: MinerService;
  price: PriceService;
  isTrustedUrl: (url: string) => boolean;
}

type Result<T> = { ok: true; value: T } | { ok: false, error: string };

function str(v: unknown, name: string, max = 10_000): string {
  if (typeof v !== 'string') throw new UserError(`${name} must be text`);
  if (v.length > max) throw new UserError(`${name} is too long`);
  return v;
}

function num(v: unknown, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new UserError(`${name} must be a number`);
  return v;
}

/** Messages from core/network errors that are safe and useful to show to users. */
function friendly(err: unknown): string {
  if (err instanceof UserError) return err.message;
  if (err instanceof WrongPasswordError) return 'Incorrect password';
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED/.test(msg)) return 'Connection refused — is the server running?';
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Server not found — check the address and your internet connection';
  if (/timed? ?out/i.test(msg)) return 'The server did not respond in time';
  return msg;
}

export function registerIpc(s: Services, getWindow: () => BrowserWindow | null): void {
  const handle = <A extends unknown[], T>(channel: string, fn: (...args: A) => T | Promise<T>) => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<Result<T>> => {
      if (!event.senderFrame || !s.isTrustedUrl(event.senderFrame.url)) {
        log('warn', `rejected IPC ${channel} from untrusted frame`);
        return { ok: false, error: 'Untrusted sender' };
      }
      try {
        return { ok: true, value: await fn(...(args as A)) };
      } catch (err) {
        if (!(err instanceof UserError) && !(err instanceof WrongPasswordError)) log('warn', `${channel}: ${(err as Error)?.stack ?? err}`);
        return { ok: false, error: friendly(err) };
      }
    });
  };

  // ---------------------------------------------------------------- app
  handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    dataDir: app.getPath('userData'),
    cpuCount: cpus().length,
    isPackaged: app.isPackaged,
  }));
  handle('app:openExternal', async (url: unknown) => {
    const u = new URL(str(url, 'url', 2000));
    if (u.protocol !== 'https:') throw new UserError('Only https links can be opened');
    await shell.openExternal(u.toString());
  });
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  handle('app:copy', (text: unknown, opts?: { sensitive?: boolean }) => {
    const value = str(text, 'text', 5000);
    clipboard.writeText(value);
    if (clearTimer) clearTimeout(clearTimer);
    if (opts?.sensitive) {
      // Clear sensitive data from the clipboard after 30 seconds.
      clearTimer = setTimeout(() => {
        void Promise.resolve(clipboard.readText()).then((current) => {
          if (current === value) clipboard.clear();
        });
      }, 30_000);
    }
  });
  handle('app:paste', async () => (await Promise.resolve(clipboard.readText())).trim().slice(0, 5000));
  ipcMain.on('app:activity', (event) => {
    if (event.senderFrame && s.isTrustedUrl(event.senderFrame.url)) s.wallets.touch();
  });
  handle('app:quit', () => app.quit());

  // ---------------------------------------------------------------- settings
  handle('settings:get', () => s.settings.get());
  handle('settings:update', (patch: unknown) => {
    if (!patch || typeof patch !== 'object') throw new UserError('Invalid settings');
    const prev = s.settings.get();
    const next = s.settings.update(patch as Partial<Settings>);
    if (next.network !== prev.network) void s.wallets.lock('manual');
    return next;
  });

  // ---------------------------------------------------------------- wallets
  handle('wallets:list', () => s.wallets.list());
  handle('wallets:generateMnemonic', (words: unknown) => s.wallets.generateMnemonic(words === 24 ? 24 : 12));
  handle('wallets:checkPhrase', (phrase: unknown) => s.wallets.checkPhrase(str(phrase, 'phrase', 1000)));
  handle('wallets:suggestWords', (prefix: unknown) => s.wallets.suggestWords(str(prefix, 'prefix', 20)));
  handle('wallets:scan', (phrase: unknown, passphrase?: unknown) =>
    s.wallets.scan(str(phrase, 'phrase', 1000), passphrase === undefined ? undefined : str(passphrase, 'passphrase', 500)),
  );
  handle('wallets:create', (params: unknown) => {
    const p = params as { name: unknown; password: unknown; source: CreateSource };
    const source = p?.source;
    if (!source || typeof source !== 'object') throw new UserError('Missing wallet source');
    let clean: CreateSource;
    if (source.type === 'mnemonic') {
      clean = {
        type: 'mnemonic',
        mnemonic: str(source.mnemonic, 'recovery phrase', 1000),
        passphrase: source.passphrase ? str(source.passphrase, 'passphrase', 500) : undefined,
        scheme: source.scheme === 'lbry' ? 'lbry' : 'bip44',
      };
    } else if (source.type === 'xprv') clean = { type: 'xprv', xprv: str(source.xprv, 'extended private key', 200) };
    else if (source.type === 'watch') clean = { type: 'watch', xpub: str(source.xpub, 'extended public key', 200) };
    else throw new UserError('Unknown wallet type');
    return s.wallets.create({ name: str(p.name, 'name', 64), password: str(p.password, 'password', 1000), source: clean });
  });
  handle('wallets:open', (id: unknown, password: unknown) => s.wallets.open(str(id, 'id', 64), str(password, 'password', 1000)));
  handle('wallets:lock', () => s.wallets.lock('manual'));
  handle('wallets:remove', (id: unknown, password: unknown) => s.wallets.remove(str(id, 'id', 64), str(password, 'password', 1000)));
  handle('wallets:rename', (name: unknown) => s.wallets.rename(str(name, 'name', 64)));
  handle('wallets:changePassword', (a: unknown, b: unknown) => s.wallets.changePassword(str(a, 'password', 1000), str(b, 'password', 1000)));
  handle('wallets:reveal', (password: unknown) => s.wallets.reveal(str(password, 'password', 1000)));
  handle('wallets:xpub', () => s.wallets.xpub());
  handle('wallets:passwordStrength', (password: unknown) => s.wallets.passwordStrength(str(password, 'password', 1000)));

  // ---------------------------------------------------------------- open wallet
  handle('wallet:overview', () => s.wallets.overview());
  handle('wallet:transactions', () => s.wallets.transactions());
  handle('wallet:transaction', (txid: unknown) => s.wallets.transaction(str(txid, 'txid', 64)));
  handle('wallet:addresses', () => s.wallets.addresses());
  handle('wallet:newAddress', () => s.wallets.newAddress());
  handle('wallet:setLabel', (key: unknown, label: unknown) => s.wallets.setLabel(str(key, 'key', 100), str(label, 'label', 200)));
  handle('wallet:validateAddress', (address: unknown) => s.wallets.validateAddress(str(address, 'address', 200)));
  handle('wallet:prepareSend', (params: unknown) => {
    const p = params as { address: unknown; amount: unknown; feePerByte?: unknown };
    const amount = p.amount === 'max' ? 'max' : str(p.amount, 'amount', 30);
    if (amount !== 'max' && !/^\d+$/.test(amount)) throw new UserError('Invalid amount');
    return s.wallets.prepareSend({ address: str(p.address, 'address', 200), amount, feePerByte: p.feePerByte === undefined ? undefined : num(p.feePerByte, 'fee rate') });
  });
  handle('wallet:prepareUnlock', () => s.wallets.prepareUnlock());
  handle('wallet:send', (params: unknown) => {
    const p = params as { draftId: unknown; password?: unknown; label?: unknown };
    return s.wallets.send({
      draftId: str(p.draftId, 'draft', 32),
      password: p.password === undefined ? undefined : str(p.password, 'password', 1000),
      label: p.label === undefined ? undefined : str(p.label, 'label', 200),
    });
  });
  handle('wallet:rescan', () => s.wallets.rescan());
  handle('wallet:exportCsv', async () => {
    const win = getWindow();
    const opts = { title: 'Export transactions', defaultPath: `lbc-transactions-${new Date().toISOString().slice(0, 10)}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { saved: false };
    s.wallets.exportCsv(r.filePath);
    return { saved: true, path: r.filePath };
  });
  handle('wallet:contacts', () => s.wallets.contacts());
  handle('wallet:saveContact', (c: unknown) => {
    const x = c as { id?: unknown; name: unknown; address: unknown; note?: unknown };
    return s.wallets.saveContact({
      id: x.id === undefined ? undefined : str(x.id, 'id', 64),
      name: str(x.name, 'name', 80),
      address: str(x.address, 'address', 200),
      note: x.note === undefined ? undefined : str(x.note, 'note', 500),
    });
  });
  handle('wallet:deleteContact', (id: unknown) => s.wallets.deleteContact(str(id, 'id', 64)));

  // ---------------------------------------------------------------- network
  handle('network:status', () => s.wallets.overview()?.backend ?? { connected: false, kind: s.settings.get().backendMode });
  handle('network:testHub', async (endpoint: unknown) => {
    const e = endpoint as HubEndpoint;
    const host = str(e?.host, 'host', 253).trim();
    const port = num(e?.port, 'port');
    const settings = s.settings.get();
    const r = await probeHub({ host, port, tls: !!e.tls }, transportFactory(settings), getNetwork(settings.network), CLIENT_NAME);
    return r.ok ? { ok: true, latencyMs: r.latencyMs, height: r.height, version: r.version } : { ok: false, error: friendly(new Error(r.error)) };
  });
  handle('network:testNode', async () => {
    const settings = s.settings.get();
    const started = Date.now();
    try {
      const rpc = lbcdRpc(settings);
      const info = await rpc.call<{ chain: string; blocks: number }>('getblockchaininfo');
      const expected = settings.network === 'mainnet' ? 'mainnet' : settings.network === 'testnet' ? 'testnet3' : 'regtest';
      if (info.chain !== expected && !(expected === 'mainnet' && info.chain === 'main')) return { ok: false, error: `Node is on ${info.chain}, expected ${expected}` };
      try {
        await rpc.call('searchrawtransactions', [getNetwork(settings.network).name === 'mainnet' ? 'bCqJrLHdoiRqEZ1whFZ3WHNb33bP34SuGx' : 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn', 0, 0, 1]);
      } catch (err) {
        if (/addrindex|address index/i.test((err as Error).message)) return { ok: false, error: 'lbcd must be started with --txindex --addrindex' };
      }
      return { ok: true, latencyMs: Date.now() - started, height: info.blocks, version: 'lbcd' };
    } catch (err) {
      return { ok: false, error: friendly(err) };
    }
  });
  handle('network:reconnect', () => s.wallets.reconnect());

  // ---------------------------------------------------------------- miner & price
  handle('miner:status', () => s.miner.status());
  handle('miner:start', () => s.miner.start());
  handle('miner:stop', () => s.miner.stop());
  handle('miner:logs', () => s.miner.getLogs());
  handle('miner:estimate', () => s.miner.estimate());
  handle('miner:poolBalance', () => s.miner.poolBalance());
  handle('price:get', () => s.price.get());
}
