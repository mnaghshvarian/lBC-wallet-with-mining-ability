import { join, sep } from 'node:path';
import { readFileSync } from 'node:fs';
import { net, powerMonitor, utilityProcess, type UtilityProcess } from 'electron';
import { addressToScript, blockSubsidy, decodeAddress, estimateEarnings, getNetwork, networkHashrateFromBits, toHex } from '@lbcwallet/core';
import type { MinerEstimateView, MinerLogEntry, MinerStatsView, PoolBalanceView, Settings } from '../shared/api';
import type { SettingsStore } from './settings';
import type { MinerStartMessage } from './mining/miner-process';
import { logger } from './log';
import { CLIENT_NAME } from './backend';
import { pauseReason, type PauseReason } from './mining/pause';
import { parsePoolUrl } from './mining/pool-url';

const log = logger('miner');

const PAUSE_CHECK_MS = 5_000;

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

export interface MinerServiceDeps {
  settings: SettingsStore;
  /** Address of the open wallet, used when no payout address is configured. */
  walletAddress: () => string | null;
  /** Height and difficulty bits of the wallet's chain tip, for estimates when idle. */
  chainTip: () => { height: number; bits: number } | null;
  price: () => number | null;
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
  private poolBalanceCache: { at: number; address: string; value: PoolBalanceView | null } | null = null;

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
      this.addLog('error', (err as Error).message);
      this.publish({ ...stoppedStats(this.stats.threads), state: 'error', error: (err as Error).message });
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

  private addLog(level: MinerLogEntry['level'], message: string) {
    const entry = { level, message, at: Date.now() };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
    log(level, message);
    this.deps.onLog(entry);
  }

  private publish(s: MinerStatsView) {
    this.stats = s;
    if (s.hashrateAvg > 0 && s.threads > 0) this.perThreadRate = s.hashrateAvg / s.threads;
    this.deps.onStats(this.status());
  }

  private resolvePayout(settings: Settings): string {
    const network = getNetwork(settings.network);
    const address = settings.mining.payoutAddress || this.deps.walletAddress();
    if (!address) throw new Error('Open a wallet (or set a payout address in mining settings) before you start mining.');
    try {
      decodeAddress(address, network);
    } catch (err) {
      throw new Error(`Payout address is invalid: ${(err as Error).message}`);
    }
    return address;
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
        agent: CLIENT_NAME,
        socks5: settings.socks5.enabled ? { host: settings.socks5.host, port: settings.socks5.port } : undefined,
      };
    } else {
      if (!settings.lbcd.url || !settings.lbcd.username) throw new Error('Solo mining needs your own lbcd node. Configure it in Settings → Network → Full node.');
      let ca: string | undefined;
      if (settings.lbcd.certPath) ca = readFileSync(settings.lbcd.certPath, 'utf8');
      message.solo = {
        url: settings.lbcd.url,
        username: settings.lbcd.username,
        password: settings.lbcd.password,
        ca,
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
        case 'failed':
          this.publish({ ...stoppedStats(m.threads), state: 'error', error: msg.error });
          void this.stopProcess();
          break;
      }
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.isActive) {
        this.addLog(code === 0 ? 'info' : 'error', `miner process exited (code ${code})`);
        this.publish({ ...stoppedStats(m.threads), state: code === 0 ? 'stopped' : 'error', error: code === 0 ? undefined : 'Miner stopped unexpectedly' });
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
    const tip = this.deps.chainTip();
    const bits = this.stats.networkBits ?? tip?.bits ?? null;
    const height = this.stats.height ?? tip?.height ?? null;
    const threads = this.deps.settings.get().mining.threads;
    const hashrate = this.isActive && this.stats.hashrateAvg > 0 ? this.stats.hashrateAvg : this.perThreadRate * threads;
    if (!bits || height === null) return { networkHashrate: 0, blockReward: 0, lbcPerDay: 0, daysPerBlock: Infinity, fiatPerDay: null, basis: 'none' };
    const networkHashrate = networkHashrateFromBits(bits);
    const e = estimateEarnings({ hashrate, networkHashrate, height, poolFeePercent: this.stats.mode === 'solo' ? 0 : 0.5 });
    const price = this.deps.price();
    return {
      networkHashrate,
      blockReward: Number(blockSubsidy(height)) / 1e8,
      lbcPerDay: e.lbcPerDay,
      daysPerBlock: e.daysPerBlock,
      fiatPerDay: price !== null ? e.lbcPerDay * price : null,
      basis: 'difficulty',
    };
  }

  /** Unpaid/paid balance at a yiimp-compatible pool (e.g. lbrypool.net). */
  async poolBalance(): Promise<PoolBalanceView | null> {
    const settings = this.deps.settings.get();
    const api = settings.mining.poolApi.replace(/\/+$/, '');
    let address: string;
    try {
      address = this.payout ?? this.resolvePayout(settings);
    } catch {
      return null;
    }
    if (!api || settings.mining.mode !== 'pool' || settings.network !== 'mainnet') return null;
    if (this.poolBalanceCache && this.poolBalanceCache.address === address && Date.now() - this.poolBalanceCache.at < 120_000) return this.poolBalanceCache.value;
    let value: PoolBalanceView | null = null;
    try {
      if (!/^https:\/\//.test(api)) throw new Error('pool API must use https');
      const res = await net.fetch(`${api}/api/walletEx?address=${encodeURIComponent(address)}`, { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const text = await res.text();
        if (text.trim()) {
          const d = JSON.parse(text) as { balance?: number; unpaid?: number; paid24h?: number; total?: number; miners?: { accepted?: number }[] };
          const hashrate = (d.miners ?? []).reduce((sum, m) => sum + (m.accepted ?? 0), 0);
          value = { balance: d.balance ?? 0, unpaid: d.unpaid ?? 0, paid24h: d.paid24h ?? 0, total: d.total ?? 0, hashrate, updatedAt: Date.now() };
        } else {
          value = { balance: 0, unpaid: 0, paid24h: 0, total: 0, updatedAt: Date.now() };
        }
      }
    } catch (err) {
      log('warn', `pool balance: ${(err as Error).message}`);
    }
    this.poolBalanceCache = { at: Date.now(), address, value };
    return value;
  }

  async shutdown(): Promise<void> {
    this.wantRunning = false;
    this.stopPauseWatch();
    await this.stopProcess();
  }
}

