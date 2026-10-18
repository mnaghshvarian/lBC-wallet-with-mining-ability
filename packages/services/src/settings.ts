import { parseWebSocketUrl } from '@lbcwallet/core';
import type { HubEndpoint, MiningSettings, NodeSettings, Settings } from './api.js';
import type { JsonFiles } from './platform.js';

export const DEFAULT_POOL = 'stratum+tcp://lbrypool.net:3334';
export const SETTINGS_FILE = 'settings.json';

/** UI languages the app ships with. */
export const LANGUAGES = ['en', 'fa', 'ar', 'fr', 'de', 'zh-CN', 'ja', 'ko', 'th', 'nl', 'es', 'pt', 'ru', 'ur'] as const;

/** `device` names the miner at the pool by default ("desktop" or "phone"). */
export function defaultSettings(cpuCount: number, device: 'desktop' | 'phone' = 'desktop'): Settings {
  const threads = Math.max(1, Math.floor(cpuCount / 2));
  return {
    network: 'mainnet',
    language: 'auto',
    acceptedTerms: '',
    theme: 'system',
    fiatCurrency: 'USD',
    showFiat: true,
    hideBalances: false,
    backendMode: 'hub',
    useDefaultHubs: true,
    customHubs: [],
    socks5: { enabled: false, host: '127.0.0.1', port: 9050 },
    lbcd: { url: 'https://127.0.0.1:9245', username: '', password: '', certPath: '' },
    feePerByte: 50,
    autoLockMinutes: 15,
    requirePasswordToSend: true,
    mining: {
      mode: 'pool',
      poolUrl: DEFAULT_POOL,
      payoutAddress: '',
      workerName: device,
      poolPassword: 'x',
      threads,
      lowPriority: true,
      pauseOnBattery: true,
      onlyWhenIdle: false,
      idleMinutes: 5,
      poolApi: 'https://lbrypool.net',
    },
    node: { enabled: false, dataDir: '', listen: false, peers: [] },
    explorerTxUrl: 'https://explorer.lbry.com/tx/{txid}',
    explorerAddressUrl: 'https://explorer.lbry.com/address/{address}',
    swap: { btcExplorer: '' },
    market: { relays: [] },
    acceptedMarketTerms: '',
    lastWalletId: null,
    developerMode: false,
  };
}

const FIAT = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR', 'BRL', 'RUB', 'TRY', 'KRW', 'BTC'];

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? Math.round(v) : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function str(v: unknown, fallback: string, max = 500): string {
  return typeof v === 'string' ? v.slice(0, max) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function hubs(v: unknown): HubEndpoint[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((h): h is HubEndpoint => !!h && typeof h.host === 'string' && typeof h.port === 'number')
    .map((h) => ({ host: h.host.trim().slice(0, 253), port: clampInt(h.port, 1, 65535, 50001), tls: !!h.tls }))
    .filter((h) => /^[a-zA-Z0-9.\-:[\]]+$/.test(h.host))
    .slice(0, 32);
}

/** Merges untrusted input (file contents or UI patches) into a valid Settings object. */
/** "host:port" for a node to connect to: a host name, IPv4, or [IPv6], and a port. */
export function isPeer(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 260) return false;
  const m = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/.exec(v);
  return !!m && Number(m[2]) > 0 && Number(m[2]) < 65536;
}

export function sanitize(input: Partial<Settings> | null | undefined, base: Settings, cpuCount: number): Settings {
  const i = input ?? {};
  const m: Partial<MiningSettings> = i.mining ?? {};
  const n: Partial<NodeSettings> = i.node ?? {};
  const maxThreads = Math.max(1, cpuCount);
  return {
    network: i.network === 'testnet' || i.network === 'regtest' || i.network === 'mainnet' ? i.network : base.network,
    language: i.language === 'auto' || (LANGUAGES as readonly string[]).includes(i.language ?? '') ? i.language! : base.language,
    acceptedTerms: str(i.acceptedTerms, base.acceptedTerms, 40),
    theme: i.theme === 'dark' || i.theme === 'light' || i.theme === 'system' ? i.theme : base.theme,
    fiatCurrency: typeof i.fiatCurrency === 'string' && FIAT.includes(i.fiatCurrency) ? i.fiatCurrency : base.fiatCurrency,
    showFiat: bool(i.showFiat, base.showFiat),
    hideBalances: bool(i.hideBalances, base.hideBalances),
    backendMode: i.backendMode === 'lbcd' || i.backendMode === 'hub' || i.backendMode === 'local' ? i.backendMode : base.backendMode,
    useDefaultHubs: bool(i.useDefaultHubs, base.useDefaultHubs),
    customHubs: i.customHubs !== undefined ? hubs(i.customHubs) : base.customHubs,
    socks5: i.socks5
      ? { enabled: !!i.socks5.enabled, host: str(i.socks5.host, base.socks5.host, 253), port: clampInt(i.socks5.port, 1, 65535, base.socks5.port) }
      : base.socks5,
    lbcd: i.lbcd
      ? {
          url: str(i.lbcd.url, base.lbcd.url),
          username: str(i.lbcd.username, base.lbcd.username, 200),
          password: str(i.lbcd.password, base.lbcd.password, 200),
          certPath: str(i.lbcd.certPath, base.lbcd.certPath, 1000),
        }
      : base.lbcd,
    feePerByte: clampInt(i.feePerByte, 1, 10_000, base.feePerByte),
    autoLockMinutes: clampInt(i.autoLockMinutes, 0, 24 * 60, base.autoLockMinutes),
    requirePasswordToSend: bool(i.requirePasswordToSend, base.requirePasswordToSend),
    mining: {
      mode: m.mode === 'solo' || m.mode === 'pool' ? m.mode : base.mining.mode,
      poolUrl: str(m.poolUrl, base.mining.poolUrl, 300).trim(),
      payoutAddress: str(m.payoutAddress, base.mining.payoutAddress, 100).trim(),
      workerName: str(m.workerName, base.mining.workerName, 64).replace(/[^a-zA-Z0-9_\-]/g, ''),
      poolPassword: str(m.poolPassword, base.mining.poolPassword, 200),
      threads: clampInt(m.threads, 1, maxThreads, Math.min(base.mining.threads, maxThreads)),
      lowPriority: bool(m.lowPriority, base.mining.lowPriority),
      pauseOnBattery: bool(m.pauseOnBattery, base.mining.pauseOnBattery),
      onlyWhenIdle: bool(m.onlyWhenIdle, base.mining.onlyWhenIdle),
      idleMinutes: clampInt(m.idleMinutes, 1, 120, base.mining.idleMinutes),
      poolApi: str(m.poolApi, base.mining.poolApi, 300).trim(),
    },
    node: {
      enabled: bool(n.enabled, base.node.enabled),
      dataDir: str(n.dataDir, base.node.dataDir, 1000),
      listen: bool(n.listen, base.node.listen),
      peers: Array.isArray(n.peers) ? n.peers.filter(isPeer).slice(0, 8) : base.node.peers,
    },
    explorerTxUrl: str(i.explorerTxUrl, base.explorerTxUrl, 300),
    explorerAddressUrl: str(i.explorerAddressUrl, base.explorerAddressUrl, 300),
    swap: { btcExplorer: btcExplorer(i.swap?.btcExplorer, base.swap.btcExplorer) },
    market: { relays: i.market?.relays !== undefined ? relays(i.market.relays) : base.market.relays },
    acceptedMarketTerms: str(i.acceptedMarketTerms, base.acceptedMarketTerms, 40),
    lastWalletId: i.lastWalletId === null || typeof i.lastWalletId === 'string' ? i.lastWalletId : base.lastWalletId,
    developerMode: bool(i.developerMode, base.developerMode),
  };
}

/** Relay addresses: wss://, or ws:// to this computer (a local test relay); at most 10. */
function relays(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || item.length > 300) continue;
    const url = item.trim().replace(/\/+$/, '');
    try {
      parseWebSocketUrl(url);
    } catch {
      continue;
    }
    if (!out.includes(url)) out.push(url);
  }
  return out.slice(0, 10);
}

/** An Esplora base URL: https, or http to this computer (a local test server). */
function btcExplorer(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const url = v.trim().replace(/\/+$/, '').slice(0, 300);
  if (url === '') return '';
  return /^https:\/\/[^\s/]+/.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url) ? url : fallback;
}

export class SettingsStore {
  private current: Settings;
  private listeners: ((s: Settings, prev: Settings) => void)[] = [];

  constructor(
    private readonly files: JsonFiles,
    private readonly cpuCount: number,
    device: 'desktop' | 'phone' = 'desktop',
  ) {
    const loaded = files.read<Partial<Settings>>(SETTINGS_FILE);
    const defaults = defaultSettings(cpuCount, device);
    const merged = loaded
      ? { ...defaults, ...loaded, mining: { ...defaults.mining, ...(loaded.mining ?? {}) }, node: { ...defaults.node, ...(loaded.node ?? {}) } }
      : null;
    this.current = sanitize(merged, defaults, cpuCount);
  }

  get(): Settings {
    return structuredClone(this.current);
  }

  update(patch: Partial<Settings>): Settings {
    const prev = this.current;
    const merged = { ...prev, ...patch, mining: { ...prev.mining, ...(patch.mining ?? {}) }, node: { ...prev.node, ...(patch.node ?? {}) } };
    this.current = sanitize(merged, prev, this.cpuCount);
    this.files.write(SETTINGS_FILE, this.current);
    for (const l of this.listeners) l(this.get(), prev);
    return this.get();
  }

  onChange(listener: (s: Settings, prev: Settings) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}
