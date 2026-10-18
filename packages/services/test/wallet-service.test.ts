import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalletSession, createWalletFile, generateMnemonic, type LbcdRpc, type SwapRecord } from '@lbcwallet/core';
import { SettingsStore, UserError, WalletService, memoryFiles, type Platform, type Settings } from '../src/index';

const PASSWORD = 'correct horse battery';
/** Cheap key derivation: these tests check the service, not scrypt. */
const TEST_KDF = { N: 1 << 10, r: 8, p: 1 };

/**
 * A wallet service over in-memory files with two wallets, reading the chain
 * from a "built-in node" whose RPC refuses every call: each engine start is
 * counted and fails at once, and nothing polls in the background.
 */
async function setup(patch: Partial<Settings> = {}) {
  const files = memoryFiles();
  const ids: string[] = [];
  for (const name of ['first', 'second']) {
    const file = await createWalletFile({ name, network: 'regtest', source: { type: 'mnemonic', mnemonic: generateMnemonic(12), scheme: 'bip44' }, password: PASSWORD, kdfCost: TEST_KDF });
    files.write(`wallets/${file.id}.lbcwallet.json`, file);
    ids.push(file.id);
  }
  const logs: string[] = [];
  const platform: Platform = {
    kind: 'desktop',
    clientName: 'test',
    files,
    log: (_level, scope, message) => logs.push(`${scope}: ${message}`),
    lineTransport: () => {
      throw new Error('no network in this test');
    },
    fetchJson: async () => null,
    cpuCount: 2,
  };
  const settings = new SettingsStore(memoryFiles(), 2);
  settings.update({ network: 'regtest', backendMode: 'local', autoLockMinutes: 0, ...patch });
  const locked: string[] = [];
  const wallets = new WalletService(platform, settings, { changed: () => undefined, locked: (reason) => locked.push(reason), network: () => undefined, notice: () => undefined });
  let engineStarts = 0;
  const rpc = {
    call: async (method: string) => {
      if (method === 'getblockchaininfo') engineStarts++;
      throw new Error('no node in this test');
    },
  } as unknown as LbcdRpc;
  wallets.setLocalNode(() => ({ rpc, label: 'test node', synced: true }));
  return { wallets, settings, id: ids[0]!, otherId: ids[1]!, logs, locked, engineStarts: () => engineStarts };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('opening and locking', () => {
  it('unlocks once when the same wallet is opened twice at the same time', async () => {
    const s = await setup();
    const unlock = vi.spyOn(WalletSession, 'unlock');
    const [a, b] = await Promise.all([s.wallets.open(s.id, PASSWORD), s.wallets.open(s.id, PASSWORD)]);
    expect(a.id).toBe(s.id);
    expect(b).toMatchObject({ id: s.id, receiveAddress: a.receiveAddress });
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(s.engineStarts()).toBe(1);
    expect(s.logs.filter((l) => l === `wallet: opened wallet ${s.id}`)).toHaveLength(1);
    expect(s.wallets.isOpen).toBe(true);
    await s.wallets.shutdown();
  });

  it('opens a different wallet asked for meanwhile after the first one', async () => {
    const s = await setup();
    const [a, b] = await Promise.all([s.wallets.open(s.id, PASSWORD), s.wallets.open(s.otherId, PASSWORD)]);
    expect(a.id).toBe(s.id);
    expect(b.id).toBe(s.otherId);
    expect(s.wallets.overview()?.id).toBe(s.otherId);
    expect(s.engineStarts()).toBe(2);
    await s.wallets.shutdown();
  });

  it('tries the next password when the first one was wrong', async () => {
    const s = await setup();
    const [wrong, right] = await Promise.allSettled([s.wallets.open(s.id, 'not it'), s.wallets.open(s.id, PASSWORD)]);
    expect(wrong.status).toBe('rejected');
    expect((wrong as PromiseRejectedResult).reason).toBeInstanceOf(UserError);
    expect((wrong as PromiseRejectedResult).reason).toMatchObject({ code: 'incorrectPassword' });
    expect((wrong as PromiseRejectedResult).reason).toMatchObject({ code: 'incorrectPassword' });
    expect(right.status).toBe('fulfilled');
    expect(s.wallets.isOpen).toBe(true);
    expect(s.engineStarts()).toBe(1);
    await s.wallets.shutdown();
  });

  it('lets a lock wait for the unlock in flight', async () => {
    const s = await setup();
    const opening = s.wallets.open(s.id, PASSWORD);
    const locking = s.wallets.lock();
    await Promise.all([opening, locking]);
    expect(s.wallets.isOpen).toBe(false);
    expect(s.locked).toEqual(['manual']);
  });
});

describe('password on send', () => {
  it('tells the UI whether the keys stay in memory', async () => {
    const s = await setup();
    expect((await s.wallets.open(s.id, PASSWORD)).keysInMemory).toBe(false);
    // Switching the setting off after unlocking does not put the keys in memory: sending still needs the password.
    s.settings.update({ requirePasswordToSend: false });
    expect(s.wallets.overview()?.keysInMemory).toBe(false);
    await s.wallets.lock();
    expect((await s.wallets.open(s.id, PASSWORD)).keysInMemory).toBe(true);
    await s.wallets.shutdown();
  });
});

describe('auto-lock', () => {
  it('locks after the idle time when nothing is running', async () => {
    const s = await setup();
    await s.wallets.open(s.id, PASSWORD);
    vi.useFakeTimers();
    s.wallets.setActiveWork(() => false);
    s.settings.update({ autoLockMinutes: 2 });
    await vi.advanceTimersByTimeAsync(2 * 60_000 - 1);
    expect(s.wallets.isOpen).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.wallets.isOpen).toBe(false);
    expect(s.locked).toEqual(['timeout']);
  });

  it('waits for running work before locking for inactivity, and says so once', async () => {
    const s = await setup();
    await s.wallets.open(s.id, PASSWORD);
    vi.useFakeTimers();
    let active = true;
    s.wallets.setActiveWork(() => active);
    s.settings.update({ autoLockMinutes: 2 });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(s.wallets.isOpen).toBe(true);
    expect(s.locked).toEqual([]);
    expect(s.logs.filter((l) => l.includes('auto-lock postponed'))).toHaveLength(1);
    active = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.wallets.isOpen).toBe(false);
    expect(s.locked).toEqual(['timeout']);
  });

  it("counts the open wallet's running swaps as work by default", async () => {
    const s = await setup();
    await s.wallets.open(s.id, PASSWORD);
    vi.useFakeTimers();
    const swap = { id: '0123456789abcdef', status: 'active' } as SwapRecord;
    s.wallets.swapWallet()!.saveRecords([swap]);
    s.settings.update({ autoLockMinutes: 1 });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(s.wallets.isOpen).toBe(true);
    s.wallets.swapWallet()!.saveRecords([{ ...swap, status: 'completed' }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.wallets.isOpen).toBe(false);
    expect(s.locked).toEqual(['timeout']);
  });
});
