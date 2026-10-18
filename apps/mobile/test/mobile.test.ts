import { describe, expect, it, vi } from 'vitest';
import { createApi, createCoreHandlers, MiningInfo, PriceService, SettingsStore, WalletService, type Platform } from '@lbcwallet/services';
import { durableFiles, type FileBackend } from '../src/files';
import { NativeSockets } from '../src/sockets';
import { EventBus, inAppTransport } from '../src/transport';
import { androidAppInfo, createAndroidHandlers } from '../src/handlers';
import type { DeviceInfo, LbcNativePlugin, SocketEvent } from '../src/native';

const INFO: DeviceInfo = { sdkInt: 35, release: '15', webView: '140.0', versionName: '1.0.0', dataDir: '/data/user/0/app/files/lbcwallet', debug: false };

function memoryBackend(initial: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initial));
  const ops: string[] = [];
  const backend: FileBackend = {
    loadFiles: async () => ({ files: Object.fromEntries(disk) }),
    writeFile: async ({ name, content }) => {
      await new Promise((r) => setTimeout(r, 5));
      ops.push(`write ${name}`);
      disk.set(name, content);
    },
    deleteFile: async ({ name }) => {
      ops.push(`delete ${name}`);
      disk.delete(name);
    },
  };
  return { backend, disk, ops };
}

/** A stand-in for the native plugin's socket half. */
function fakeSocketPlugin() {
  let listener: ((e: SocketEvent) => void) | null = null;
  const written: { id: string; data: string }[] = [];
  let next = 0;
  const plugin = {
    addListener: async (_event: 'socket', handler: (e: SocketEvent) => void) => {
      listener = handler;
      return { remove: async () => undefined };
    },
    socketConnect: async () => ({ id: `s${++next}` }),
    socketWrite: vi.fn(async ({ id, data }: { id: string; data: string }) => {
      written.push({ id, data });
    }),
    socketClose: vi.fn(async () => undefined),
  };
  return { plugin: plugin as unknown as LbcNativePlugin, emit: (e: SocketEvent) => listener!(e), written };
}

describe('durable files', () => {
  it('loads every document and writes changes through, in order', async () => {
    const { backend, disk, ops } = memoryBackend({ 'settings.json': '{"theme":"dark"}' });
    const files = await durableFiles(backend, () => undefined);
    expect(files.read<{ theme: string }>('settings.json')?.theme).toBe('dark');
    files.write('wallets/a.lbcwallet.json', { v: 1 });
    files.write('wallets/a.lbcwallet.json', { v: 2 }, { backup: true });
    files.remove('settings.json');
    expect(files.list('wallets', '.lbcwallet.json')).toEqual(['wallets/a.lbcwallet.json']);
    await files.flush();
    expect(ops).toEqual(['write wallets/a.lbcwallet.json', 'write wallets/a.lbcwallet.json.bak', 'write wallets/a.lbcwallet.json', 'delete settings.json']);
    expect(JSON.parse(disk.get('wallets/a.lbcwallet.json')!)).toEqual({ v: 2 });
    expect(JSON.parse(disk.get('wallets/a.lbcwallet.json.bak')!)).toEqual({ v: 1 });
  });

  it('reports failed writes and keeps going', async () => {
    const errors: string[] = [];
    const { backend, disk } = memoryBackend();
    let fail = true;
    const files = await durableFiles(
      {
        ...backend,
        writeFile: async (o) => {
          if (fail) {
            fail = false;
            throw new Error('disk full');
          }
          return backend.writeFile(o);
        },
      },
      (m) => errors.push(m),
    );
    files.write('a.json', 1);
    files.write('b.json', 2);
    await files.flush();
    expect(errors).toEqual(['could not save a.json: disk full']);
    expect(disk.get('b.json')).toBe('2');
  });
});

describe('native sockets', () => {
  it('routes lines by socket and holds lines that arrive before the id is known', async () => {
    const { plugin, emit, written } = fakeSocketPlugin();
    const sockets = new NativeSockets(plugin);
    // A line for s1 arrives before connect() has returned the id.
    const a = sockets.transport({ host: 'hub.example.com', port: 50001 }, 5000);
    const linesA: string[] = [];
    a.onLine((l) => linesA.push(l));
    const connecting = a.connect();
    await Promise.resolve();
    emit({ id: 's1', type: 'line', line: 'early' });
    await connecting;
    emit({ id: 's1', type: 'line', line: '{"id":1}' });
    const b = sockets.transport({ host: 'hub2.example.com', port: 50002, tls: true }, 5000);
    const linesB: string[] = [];
    b.onLine((l) => linesB.push(l));
    await b.connect();
    emit({ id: 's2', type: 'line', line: 'for b' });
    a.send('{"method":"server.version"}');
    expect(linesA).toEqual(['early', '{"id":1}']);
    expect(linesB).toEqual(['for b']);
    await Promise.resolve();
    expect(written).toEqual([{ id: 's1', data: '{"method":"server.version"}\n' }]);
  });

  it('reports a remote close once, and closes locally without reporting', async () => {
    const { plugin, emit } = fakeSocketPlugin();
    const sockets = new NativeSockets(plugin);
    const t = sockets.transport({ host: 'h', port: 1 }, 1000);
    const closes: (Error | undefined)[] = [];
    t.onClose((e) => closes.push(e));
    await t.connect();
    emit({ id: 's1', type: 'close', error: 'ECONNRESET' });
    emit({ id: 's1', type: 'close' });
    expect(closes).toHaveLength(1);
    expect(closes[0]?.message).toBe('ECONNRESET');
    const u = sockets.transport({ host: 'h', port: 1 }, 1000);
    const uCloses: unknown[] = [];
    u.onClose((e) => uCloses.push(e));
    await u.connect();
    u.close();
    expect(plugin.socketClose).toHaveBeenCalledWith({ id: 's2' });
    expect(uCloses).toEqual([]);
  });
});

describe('in-app transport', () => {
  it('copies results, waits for saving, and maps errors', async () => {
    const state = { list: [1, 2] };
    let flushed = 0;
    const bus = new EventBus();
    const t = inAppTransport({ 'x:get': () => state, 'x:fail': () => Promise.reject(new Error('boom')) }, bus, { flush: async () => void flushed++, activity: () => undefined, log: () => undefined });
    const r = await t.invoke('x:get', []);
    expect(r).toEqual({ ok: true, value: { list: [1, 2] } });
    (r as { value: { list: number[] } }).value.list.push(3);
    expect(state.list).toEqual([1, 2]);
    expect(flushed).toBe(1);
    expect(await t.invoke('x:fail', [])).toMatchObject({ ok: false, error: 'boom' });
    expect(await t.invoke('nope', [])).toMatchObject({ ok: false });
  });

  it('delivers copies of events', () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    const off = bus.on('notice', (p) => seen.push(p));
    const payload = { kind: 'received' as const, code: 'received' as const, params: { count: 1 } };
    bus.emit('notice', payload);
    off();
    bus.emit('notice', payload);
    expect(seen).toEqual([payload]);
    expect(seen[0]).not.toBe(payload);
  });
});

describe('android handlers', () => {
  const native = {
    openUrl: vi.fn(async () => undefined),
    copy: vi.fn(async () => undefined),
    paste: vi.fn(async () => ({ text: 'bX' })),
    setSecure: vi.fn(async () => undefined),
    shareText: vi.fn(async () => undefined),
    exit: vi.fn(async () => undefined),
  } as unknown as LbcNativePlugin;

  async function handlers() {
    const { backend } = memoryBackend();
    const files = await durableFiles(backend, () => undefined);
    const settings = new SettingsStore(files, 4);
    const wallets = { exportCsv: () => 'date,amount\n' } as unknown as WalletService;
    const miningInfo = { estimate: vi.fn(() => ({ networkHashrate: 0, blockReward: 0, lbcPerDay: 0, daysPerBlock: Infinity, fiatPerDay: null, basis: 'none' })), poolBalance: vi.fn(async () => null) } as unknown as MiningInfo;
    return createAndroidHandlers({ info: INFO, native, settings, wallets, miningInfo, miner: null });
  }

  it('describes an Android device that pool-mines but runs no full node', () => {
    const info = androidAppInfo(INFO, true);
    expect(info.kind).toBe('android');
    expect(info.capabilities).toEqual({ mining: true, soloMining: false, idleMining: false, node: false, ownNode: false, proxy: false });
    expect(info.runtime).toContain('Android 15');
    expect(androidAppInfo(INFO, false).capabilities.mining).toBe(false);
  });

  it('opens only https links and passes the sensitive flag to the clipboard', async () => {
    const h = await handlers();
    await expect(Promise.resolve().then(() => h['app:openExternal']!('http://example.com'))).rejects.toMatchObject({ code: 'onlyHttps' });
    await h['app:openExternal']!('https://explorer.lbry.com/tx/1');
    expect(native.openUrl).toHaveBeenCalledWith({ url: 'https://explorer.lbry.com/tx/1' });
    await h['app:copy']!('secret words', { sensitive: true });
    expect(native.copy).toHaveBeenCalledWith({ text: 'secret words', sensitive: true });
    await h['app:secureScreen']!(true);
    expect(native.setSecure).toHaveBeenCalledWith({ on: true });
  });

  it('refuses to mine without a miner (old WebView) and shares exports instead of saving them', async () => {
    const h = await handlers();
    expect(() => h['miner:start']!()).toThrow(expect.objectContaining({ code: 'miningUnsupported' }));
    expect(await h['wallet:exportCsv']!()).toEqual({ saved: false });
    expect(native.shareText).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'text/csv', text: 'date,amount\n' }));
    expect(await h['node:status']!()).toMatchObject({ state: 'off' });
  });
});

describe('services over the Android adapters', () => {
  it('creates, locks and reopens a wallet through createApi, with files saved before success', async () => {
    const { backend, disk } = memoryBackend();
    const files = await durableFiles(backend, () => undefined);
    const platform: Platform = {
      kind: 'android',
      clientName: 'LBC Wallet Android/test',
      files,
      log: () => undefined,
      lineTransport: () => {
        throw new Error('offline test');
      },
      fetchJson: async () => null,
      cpuCount: 4,
    };
    const settings = new SettingsStore(files, 4);
    // An unreachable hub: the wallet works offline and keeps retrying in the background.
    settings.update({ network: 'regtest', useDefaultHubs: false, customHubs: [{ host: '127.0.0.1', port: 9 }] });
    const bus = new EventBus();
    const price = new PriceService(platform, settings, () => undefined);
    const wallets = new WalletService(platform, settings, {
      changed: (o) => bus.emit('wallet:changed', o),
      locked: (reason) => bus.emit('wallet:locked', { reason }),
      network: (st) => bus.emit('network:status', st),
      notice: (n) => bus.emit('notice', n),
    });
    const miningInfo = new MiningInfo(platform, settings, { walletAddress: () => wallets.miningAddress(), chainTip: () => wallets.tipBits(), price: () => null });
    const handlers = { ...createCoreHandlers({ platform, settings, wallets, price, miningInfo }), ...createAndroidHandlers({ info: INFO, native: {} as LbcNativePlugin, settings, wallets, miningInfo, miner: null }) };
    const api = createApi(inAppTransport(handlers, bus, { flush: files.flush, activity: () => wallets.touch(), log: () => undefined }));

    const mnemonic = await api.wallets.generateMnemonic(12);
    const created = await api.wallets.create({ name: 'Phone', password: 'correct horse battery', source: { type: 'mnemonic', mnemonic, scheme: 'bip44' } });
    expect(created.name).toBe('Phone');
    // Saved before create() resolved: the wallet file is on "disk".
    expect([...disk.keys()].some((k) => k.startsWith('wallets/') && k.endsWith('.lbcwallet.json'))).toBe(true);
    expect(disk.get(`wallets/${created.id}.lbcwallet.json`)).not.toContain(mnemonic.split(' ')[0]! + ' ' + mnemonic.split(' ')[1]!);
    await api.wallets.lock();
    await expect(api.wallets.open(created.id, 'wrong password!')).rejects.toMatchObject({ code: 'incorrectPassword' });
    const reopened = await api.wallets.open(created.id, 'correct horse battery');
    expect(reopened.receiveAddress).toBe(created.receiveAddress);
    expect((await api.app.info()).kind).toBe('android');
    await wallets.shutdown();
  });
});
