import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings, sanitize, SettingsStore } from '../src/main/settings';
import { readJson, writeJsonAtomic } from '../src/main/store';
import type { Settings } from '../src/shared/api';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'lbc-wallet-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('settings sanitizing', () => {
  const base = defaultSettings();

  it('keeps valid values and replaces invalid ones with the previous value', () => {
    const s = sanitize(
      {
        network: 'moonnet' as Settings['network'],
        theme: 'light',
        feePerByte: 0,
        autoLockMinutes: 99_999,
        socks5: { enabled: true, host: '127.0.0.1', port: 99_999 },
        customHubs: [{ host: 'hub.example.com', port: 50001 }, { host: 'evil host;rm', port: 1 }] as Settings['customHubs'],
      },
      base,
    );
    expect(s.network).toBe(base.network);
    expect(s.theme).toBe('light');
    expect(s.feePerByte).toBe(1);
    expect(s.autoLockMinutes).toBe(24 * 60);
    expect(s.socks5).toEqual({ enabled: true, host: '127.0.0.1', port: 65535 });
    expect(s.customHubs).toEqual([{ host: 'hub.example.com', port: 50001, tls: false }]);
  });

  it('bounds mining settings', () => {
    const s = sanitize({ mining: { ...base.mining, threads: 10_000, idleMinutes: 0, workerName: 'rig 1;', onlyWhenIdle: true } }, base);
    expect(s.mining.threads).toBe(cpus().length);
    expect(s.mining.idleMinutes).toBe(1);
    expect(s.mining.workerName).toBe('rig1');
    expect(s.mining.onlyWhenIdle).toBe(true);
  });

  it('fills settings saved by older versions with current defaults', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', mining: { threads: 1 } }));
    const s = new SettingsStore(dir).get();
    expect(s.theme).toBe('dark');
    expect(s.mining.threads).toBe(1);
    expect(s.mining.onlyWhenIdle).toBe(false);
    expect(s.mining.idleMinutes).toBe(5);
    expect(s.requirePasswordToSend).toBe(true);
  });

  it('persists updates and notifies listeners', () => {
    const dir = tempDir();
    const store = new SettingsStore(dir);
    const seen: [boolean, boolean][] = [];
    store.onChange((next, prev) => seen.push([next.showFiat, prev.showFiat]));
    store.update({ showFiat: false });
    expect(seen).toEqual([[false, true]]);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).showFiat).toBe(false);
    expect(new SettingsStore(dir).get().showFiat).toBe(false);
  });
});

describe('atomic JSON storage', () => {
  it('falls back to the backup when the main file is corrupt', () => {
    const file = join(tempDir(), 'wallet.json');
    writeJsonAtomic(file, { v: 1 }, { backup: true });
    writeJsonAtomic(file, { v: 2 }, { backup: true });
    expect(readJson(file)).toEqual({ v: 2 });
    writeFileSync(file, '{"v": 3, truncated');
    expect(readJson(file)).toEqual({ v: 1 });
  });
});
