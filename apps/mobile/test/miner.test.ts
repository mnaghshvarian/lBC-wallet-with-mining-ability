import { describe, expect, it, vi } from 'vitest';
import type { HashThreads, LineTransport } from '@lbcwallet/core';
import { SettingsStore, memoryFiles, type MinerStatsView, type MiningInfo } from '@lbcwallet/services';
import { COOL_C, HOT_C, LOW_BATTERY, PhoneMinerService, isHot, phonePauseReason, type PowerState } from '../src/miner-service';

const COOL: PowerState = { pluggedIn: true, level: 0.8, temperature: 30, thermal: 0, powerSave: false };

describe('phone mining limits', () => {
  it('pauses when the phone is warm and resumes only once it has cooled down', () => {
    expect(isHot({ ...COOL, temperature: HOT_C - 0.1 }, false)).toBe(false);
    expect(isHot({ ...COOL, temperature: HOT_C }, false)).toBe(true);
    // Between the limits it stays as it was.
    expect(isHot({ ...COOL, temperature: COOL_C + 1 }, true)).toBe(true);
    expect(isHot({ ...COOL, temperature: COOL_C + 1 }, false)).toBe(false);
    expect(isHot({ ...COOL, temperature: COOL_C - 0.1 }, true)).toBe(false);
    // The system throttling the CPU counts as warm, whatever the battery says.
    expect(isHot({ ...COOL, temperature: undefined, thermal: 2 }, false)).toBe(true);
    expect(isHot({ ...COOL, temperature: undefined, thermal: 1 }, false)).toBe(false);
  });

  it('names the reason in order: off screen, warm, battery saver, battery', () => {
    const charging = { pauseOnBattery: true };
    expect(phonePauseReason(charging, COOL, { foreground: true, hot: false })).toBeNull();
    expect(phonePauseReason(charging, COOL, { foreground: false, hot: true })).toBe('background');
    expect(phonePauseReason(charging, { ...COOL, powerSave: true }, { foreground: true, hot: true })).toBe('hot');
    expect(phonePauseReason(charging, { ...COOL, pluggedIn: false, powerSave: true }, { foreground: true, hot: false })).toBe('power-save');
    expect(phonePauseReason(charging, { ...COOL, pluggedIn: false }, { foreground: true, hot: false })).toBe('battery');
    // Mining on battery allowed: until the battery runs low.
    const anywhere = { pauseOnBattery: false };
    expect(phonePauseReason(anywhere, { ...COOL, pluggedIn: false, level: LOW_BATTERY + 0.01 }, { foreground: true, hot: false })).toBeNull();
    expect(phonePauseReason(anywhere, { ...COOL, pluggedIn: false, level: LOW_BATTERY - 0.01 }, { foreground: true, hot: false })).toBe('battery-low');
  });
});

/** Threads that count how they are used; hashing itself is not needed here. */
function fakeThreads(size: number) {
  const t = { size, destroyed: false, assign: vi.fn(), idle: vi.fn(), destroy: vi.fn(async () => void (t.destroyed = true)), onHit: vi.fn(), onExhausted: vi.fn(), onHashes: vi.fn(), engine: 'simd' };
  return t;
}

/** A pool that accepts the connection and never answers: the miner stays "connecting". */
function silentPool(): LineTransport {
  let closed: (error?: Error) => void = () => {};
  return { connect: async () => undefined, send: () => undefined, close: () => closed(), onLine: () => undefined, onClose: (h) => void (closed = h) };
}

function setup(options: { power?: PowerState; threads?: () => Promise<HashThreads & { engine?: string }> } = {}) {
  const settings = new SettingsStore(memoryFiles(), 4);
  settings.update({ mining: { ...settings.get().mining, poolUrl: 'stratum+tcp://pool.example:3334', threads: 2 } });
  let power = options.power ?? COOL;
  const created: ReturnType<typeof fakeThreads>[] = [];
  const screen: boolean[] = [];
  const stats: MinerStatsView[] = [];
  const miningInfo = {
    payoutAddress: () => 'bPayoutAddress',
    estimate: vi.fn(() => ({ networkHashrate: 0, blockReward: 0, lbcPerDay: 0, daysPerBlock: Infinity, fiatPerDay: null, basis: 'none' as const })),
  } as unknown as MiningInfo;
  const miner = new PhoneMinerService({
    settings,
    miningInfo,
    clientName: 'LBC Wallet Android/test',
    transport: () => silentPool(),
    createThreads:
      options.threads ??
      (async (count) => {
        const t = fakeThreads(count);
        created.push(t);
        return t;
      }),
    power: async () => power,
    keepScreenOn: async (on) => void screen.push(on),
    onStats: (s) => void stats.push(s),
    onLog: () => undefined,
    checkEveryMs: 10,
  });
  return {
    miner,
    settings,
    created,
    screen,
    stats,
    setPower: (p: PowerState) => void (power = p),
    running: () => created.filter((t) => !t.destroyed).length,
  };
}

describe('PhoneMinerService', () => {
  it('mines while the phone is on screen, charging and cool, with the screen kept on', async () => {
    const m = setup();
    const status = await m.miner.start();
    expect(status.paused).toBeUndefined();
    expect(m.created).toHaveLength(1);
    expect(m.created[0]!.size).toBe(2);
    expect(m.screen).toEqual([true]);
    expect(m.miner.status().state).not.toBe('stopped');
    expect(m.miner.payoutInUse()).toBe('bPayoutAddress');
    await m.miner.stop();
    expect(m.running()).toBe(0);
    expect(m.screen).toEqual([true, false]);
    expect(m.miner.status()).toMatchObject({ state: 'stopped', paused: undefined });
    expect(m.miner.payoutInUse()).toBeNull();
  });

  it('waits for a charger, then starts by itself', async () => {
    const m = setup({ power: { ...COOL, pluggedIn: false } });
    expect((await m.miner.start()).paused).toBe('battery');
    expect(m.created).toHaveLength(0);
    // Waiting for the user: the screen may turn off.
    expect(m.screen).toEqual([]);
    m.setPower(COOL);
    await vi.waitFor(() => expect(m.running()).toBe(1));
    expect(m.miner.status().paused).toBeUndefined();
    await m.miner.stop();
  });

  it('pauses while warm with the screen still on, and resumes once cooled down', async () => {
    const m = setup();
    await m.miner.start();
    m.setPower({ ...COOL, temperature: HOT_C + 1 });
    await vi.waitFor(() => expect(m.miner.status().paused).toBe('hot'));
    expect(m.running()).toBe(0);
    expect(m.screen.at(-1)).toBe(true);
    m.setPower({ ...COOL, temperature: COOL_C + 1 });
    await new Promise((r) => setTimeout(r, 60));
    expect(m.miner.status().paused).toBe('hot');
    m.setPower({ ...COOL, temperature: COOL_C - 1 });
    await vi.waitFor(() => expect(m.running()).toBe(1));
    expect(m.created).toHaveLength(2);
    await m.miner.stop();
  });

  it('stops hashing when the app leaves the screen and continues when it comes back', async () => {
    const m = setup();
    await m.miner.start();
    await m.miner.setForeground(false);
    expect(m.miner.status().paused).toBe('background');
    expect(m.running()).toBe(0);
    expect(m.screen.at(-1)).toBe(false);
    await m.miner.setForeground(true);
    expect(m.running()).toBe(1);
    expect(m.screen.at(-1)).toBe(true);
    await m.miner.stop();
  });

  it('reports a miner that cannot start and leaves mining switched off', async () => {
    const m = setup({
      threads: async () => {
        throw new Error('WebAssembly.compile is not allowed');
      },
    });
    await expect(m.miner.start()).rejects.toMatchObject({ code: 'minerEngineFailed' });
    expect(m.miner.status()).toMatchObject({ state: 'stopped', paused: undefined });
    expect(m.miner.payoutInUse()).toBeNull();
    expect(m.screen).not.toContain(true);
  });

  it('only pool-mines', async () => {
    const m = setup();
    m.settings.update({ mining: { ...m.settings.get().mining, mode: 'solo' } });
    await expect(m.miner.start()).rejects.toMatchObject({ code: 'soloUnsupported' });
    expect(m.created).toHaveLength(0);
  });
});
