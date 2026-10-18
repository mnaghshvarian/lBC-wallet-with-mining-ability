import { describe, expect, it } from 'vitest';
import { defaultSettings, sanitize, SettingsStore, SETTINGS_FILE } from '../src/settings.js';
import { memoryFiles } from '../src/memory-files.js';
import type { Settings } from '../src/api.js';

const CPUS = 8;

describe('settings sanitizing', () => {
  const base = defaultSettings(CPUS);

  it('keeps valid values and replaces invalid ones with the previous value', () => {
    const s = sanitize(
      {
        network: 'moonnet' as Settings['network'],
        theme: 'light',
        feePerByte: 0,
        autoLockMinutes: 99_999,
        socks5: { enabled: true, host: '127.0.0.1', port: 99_999 },
        customHubs: [{ host: 'hub.example.com', port: 50001 }, { host: 'evil host;rm', port: 1 }] as Settings['customHubs'],
        language: 'xx',
        backendMode: 'local',
      },
      base,
      CPUS,
    );
    expect(s.network).toBe(base.network);
    expect(s.theme).toBe('light');
    expect(s.feePerByte).toBe(1);
    expect(s.autoLockMinutes).toBe(24 * 60);
    expect(s.socks5).toEqual({ enabled: true, host: '127.0.0.1', port: 65535 });
    expect(s.customHubs).toEqual([{ host: 'hub.example.com', port: 50001, tls: false }]);
    expect(s.language).toBe('auto');
    expect(s.backendMode).toBe('local');
  });

  it('keeps only relay addresses that are wss://, or ws:// on this computer', () => {
    const s = sanitize(
      { market: { relays: ['wss://relay.example.org/', 'ws://relay.example.org', 'ws://127.0.0.1:7447', 'https://relay.example.org', 'wss://relay.example.org', 'wss://user:pw@relay.example.org', 42 as unknown as string] } },
      base,
      CPUS,
    );
    expect(s.market.relays).toEqual(['wss://relay.example.org', 'ws://127.0.0.1:7447']);
    expect(base.market.relays).toEqual([]);
    expect(sanitize({ market: { relays: Array.from({ length: 20 }, (_, i) => `wss://r${i}.example.org`) } }, base, CPUS).market.relays).toHaveLength(10);
  });

  it('accepts every shipped language', () => {
    for (const lang of ['fa', 'ar', 'zh-CN', 'ur', 'hi', 'th', 'nl']) expect(sanitize({ language: lang }, base, CPUS).language).toBe(lang);
  });

  it('accepts only the Bitcoin units it knows', () => {
    for (const unit of ['auto', 'btc', 'sats', 'sci'] as const) expect(sanitize({ bitcoinUnit: unit }, base, CPUS).bitcoinUnit).toBe(unit);
    expect(sanitize({ bitcoinUnit: 'mbtc' as never }, base, CPUS).bitcoinUnit).toBe('auto');
  });

  it('bounds mining and node settings', () => {
    const s = sanitize(
      { mining: { ...base.mining, threads: 10_000, idleMinutes: 0, workerName: 'rig 1;', onlyWhenIdle: true }, node: { enabled: true, dataDir: '/data/lbc', listen: 'yes' as unknown as boolean, peers: ['node.example.com:9246', '10.0.0.2:9246', '[2001:db8::1]:9246', 'bad host:1', 'x:0', 'x:70000', 42 as unknown as string] } },
      base,
      CPUS,
    );
    expect(s.mining.threads).toBe(CPUS);
    expect(s.mining.idleMinutes).toBe(1);
    expect(s.mining.workerName).toBe('rig1');
    expect(s.mining.onlyWhenIdle).toBe(true);
    expect(s.node).toEqual({ enabled: true, dataDir: '/data/lbc', listen: false, peers: ['node.example.com:9246', '10.0.0.2:9246', '[2001:db8::1]:9246'] });
  });

  it('fills settings saved by older versions with current defaults', () => {
    const files = memoryFiles({ [SETTINGS_FILE]: JSON.stringify({ theme: 'dark', mining: { threads: 1 } }) });
    const s = new SettingsStore(files, CPUS).get();
    expect(s.theme).toBe('dark');
    expect(s.mining.threads).toBe(1);
    expect(s.mining.onlyWhenIdle).toBe(false);
    expect(s.mining.idleMinutes).toBe(5);
    expect(s.requirePasswordToSend).toBe(true);
    expect(s.language).toBe('auto');
    expect(s.acceptedTerms).toBe('');
    expect(s.node).toEqual({ enabled: false, dataDir: '', listen: false, peers: [] });
  });

  it('names the miner after the device', () => {
    expect(new SettingsStore(memoryFiles(), CPUS).get().mining.workerName).toBe('desktop');
    expect(new SettingsStore(memoryFiles(), CPUS, 'phone').get().mining.workerName).toBe('phone');
  });

  it('persists updates and notifies listeners', () => {
    const files = memoryFiles();
    const store = new SettingsStore(files, CPUS);
    const seen: [boolean, boolean][] = [];
    const off = store.onChange((next, prev) => seen.push([next.showFiat, prev.showFiat]));
    store.update({ showFiat: false });
    expect(seen).toEqual([[false, true]]);
    expect(files.read<Settings>(SETTINGS_FILE)?.showFiat).toBe(false);
    expect(new SettingsStore(files, CPUS).get().showFiat).toBe(false);
    off();
    store.update({ showFiat: true });
    expect(seen).toHaveLength(1);
  });
});

describe('memory files', () => {
  it('keeps a backup and falls back to it', () => {
    const writes: string[] = [];
    const files = memoryFiles({}, (name) => writes.push(name));
    files.write('wallets/a.lbcwallet.json', { v: 1 }, { backup: true });
    files.write('wallets/a.lbcwallet.json', { v: 2 }, { backup: true });
    expect(files.read('wallets/a.lbcwallet.json')).toEqual({ v: 2 });
    expect(files.list('wallets', '.lbcwallet.json')).toEqual(['wallets/a.lbcwallet.json']);
    files.remove('wallets/a.lbcwallet.json');
    expect(files.read('wallets/a.lbcwallet.json')).toBeNull();
    expect(writes).toEqual(['wallets/a.lbcwallet.json', 'wallets/a.lbcwallet.json.bak', 'wallets/a.lbcwallet.json', 'wallets/a.lbcwallet.json', 'wallets/a.lbcwallet.json.bak']);
  });
});
