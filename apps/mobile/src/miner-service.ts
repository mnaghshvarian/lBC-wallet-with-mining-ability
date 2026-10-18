import { MinerCoordinator, type HashThreads, type LineTransportFactory } from '@lbcwallet/core';
import {
  PHONE_MINING,
  UserError,
  describeError,
  parsePoolUrl,
  type MinerEstimateView,
  type MinerLogEntry,
  type MinerPauseReason,
  type MinerStatsView,
  type MiningInfo,
  type MiningSettings,
  type SettingsStore,
} from '@lbcwallet/services';

/** The phone's battery and temperature, as the native plugin reports them. */
export interface PowerState {
  /** Connected to a charger (also when the battery is already full). */
  pluggedIn: boolean;
  /** Battery level, 0–1. */
  level?: number;
  /** Battery temperature in °C. */
  temperature?: number;
  /** Android's thermal status: 0 none, 1 light, 2 moderate (the system throttles), up to 6 shutdown. */
  thermal: number;
  /** Battery saver is on. */
  powerSave: boolean;
}

/** Mining pauses when the battery reaches HOT_C and resumes once it is below COOL_C. */
export const HOT_C = PHONE_MINING.hotC;
export const COOL_C = PHONE_MINING.resumeC;
const THERMAL_MODERATE = 2;
/** With mining on battery allowed, it still stops below this level. */
export const LOW_BATTERY = PHONE_MINING.lowBattery;

/** Whether the phone is too warm to mine; `wasHot` adds the gap between pausing and resuming. */
export function isHot(power: PowerState, wasHot: boolean): boolean {
  const t = power.temperature;
  return power.thermal >= THERMAL_MODERATE || (t !== undefined && t >= (wasHot ? COOL_C : HOT_C));
}

/** Why switched-on mining should not run on the phone right now. */
export function phonePauseReason(mining: Pick<MiningSettings, 'pauseOnBattery'>, power: PowerState, state: { foreground: boolean; hot: boolean }): MinerPauseReason | null {
  if (!state.foreground) return 'background';
  if (state.hot) return 'hot';
  if (power.powerSave) return 'power-save';
  if (!power.pluggedIn) {
    if (mining.pauseOnBattery) return 'battery';
    if (power.level !== undefined && power.level < LOW_BATTERY) return 'battery-low';
  }
  return null;
}

const PAUSE_LOG: Record<MinerPauseReason, string> = {
  battery: 'not charging — mining waits for a charger',
  'battery-low': `battery below ${LOW_BATTERY * 100} % — mining waits for a charger`,
  hot: `phone is warm — mining paused until the battery is below ${COOL_C} °C`,
  'power-save': 'battery saver is on — mining paused',
  background: 'app is not on screen — mining paused until you come back',
  'in-use': 'mining paused',
};

/** Pauses that end without the user doing anything; the screen stays on meanwhile. */
const SELF_ENDING: MinerPauseReason[] = ['hot'];

const CHECK_EVERY_MS = 5_000;
const STATS_INTERVAL_MS = 500;
const LOG_LINES_PER_SECOND = 20;

function stoppedStats(threads: number): MinerStatsView {
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

export interface PhoneMinerDeps {
  settings: SettingsStore;
  miningInfo: MiningInfo;
  clientName: string;
  /** Sockets for the pool connection. */
  transport: LineTransportFactory;
  /** Starts hashing threads (Web Workers in the app). */
  createThreads: (count: number, onError: (message: string) => void) => Promise<HashThreads & { engine?: string }>;
  power: () => Promise<PowerState>;
  keepScreenOn: (on: boolean) => Promise<void>;
  onStats: (s: MinerStatsView) => void;
  onLog: (e: MinerLogEntry) => void;
  checkEveryMs?: number;
}

/**
 * Mines on the phone itself, through a pool: the Stratum coordinator runs
 * with the wallet services and the hashing in Web Workers. Solo mining is not
 * offered because it needs a full node. Mining only runs while the app is on
 * screen (the screen stays on meanwhile), and pauses while the phone is not
 * charging (unless allowed), warm, or in battery saver. Like on the desktop it
 * needs only a payout address, never keys, so it continues while the wallet
 * is locked.
 */
export class PhoneMinerService {
  private coordinator: MinerCoordinator | null = null;
  private threads: HashThreads | null = null;
  private stats: MinerStatsView;
  private logs: MinerLogEntry[] = [];
  private payout: string | null = null;
  private paused: MinerPauseReason | null = null;
  private wantRunning = false;
  private foreground = true;
  private hot = false;
  private screenOn = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Start, stop and pause changes run one after another. */
  private queue: Promise<unknown> = Promise.resolve();
  private perThreadRate = 0;

  constructor(private readonly deps: PhoneMinerDeps) {
    this.stats = stoppedStats(deps.settings.get().mining.threads);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  status(): MinerStatsView {
    return { ...this.stats, payoutAddress: this.payout ?? undefined, paused: this.paused ?? undefined };
  }

  getLogs(): MinerLogEntry[] {
    return [...this.logs];
  }

  /** The address the running miner pays to (for the pool balance). */
  payoutInUse(): string | null {
    return this.wantRunning ? this.payout : null;
  }

  private logWindow = { start: 0, sent: 0, held: 0 };

  private addLog(level: MinerLogEntry['level'], message: string) {
    const entry = { level, message, at: Date.now() };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
    if (entry.at - this.logWindow.start >= 1000) {
      if (this.logWindow.held > 0) this.deps.onLog({ level: 'info', message: `… ${this.logWindow.held} more lines`, at: entry.at });
      this.logWindow = { start: entry.at, sent: 0, held: 0 };
    }
    if (level !== 'error' && this.logWindow.sent >= LOG_LINES_PER_SECOND) {
      this.logWindow.held++;
      return;
    }
    this.logWindow.sent++;
    this.deps.onLog(entry);
  }

  private statsSentAt = 0;
  private statsTimer: ReturnType<typeof setTimeout> | null = null;

  /** Keeps the latest stats; the UI gets at most two updates a second, state changes at once. */
  private publish(s: MinerStatsView) {
    const stateChanged = s.state !== this.stats.state || s.paused !== this.stats.paused;
    this.stats = s;
    if (s.hashrateAvg > 0 && s.threads > 0) this.perThreadRate = s.hashrateAvg / s.threads;
    const send = () => {
      this.statsSentAt = Date.now();
      this.deps.onStats(this.status());
    };
    const wait = STATS_INTERVAL_MS - (Date.now() - this.statsSentAt);
    if (stateChanged || wait <= 0) {
      if (this.statsTimer) clearTimeout(this.statsTimer);
      this.statsTimer = null;
      send();
    } else {
      this.statsTimer ??= setTimeout(() => {
        this.statsTimer = null;
        send();
      }, wait);
    }
  }

  private async setScreenOn(on: boolean): Promise<void> {
    if (on === this.screenOn) return;
    this.screenOn = on;
    await this.deps.keepScreenOn(on).catch(() => undefined);
  }

  /** Pool settings for the coordinator; throws a user-facing error when they are incomplete. */
  private poolOptions(payout: string) {
    const settings = this.deps.settings.get();
    const m = settings.mining;
    if (m.mode !== 'pool') throw new UserError('soloUnsupported');
    const ep = parsePoolUrl(m.poolUrl);
    return {
      endpoint: { host: ep.host, port: ep.port, tls: ep.tls },
      username: m.workerName ? `${payout}.${m.workerName}` : payout,
      password: m.poolPassword || 'x',
      agent: this.deps.clientName,
      transportFactory: this.deps.transport,
    };
  }

  start(): Promise<MinerStatsView> {
    return this.serial(async () => {
      const settings = this.deps.settings.get();
      const payout = this.deps.miningInfo.payoutAddress(settings);
      this.poolOptions(payout); // validate now, even if mining starts paused
      await this.halt();
      this.payout = payout;
      this.wantRunning = true;
      this.paused = null;
      this.timer ??= setInterval(() => void this.serial(() => this.applyPause()), this.deps.checkEveryMs ?? CHECK_EVERY_MS);
      try {
        await this.applyPause(true);
      } catch (err) {
        await this.switchOff();
        this.publish(stoppedStats(settings.mining.threads));
        throw err;
      }
      return this.status();
    });
  }

  stop(): Promise<MinerStatsView> {
    return this.serial(async () => {
      const wasOn = this.wantRunning || !!this.coordinator;
      await this.switchOff();
      if (wasOn) this.addLog('info', 'mining stopped');
      this.publish(stoppedStats(this.deps.settings.get().mining.threads));
      return this.status();
    });
  }

  /** The app came to the screen or left it. */
  setForeground(foreground: boolean): Promise<void> {
    this.foreground = foreground;
    return this.serial(() => this.applyPause());
  }

  private async switchOff(): Promise<void> {
    this.wantRunning = false;
    this.paused = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.halt();
    await this.setScreenOn(false);
  }

  /** Pauses or resumes switched-on mining to match the phone's state; `first` throws start errors to the caller. */
  private async applyPause(first = false): Promise<void> {
    if (!this.wantRunning) return;
    let power: PowerState;
    try {
      power = await this.deps.power();
    } catch {
      power = { pluggedIn: true, thermal: 0, powerSave: false };
    }
    const wasHot = this.hot;
    this.hot = isHot(power, wasHot);
    if (this.hot && !wasHot) this.addLog('warn', `phone is warm (${power.temperature !== undefined ? `battery ${power.temperature.toFixed(1)} °C` : `thermal status ${power.thermal}`})`);
    const reason = phonePauseReason(this.deps.settings.get().mining, power, { foreground: this.foreground, hot: this.hot });
    if (reason) {
      const changed = reason !== this.paused;
      if (this.coordinator || changed) {
        await this.halt();
        this.paused = reason;
        this.addLog('info', PAUSE_LOG[reason]);
        this.publish({ ...stoppedStats(this.stats.threads), paused: reason });
      }
      await this.setScreenOn(this.foreground && SELF_ENDING.includes(reason));
      return;
    }
    if (this.coordinator) return;
    const was = this.paused;
    this.paused = null;
    if (was) this.addLog('info', 'resuming mining');
    try {
      await this.launch();
    } catch (err) {
      if (first) throw err;
      const e = describeError(err);
      this.addLog('error', e.message);
      await this.switchOff();
      this.publish({ ...stoppedStats(this.stats.threads), state: 'error', error: e.message, errorCode: e.code, errorParams: e.params });
    }
  }

  private async launch(): Promise<void> {
    const settings = this.deps.settings.get();
    const m = settings.mining;
    const payout = this.payout ?? this.deps.miningInfo.payoutAddress(settings);
    const options = this.poolOptions(payout);
    this.addLog('info', `starting pool mining with ${m.threads} thread${m.threads === 1 ? '' : 's'} → ${payout}`);
    this.publish({ ...stoppedStats(m.threads), state: 'starting', mode: 'pool', startedAt: Date.now() });
    let threads: HashThreads & { engine?: string };
    try {
      threads = await this.deps.createThreads(m.threads, (message) => this.addLog('error', message));
    } catch (err) {
      throw new UserError('minerEngineFailed', { detail: (err as Error).message });
    }
    const engine = threads.engine === 'simd' ? 'WebAssembly SIMD, 4 nonces per pass' : 'WebAssembly scalar';
    this.addLog('info', `${m.threads} hashing thread${m.threads === 1 ? '' : 's'} (${engine})`);
    const coordinator = new MinerCoordinator(threads);
    coordinator.on('stats', (s) => {
      if (this.coordinator === coordinator) this.publish(s);
    });
    coordinator.on('log', (e) => {
      if (this.coordinator === coordinator) this.addLog(e.level, e.message);
    });
    this.threads = threads;
    this.coordinator = coordinator;
    coordinator.startPool(options);
    await this.setScreenOn(true);
  }

  /** Stops hashing and the pool connection (mining stays switched on). */
  private async halt(): Promise<void> {
    const c = this.coordinator;
    const t = this.threads;
    this.coordinator = null;
    this.threads = null;
    await c?.stop().catch(() => undefined);
    await t?.destroy().catch(() => undefined);
  }

  estimate(): MinerEstimateView {
    const threads = this.deps.settings.get().mining.threads;
    const active = this.stats.state !== 'stopped' && this.stats.hashrateAvg > 0;
    const hashrate = active ? this.stats.hashrateAvg : this.perThreadRate * threads;
    return this.deps.miningInfo.estimate({ hashrate, mode: 'pool', networkBits: this.stats.networkBits, height: this.stats.height });
  }

  async shutdown(): Promise<void> {
    await this.serial(() => this.switchOff());
  }
}
