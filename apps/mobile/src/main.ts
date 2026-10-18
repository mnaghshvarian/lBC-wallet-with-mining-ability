/// <reference path="../../../packages/ui/src/env.d.ts" />
import { App as CapApp } from '@capacitor/app';
import { SystemBars, SystemBarsStyle } from '@capacitor/core';
import { createApi, createCoreHandlers, MiningInfo, PriceService, SettingsStore, WalletService } from '@lbcwallet/services';
import { goBack, mountApp } from '@lbcwallet/ui';
import { durableFiles } from './files';
import { createAndroidHandlers } from './handlers';
import { LbcNative } from './native';
import { androidPlatform } from './platform';
import { NativeSockets } from './sockets';
import { EventBus, inAppTransport } from './transport';

async function main(): Promise<void> {
  const info = await LbcNative.info();
  const files = await durableFiles(LbcNative, (message) => console.error(`[files] ${message}`));
  const platform = androidPlatform(info, files, new NativeSockets(LbcNative));
  const settings = new SettingsStore(files, platform.cpuCount);
  const bus = new EventBus();

  const price = new PriceService(platform, settings, (p) => bus.emit('price:update', p));
  const wallets = new WalletService(platform, settings, {
    changed: (o) => bus.emit('wallet:changed', o),
    locked: (reason) => bus.emit('wallet:locked', { reason }),
    network: (st) => bus.emit('network:status', st),
    notice: (n) => bus.emit('notice', n),
  });
  const miningInfo = new MiningInfo(platform, settings, {
    walletAddress: () => wallets.miningAddress(),
    chainTip: () => wallets.tipBits(),
    price: () => price.get()?.price ?? null,
  });
  const handlers = {
    ...createCoreHandlers({ platform, settings, wallets, price, miningInfo }),
    ...createAndroidHandlers({ info, native: LbcNative, settings, wallets, miningInfo }),
  };
  window.lbc = createApi(inAppTransport(handlers, bus, { flush: files.flush, activity: () => wallets.touch(), log: (m) => platform.log('error', 'api', m) }));
  price.start();

  // Timers don't run reliably while the app is in the background, so the
  // auto-lock is also checked when the user comes back.
  let pausedAt = Date.now();
  void CapApp.addListener('pause', () => {
    pausedAt = Date.now();
  });
  void CapApp.addListener('resume', () => {
    const minutes = settings.get().autoLockMinutes;
    if (wallets.isOpen && minutes > 0 && Date.now() - pausedAt >= minutes * 60_000) void wallets.lock('timeout');
  });
  void CapApp.addListener('backButton', () => {
    if (!goBack()) void CapApp.minimizeApp();
  });

  // Status and navigation bar icons that stay readable on the app's theme.
  const applyBars = () => {
    const theme = settings.get().theme;
    const style = theme === 'dark' ? SystemBarsStyle.Dark : theme === 'light' ? SystemBarsStyle.Light : SystemBarsStyle.Default;
    void SystemBars.setStyle({ style }).catch(() => undefined);
  };
  applyBars();
  settings.onChange((next, prev) => {
    if (next.theme !== prev.theme) applyBars();
  });

  mountApp(document.getElementById('root')!);
}

main().catch((err: unknown) => {
  console.error(err);
  const root = document.getElementById('root');
  if (root) root.textContent = `LBC Wallet could not start: ${(err as Error)?.message ?? String(err)}`;
});
