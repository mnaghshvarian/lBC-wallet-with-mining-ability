/**
 * The Android app's JavaScript stack (file store, socket bridge, in-app API,
 * Android handlers and the shared wallet services) against a real LBC regtest
 * network: lbcd + the LBRY hub emulator. A small Node shim plays the native
 * plugin's socket part, so everything above the Java code is the real thing.
 *
 *   LBCD_BIN=/path/to/lbcd npm run test:e2e -w lbc-wallet-mobile
 */
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApi, createCoreHandlers, MiningInfo, PriceService, SettingsStore, WalletService, type LbcApi, type Platform } from '@lbcwallet/services';
import { lbcdAvailable, startRegtest, waitFor, type RegtestNode } from '../../../packages/core/e2e/harness';
import { startRegtestHub, type RegtestHub } from '../../../packages/core/e2e/regtest-hub';
import { REGTEST } from '../../../packages/core/src/networks';
import { AddressDeriver, deriveAccountKey, publicOnly } from '../../../packages/core/src/keys/hd';
import { durableFiles } from '../src/files';
import { NativeSockets } from '../src/sockets';
import { EventBus, inAppTransport } from '../src/transport';
import { createAndroidHandlers } from '../src/handlers';
import type { LbcNativePlugin, SocketEvent } from '../src/native';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PASSWORD = 'correct horse battery staple';

/** The socket half of LbcNativePlugin, on Node sockets (TCP only, like a plain hub port). */
function nodeSocketPlugin(): LbcNativePlugin {
  let listener: (e: SocketEvent) => void = () => {};
  const sockets = new Map<string, net.Socket>();
  let seq = 0;
  return {
    addListener: async (_event: 'socket', handler: (e: SocketEvent) => void) => {
      listener = handler;
      return { remove: async () => undefined };
    },
    socketConnect: ({ host, port }: { host: string; port: number }) =>
      new Promise((resolve, reject) => {
        const s = net.connect({ host, port });
        s.once('error', reject);
        s.once('connect', () => {
          s.removeListener('error', reject);
          const id = `n${++seq}`;
          sockets.set(id, s);
          let buffer = '';
          s.setEncoding('utf8');
          s.on('data', (chunk: string) => {
            buffer += chunk;
            let i: number;
            while ((i = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, i);
              buffer = buffer.slice(i + 1);
              if (line.trim()) listener({ id, type: 'line', line });
            }
          });
          s.on('error', () => undefined);
          s.on('close', () => {
            sockets.delete(id);
            listener({ id, type: 'close' });
          });
          resolve({ id });
        });
      }),
    socketWrite: async ({ id, data }: { id: string; data: string }) => {
      sockets.get(id)?.write(data);
    },
    socketClose: async ({ id }: { id: string }) => {
      sockets.get(id)?.destroy();
    },
  } as unknown as LbcNativePlugin;
}

describe.skipIf(!lbcdAvailable())('Android wallet stack against lbcd regtest', () => {
  let node: RegtestNode;
  let hub: RegtestHub;
  let api: LbcApi;
  let wallets: WalletService;

  beforeAll(async () => {
    const account = deriveAccountKey(PHRASE, 'bip44', REGTEST);
    node = await startRegtest(new AddressDeriver(publicOnly(account, REGTEST), REGTEST).derive(0, 0).address);
    await node.generate(110);
    hub = await startRegtestHub(node.rpc, { pollMs: 200 });

    const disk = new Map<string, string>();
    const files = await durableFiles(
      {
        loadFiles: async () => ({ files: {} }),
        writeFile: async ({ name, content }) => void disk.set(name, content),
        deleteFile: async ({ name }) => void disk.delete(name),
      },
      (m) => console.error(m),
    );
    const sockets = new NativeSockets(nodeSocketPlugin());
    const platform: Platform = {
      kind: 'android',
      clientName: 'LBC Wallet Android/e2e',
      files,
      log: () => undefined,
      lineTransport: (endpoint, options) => sockets.transport(endpoint, options.connectTimeoutMs),
      fetchJson: async () => null,
      cpuCount: 4,
    };
    const settings = new SettingsStore(files, 4);
    settings.update({ network: 'regtest', useDefaultHubs: false, customHubs: [{ host: '127.0.0.1', port: hub.port }], requirePasswordToSend: true });
    const bus = new EventBus();
    const price = new PriceService(platform, settings, () => undefined);
    wallets = new WalletService(platform, settings, {
      changed: (o) => bus.emit('wallet:changed', o),
      locked: (reason) => bus.emit('wallet:locked', { reason }),
      network: (st) => bus.emit('network:status', st),
      notice: (n) => bus.emit('notice', n),
    });
    const miningInfo = new MiningInfo(platform, settings, { walletAddress: () => wallets.miningAddress(), chainTip: () => wallets.tipBits(), price: () => null });
    const info = { sdkInt: 35, release: '15', webView: '140', versionName: '1.0.0', dataDir: '/data', debug: true };
    const handlers = { ...createCoreHandlers({ platform, settings, wallets, price, miningInfo }), ...createAndroidHandlers({ info, native: {} as LbcNativePlugin, settings, wallets, miningInfo }) };
    api = createApi(inAppTransport(handlers, bus, { flush: files.flush, activity: () => wallets.touch(), log: (m) => console.error(m) }));
  }, 90_000);

  afterAll(async () => {
    await wallets?.shutdown();
    await hub?.close();
    await node?.stop();
  });

  it('restores a funded wallet over the hub, sends, and sees the payment confirm', async () => {
    const scan = await api.wallets.scan(PHRASE);
    expect(scan.find((r) => r.scheme === 'bip44')!.usedAddresses).toBeGreaterThan(0);
    const restored = await api.wallets.create({ name: 'Phone', password: PASSWORD, source: { type: 'mnemonic', mnemonic: PHRASE, scheme: 'bip44' } });
    const funded = await waitFor(() => api.wallet.overview(), (o) => !!o && BigInt(o.balance.available) > 0n, 60_000, 'synced balance');
    expect(funded!.backend.connected).toBe(true);

    const to = new AddressDeriver(publicOnly(deriveAccountKey(PHRASE, 'bip44', REGTEST, { accountIndex: 1 }), REGTEST), REGTEST).derive(0, 0).address;
    const draft = await api.wallet.prepareSend({ address: to, amount: '150000000' });
    expect(draft.recipients[0]!.value).toBe('150000000');
    await expect(api.wallet.send({ draftId: draft.id, password: 'not the password' })).rejects.toMatchObject({ code: 'incorrectPassword' });
    const { txid } = await api.wallet.send({ draftId: draft.id, password: PASSWORD, label: 'From the phone' });
    expect(txid).toMatch(/^[0-9a-f]{64}$/);
    await waitFor(() => api.wallet.transactions(), (list) => list.some((t) => t.txid === txid), 20_000, 'pending transaction');

    await node.generate(1);
    const confirmed = await waitFor(() => api.wallet.transaction(txid), (t) => !!t && t.confirmations >= 1 && t.verified === true, 30_000, 'confirmed and SPV-verified');
    expect(confirmed!.label).toBe('From the phone');
    expect(confirmed!.amount.startsWith('-')).toBe(true);
    expect(restored.id).toBeTruthy();
  }, 120_000);
});
