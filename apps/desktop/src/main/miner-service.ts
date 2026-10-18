import { join, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import { powerMonitor, utilityProcess, type UtilityProcess } from 'electron';
import { addressToScript, getNetwork, toHex } from '@lbcwallet/core';
import { UserError, describeError, parsePoolUrl, type MinerEstimateView, type MinerLogEntry, type MinerStatsView, type MiningInfo, type Settings, type SettingsStore } from '@lbcwallet/services';
import type { MinerStartMessage } from './mining/miner-process';
import { logger } from './log';
import { pauseReason, type PauseReason } from './mining/pause';

const log = logger('miner');

const PAUSE_CHECK_MS = 5_000;

const LOG_LINES_PER_SECOND = 20;
const STATS_INTERVAL_MS = 250;

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

/** RPC access to a full node for solo mining. */
export interface SoloNode {
  url: string;
  username: string;
  password: string;
  ca?: string;
  /** 0..1; solo mining needs a fully synced node. */
  progress: number;
}

export interface MinerServiceDeps {
  settings: SettingsStore;
  miningInfo: MiningInfo;
  clientName: string;
  /** The built-in node while it runs (preferred for solo mining). */
  builtInNode: () => SoloNode | null;
  onStats: (s: MinerStatsView) => void;
  onLog: (e: MinerLogEntry) => void;
  onBlock: (b: { hash: string; height: number; accepted: boolean }) => void;
}

/**
 * Controls the miner utility process (start/stop, pausing on battery or while
 * the computer is in use) and derives earnings estimates. Mining continues
 * while the wallet is locked: it only needs a payout address, never keys.
 */
export class MinerService {
  private child: UtilityProcess | null = null;
  private stats: MinerStatsView;
  private logs: MinerLogEntry[] = [];
  private payout: string | null = null;
  private paused: PauseReason | null = null;
  private pauseTimer: ReturnType<typeof setInterval> | null = null;
  private pauseBusy = false;
  private wantRunning = false;
  private perThreadRate = 0;

  constructor(private readonly deps: MinerServiceDeps) {
    this.stats = stoppedStats(deps.settings.get().mining.threads);
    powerMonitor.on('on-battery', () => void this.applyPause());
    powerMonitor.on('on-ac', () => void this.applyPause());
  }

  private currentPauseReason(): PauseReason | null {
    return pauseReason(this.deps.settings.get().mining, { onBattery: powerMonitor.isOnBatteryPower(), idleSeconds: powerMonitor.getSystemIdleTime() });
  }

  /** Pauses or resumes switched-on mining to match the power and idle state. */
  private async applyPause(): Promise<void> {
    if (!this.wantRunning || this.pauseBusy) return;
    this.pauseBusy = true;
    try {
      await this.applyPauseOnce();
    } finally {
      this.pauseBusy = false;
    }
  }

  private async applyPauseOnce(): Promise<void> {
    const reason = this.currentPauseReason();
    if (reason === this.paused) return;
    if (reason) {
      await this.stopProcess();
      if (!this.wantRunning) return;
      this.paused = reason;
      const minutes = this.deps.settings.get().mining.idleMinutes;
      this.addLog('info', reason === 'battery' ? 'on battery power — mining paused until the charger is connected' : `computer in use — mining resumes after ${minutes} min without input`);
      this.publish({ ...stoppedStats(this.stats.threads), paused: reason });
      return;
    }
    const was = this.paused;
    this.paused = null;
    this.addLog('info', was === 'battery' ? 'back on AC power — resuming mining' : 'computer idle — resuming mining');
    try {
      const settings = this.deps.settings.get();
      await this.launch(settings, this.resolvePayout(settings));
    } catch (err) {
      const e = describeError(err);
      this.addLog('error', e.message);
      this.publish({ ...stoppedStats(this.stats.threads), state: 'error', error: e.message, errorCode: e.code, errorParams: e.params });
    }
  }

  private get isActive(): boolean {
    return this.stats.state !== 'stopped';
  }

  status(): MinerStatsView {
    return { ...this.stats, payoutAddress: this.payout ?? undefined, paused: this.paused ?? undefined };
  }

  getLogs(): MinerLogEntry[] {
    return [...this.logs];
  }

  // On easy networks (regtest, testnet) solo mining finds blocks many times a
  // second; the window and the log file get a bounded stream so they stay usable.
  private logWindow = { start: 0, sent: 0, held: 0 };

  private addLog(level: MinerLogEntry['level'], message: string) {
    const entry = { level, message, at: Date.now() };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
    if (entry.at - this.logWindow.start >= 1000) {
      if (this.logWindow.held > 0) {
        const note: MinerLogEntry = { level: 'info', message: `… ${this.logWindow.held} more lines`, at: entry.at };
        log('info', note.message);
        this.deps.onLog(note);
      }
      this.logWindow = { start: entry.at, sent: 0, held: 0 };
    }
    if (level !== 'error' && this.logWindow.sent >= LOG_LINES_PER_SECOND) {
      this.logWindow.held++;
      return;
    }
    this.logWindow.sent++;
    log(level, message);
    this.deps.onLog(entry);
  }

  private statsSentAt = 0;
  private statsTimer: ReturnType<typeof setTimeout> | null = null;

  /** Keeps the latest stats; the window gets at most a few updates a second, state changes at once. */
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

  private resolvePayout(settings: Settings): string {
    return this.deps.miningInfo.payoutAddress(settings);
  }

  /** The address the running miner pays to (for the pool balance). */
  payoutInUse(): string | null {
    return this.wantRunning ? this.payout : null;
  }

  /** The node solo mining talks to: the built-in node if it runs, else the one in Settings → Network. */
  private soloNode(settings: Settings): SoloNode {
    const builtIn = this.deps.builtInNode();
    if (builtIn) {
      if (builtIn.progress < 0.999) throw new UserError('soloNodeSyncing', { progress: Math.floor(builtIn.progress * 100) });
      return builtIn;
    }
    if (!settings.lbcd.url || !settings.lbcd.username) throw new UserError('soloNeedsNode');
    let ca: string | undefined;
    if (settings.lbcd.certPath) {
      try {
        ca = readFileSync(settings.lbcd.certPath, 'utf8');
      } catch (err) {
        throw new UserError('nodeCertUnreadable', { detail: (err as Error).message });
      }
    }
    return { url: settings.lbcd.url, username: settings.lbcd.username, password: settings.lbcd.password, ca, progress: 1 };
  }

  private workerPath(name: string): string {
    // Worker scripts are unpacked from the asar archive (see electron-builder.yml).
    return join(__dirname, name).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
  }

  async start(): Promise<MinerStatsView> {
    const settings = this.deps.settings.get();
    const payout = this.resolvePayout(settings);
    this.startMessage(settings, payout); // validate now, even if mining starts paused
    await this.stopProcess();
    this.payout = payout;
    this.wantRunning = true;
    this.paused = null;
    this.pauseTimer ??= setInterval(() => void this.applyPause(), PAUSE_CHECK_MS);
    const reason = this.currentPauseReason();
    if (reason) {
      this.paused = reason;
      const minutes = settings.mining.idleMinutes;
      this.addLog('info', reason === 'battery' ? 'on battery power — mining will start when the charger is connected' : `mining will start after ${minutes} min without keyboard or mouse input`);
      this.publish({ ...stoppedStats(settings.mining.threads), paused: reason });
      return this.status();
    }
    await this.launch(settings, payout);
    return this.status();
  }

  /** The miner process configuration; throws a user-facing error when the settings are incomplete. */
  private startMessage(settings: Settings, payout: string): MinerStartMessage {
    const m = settings.mining;
    const message: MinerStartMessage = {
      type: 'start',
      mode: m.mode,
      threads: m.threads,
      lowPriority: m.lowPriority,
      workerPath: this.workerPath('hashWorker.js'),
    };
    if (m.mode === 'pool') {
      const ep = parsePoolUrl(m.poolUrl);
      message.pool = {
        ...ep,
        username: m.workerName ? `${payout}.${m.workerName}` : payout,
        password: m.poolPassword || 'x',
        agent: this.deps.clientName,
        socks5: settings.socks5.enabled ? { host: settings.socks5.host, port: settings.socks5.port } : undefined,
      };
    } else {
      const node = this.soloNode(settings);
      message.solo = {
        url: node.url,
        username: node.username,
        password: node.password,
        ca: node.ca,
        payoutScriptHex: toHex(addressToScript(payout, getNetwork(settings.network))),
      };
    }
    return message;
  }

  /** Starts the miner process with the current settings (unless mining was switched off meanwhile). */
  private async launch(settings: Settings, payout: string): Promise<void> {
    const m = settings.mining;
    const message = this.startMessage(settings, payout);
    await this.stopProcess();
    if (!this.wantRunning) return;
    this.payout = payout;
    const child = utilityProcess.fork(this.workerPath('minerProcess.js'), [], { serviceName: 'LBC Miner', stdio: 'pipe' });
    this.child = child;
    child.stdout?.on('data', (d: Buffer) => log('info', `[miner-process] ${d.toString().trim()}`));
    child.stderr?.on('data', (d: Buffer) => log('warn', `[miner-process] ${d.toString().trim()}`));
    child.on('message', (msg: { type: string; stats?: MinerStatsView; entry?: MinerLogEntry; block?: { hash: string; height: number; accepted: boolean }; error?: string }) => {
      if (this.child !== child) return;
      switch (msg.type) {
        case 'ready':
          child.postMessage(message);
          break;
        case 'stats':
          this.publish(msg.stats!);
          break;
        case 'log':
          this.addLog(msg.entry!.level, msg.entry!.message);
          break;
        case 'block':
          this.deps.onBlock(msg.block!);
          break;
        case 'failed': {
          const e = describeError(new Error(msg.error ?? ''));
          this.publish({ ...stoppedStats(m.threads), state: 'error', error: e.message, errorCode: e.code, errorParams: e.params });
          void this.stopProcess();
          break;
        }
      }
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.isActive) {
        this.addLog(code === 0 ? 'info' : 'error', `miner process exited (code ${code})`);
        const crashed = new UserError('minerCrashed');
        this.publish({ ...stoppedStats(m.threads), state: code === 0 ? 'stopped' : 'error', ...(code === 0 ? {} : { error: crashed.message, errorCode: crashed.code }) });
      }
    });
    this.addLog('info', `starting ${m.mode} mining with ${m.threads} thread${m.threads === 1 ? '' : 's'} → ${payout}`);
    this.publish({ ...stoppedStats(m.threads), state: 'starting', mode: m.mode, startedAt: Date.now() });
  }

  private async stopProcess(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 3000);
      child.once('exit', done);
      try {
        child.postMessage({ type: 'stop' });
        child.on('message', (msg: { type: string }) => {
          if (msg.type === 'stopped') child.kill();
        });
      } catch {
        child.kill();
      }
    });
  }

  private stopPauseWatch(): void {
    if (this.pauseTimer) clearInterval(this.pauseTimer);
    this.pauseTimer = null;
  }

  async stop(): Promise<MinerStatsView> {
    const wasOn = this.wantRunning || this.isActive;
    this.wantRunning = false;
    this.paused = null;
    this.stopPauseWatch();
    await this.stopProcess();
    if (wasOn) this.addLog('info', 'mining stopped');
    this.publish(stoppedStats(this.deps.settings.get().mining.threads));
    return this.status();
  }

  estimate(): MinerEstimateView {
    const threads = this.deps.settings.get().mining.threads;
    const hashrate = this.isActive && this.stats.hashrateAvg > 0 ? this.stats.hashrateAvg : this.perThreadRate * threads;
    return this.deps.miningInfo.estimate({
      hashrate,
      mode: (this.stats.mode ?? this.deps.settings.get().mining.mode) === 'solo' ? 'solo' : 'pool',
      networkBits: this.stats.networkBits,
      height: this.stats.height,
    });
  }

  async shutdown(): Promise<void> {
    this.wantRunning = false;
    this.stopPauseWatch();
    await this.stopProcess();
  }
}

