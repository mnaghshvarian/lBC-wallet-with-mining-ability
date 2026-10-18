import { join } from 'node:path';
import { cpus } from 'node:os';
import type { HubEndpoint, MiningSettings, Settings } from '../shared/api';
import { readJson, writeJsonAtomic } from './store';

export const DEFAULT_POOL = 'stratum+tcp://lbrypool.net:3334';

export function defaultSettings(): Settings {
  const threads = Math.max(1, Math.floor(cpus().length / 2));
  return {
    network: 'mainnet',
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
      workerName: 'desktop',
      poolPassword: 'x',
      threads,
      lowPriority: true,
      pauseOnBattery: true,
      poolApi: 'https://lbrypool.net',
    },
    explorerTxUrl: 'https://explorer.lbry.com/tx/{txid}',
    explorerAddressUrl: 'https://explorer.lbry.com/address/{address}',
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

function hubs(v: unknown): HubEndpoint[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((h): h is HubEndpoint => !!h && typeof h.host === 'string' && typeof h.port === 'number')
    .map((h) => ({ host: h.host.trim().slice(0, 253), port: clampInt(h.port, 1, 65535, 50001), tls: !!h.tls }))
    .filter((h) => /^[a-zA-Z0-9.\-:[\]]+$/.test(h.host))
    .slice(0, 32);
}

/** Merges untrusted input (file contents or renderer patches) into a valid Settings object. */
export function sanitize(input: Partial<Settings> | null | undefined, base: Settings): Settings {
  const i = input ?? {};
  const m: Partial<MiningSettings> = i.mining ?? {};
  const maxThreads = cpus().length;
  return {
    network: i.network === 'testnet' || i.network === 'regtest' || i.network === 'mainnet' ? i.network : base.network,
    theme: i.theme === 'dark' || i.theme === 'light' || i.theme === 'system' ? i.theme : base.theme,
    fiatCurrency: typeof i.fiatCurrency === 'string' && FIAT.includes(i.fiatCurrency) ? i.fiatCurrency : base.fiatCurrency,
    showFiat: typeof i.showFiat === 'boolean' ? i.showFiat : base.showFiat,
    hideBalances: typeof i.hideBalances === 'boolean' ? i.hideBalances : base.hideBalances,
    backendMode: i.backendMode === 'lbcd' || i.backendMode === 'hub' ? i.backendMode : base.backendMode,
    useDefaultHubs: typeof i.useDefaultHubs === 'boolean' ? i.useDefaultHubs : base.useDefaultHubs,
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
    requirePasswordToSend: typeof i.requirePasswordToSend === 'boolean' ? i.requirePasswordToSend : base.requirePasswordToSend,
    mining: {
      mode: m.mode === 'solo' || m.mode === 'pool' ? m.mode : base.mining.mode,
      poolUrl: str(m.poolUrl, base.mining.poolUrl, 300).trim(),
      payoutAddress: str(m.payoutAddress, base.mining.payoutAddress, 100).trim(),
      workerName: str(m.workerName, base.mining.workerName, 64).replace(/[^a-zA-Z0-9_\-]/g, ''),
      poolPassword: str(m.poolPassword, base.mining.poolPassword, 200),
      threads: clampInt(m.threads, 1, maxThreads, Math.min(base.mining.threads, maxThreads)),
      lowPriority: typeof m.lowPriority === 'boolean' ? m.lowPriority : base.mining.lowPriority,
      pauseOnBattery: typeof m.pauseOnBattery === 'boolean' ? m.pauseOnBattery : base.mining.pauseOnBattery,
      poolApi: str(m.poolApi, base.mining.poolApi, 300).trim(),
    },
    explorerTxUrl: str(i.explorerTxUrl, base.explorerTxUrl, 300),
    explorerAddressUrl: str(i.explorerAddressUrl, base.explorerAddressUrl, 300),
    lastWalletId: i.lastWalletId === null || typeof i.lastWalletId === 'string' ? i.lastWalletId : base.lastWalletId,
    developerMode: typeof i.developerMode === 'boolean' ? i.developerMode : base.developerMode,
  };
}

export class SettingsStore {
  private current: Settings;
  private listeners: ((s: Settings, prev: Settings) => void)[] = [];

  constructor(private readonly dir: string) {
    const loaded = readJson<Partial<Settings>>(this.path);
    const defaults = defaultSettings();
    this.current = sanitize(loaded ? { ...defaults, ...loaded, mining: { ...defaults.mining, ...(loaded.mining ?? {}) } } : null, defaults);
  }

  private get path(): string {
    return join(this.dir, 'settings.json');
  }

  get(): Settings {
    return structuredClone(this.current);
  }

  update(patch: Partial<Settings>): Settings {
    const prev = this.current;
    const merged = { ...prev, ...patch, mining: { ...prev.mining, ...(patch.mining ?? {}) } };
    this.current = sanitize(merged, prev);
    writeJsonAtomic(this.path, this.current);
    for (const l of this.listeners) l(this.get(), prev);
    return this.get();
  }

  onChange(listener: (s: Settings, prev: Settings) => void): void {
    this.listeners.push(listener);
  }
}
