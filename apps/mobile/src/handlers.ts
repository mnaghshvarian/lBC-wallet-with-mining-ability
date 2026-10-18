import { UserError, text, type AppInfo, type Handlers, type MinerStatsView, type MiningInfo, type NodeStatusView, type SettingsStore, type WalletService } from '@lbcwallet/services';
import type { DeviceInfo, LbcNativePlugin } from './native';

export interface AndroidServices {
  info: DeviceInfo;
  native: LbcNativePlugin;
  settings: SettingsStore;
  wallets: WalletService;
  miningInfo: MiningInfo;
}

export function androidAppInfo(info: DeviceInfo): AppInfo {
  return {
    name: 'LBC Wallet',
    version: info.versionName,
    kind: 'android',
    platform: 'android',
    arch: '',
    runtime: `Android ${info.release} (API ${info.sdkInt}) · WebView ${info.webView}`,
    dataDir: info.dataDir,
    cpuCount: Math.max(1, navigator.hardwareConcurrency || 1),
    isPackaged: !info.debug,
    // Phones don't mine or run a full node; the UI hides those features.
    capabilities: { mining: false, node: false, ownNode: false, proxy: false },
  };
}

function idleMiner(threads: number): MinerStatsView {
  return {
    state: 'stopped',
    mode: null,
    threads,
    hashrate: 0,
    hashrateAvg: 0,
    totalHashes: 0,
    accepted: 0,
    rejected: 0,
    blocksFound: 0,
    difficulty: 0,
    height: null,
    networkBits: null,
    startedAt: null,
    lastShareAt: null,
    lastJobAt: null,
  };
}

function nodeOff(s: AndroidServices): NodeStatusView {
  return {
    state: 'off',
    network: s.settings.get().network,
    dataDir: '',
    height: 0,
    headers: 0,
    networkHeight: null,
    progress: 0,
    peers: 0,
    diskUsed: null,
    diskFree: null,
    etaSeconds: null,
    listen: false,
    startedAt: null,
    version: null,
  };
}

/** Handlers that differ from the desktop app. */
export function createAndroidHandlers(s: AndroidServices): Handlers {
  return {
    'app:info': () => androidAppInfo(s.info),
    'app:openExternal': async (url: unknown) => {
      const u = text(url, 'url', 2000);
      if (!/^https:\/\//i.test(u)) throw new UserError('onlyHttps');
      await s.native.openUrl({ url: u });
    },
    'app:copy': async (value: unknown, opts?: unknown) => {
      const sensitive = !!(opts && typeof opts === 'object' && (opts as { sensitive?: unknown }).sensitive === true);
      await s.native.copy({ text: text(value, 'text', 10_000), sensitive });
    },
    'app:paste': async () => (await s.native.paste()).text.slice(0, 10_000),
    'app:quit': () => s.native.exit(),
    'app:secureScreen': (on: unknown) => s.native.setSecure({ on: on === true }),

    'wallet:exportCsv': async () => {
      const csv = s.wallets.exportCsv();
      const date = new Date().toISOString().slice(0, 10);
      await s.native.shareText({ filename: `lbc-transactions-${date}.csv`, mimeType: 'text/csv', text: csv, title: 'LBC transactions' });
      return { saved: false };
    },

    'miner:status': () => idleMiner(s.settings.get().mining.threads),
    'miner:start': () => {
      throw new UserError('miningUnsupported');
    },
    'miner:stop': () => idleMiner(s.settings.get().mining.threads),
    'miner:logs': () => [],
    'miner:estimate': () => s.miningInfo.estimate({ hashrate: 0, mode: s.settings.get().mining.mode, networkBits: null, height: null }),
    'miner:poolBalance': () => s.miningInfo.poolBalance(),

    'node:status': () => nodeOff(s),
    'node:requirements': () => ({ diskGb: 0, ramGb: 0, systemRamGb: 0, defaultDataDir: '' }),
    'node:start': () => {
      throw new UserError('nodeBinaryMissing');
    },
    'node:stop': () => nodeOff(s),
    'node:chooseDataDir': () => null,
    'node:openDataDir': () => undefined,
    'node:logs': () => [],
  };
}
