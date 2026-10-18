/**
 * The built-in full node: runs the bundled lbcd (LBRY's official full node,
 * written in Go) the way the Monero GUI runs monerod. The user chooses where
 * the blockchain is stored; the wallet switches to the node once it is synced
 * and solo mining uses it directly.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, accessSync, constants, writeFileSync } from 'node:fs';
import { readdir, stat, statfs } from 'node:fs/promises';
import { totalmem, constants as osConstants, setPriority } from 'node:os';
import { join } from 'node:path';
import { LbcdRpc } from '@lbcwallet/core';
import { nodeHttpPost } from '@lbcwallet/core/node';
import { UserError, describeError, type LocalNode, type NetworkName, type NodeRequirementsView, type NodeStatusView, type NoticeView, type Settings, type SettingsStore } from '@lbcwallet/services';
import type { SoloNode } from './miner-service';
import { logger } from './log';

const log = logger('node');

/** Approximate disk space a full node needs (blocks, claim trie, tx and address indexes). */
const DISK_GB: Record<NetworkName, number> = { mainnet: 150, testnet: 20, regtest: 1 };
const RAM_GB = 8;
const BLOCK_SECONDS = 150;
/** The node counts as synced when its best block is this recent. */
const SYNCED_LAG_SECONDS = 2 * 60 * 60;
const P2P_PORT: Record<NetworkName, number> = { mainnet: 9246, testnet: 19246, regtest: 29246 };
const STOP_TIMEOUT_MS = 90_000;

export interface NodeServiceDeps {
  settings: SettingsStore;
  /** App data folder; the default node folder lives inside it. */
  appDataDir: string;
  /** Path of the bundled lbcd executable, or null when this build has none. */
  binary: string | null;
  onStatus: (status: NodeStatusView) => void;
  onNotice: (notice: NoticeView) => void;
  /** Called when the node starts, stops, or becomes synced. */
  onAvailabilityChange: () => void;
  /** Chain height the wallet sees through public hubs (helps estimate progress). */
  hubHeight: () => number | null;
  /** Free space required before starting, in GB (defaults to the full chain size; tests lower it). */
  requiredDiskGb?: number;
}

/** lbcd reports its version as major·10⁸ + minor·10⁶ + patch·10³ + prerelease. */
export function lbcdVersion(numeric: number): string {
  if (!numeric) return 'lbcd (development build)';
  return `lbcd ${Math.floor(numeric / 1e8)}.${Math.floor(numeric / 1e6) % 100}.${Math.floor(numeric / 1e3) % 1000}`;
}

/** `host:port`, with IPv6 literals in brackets as lbcd expects. */
export function hostPort(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

/** Command line for the bundled lbcd. RPC is bound to loopback with per-start credentials. */
export function lbcdArgs(o: { settings: Settings; dir: string; configFile: string; rpcPort: number; rpcUser: string; rpcPass: string }): string[] {
  const { settings, dir } = o;
  const network = settings.network;
  return [
    `--configfile=${o.configFile}`,
    `--datadir=${join(dir, 'data')}`,
    `--logdir=${join(dir, 'logs')}`,
    `--rpcuser=${o.rpcUser}`,
    `--rpcpass=${o.rpcPass}`,
    `--rpclisten=127.0.0.1:${o.rpcPort}`,
    '--notls',
    '--txindex',
    '--addrindex',
    settings.node.listen ? `--listen=0.0.0.0:${P2P_PORT[network]}` : '--nolisten',
    ...(settings.node.listen ? ['--upnp'] : []),
    // With Tor/SOCKS5 on, outgoing peer connections and DNS seed lookups go through the proxy too.
    ...(settings.socks5.enabled ? [`--proxy=${hostPort(settings.socks5.host, settings.socks5.port)}`] : []),
    ...settings.node.peers.map((peer) => `--addpeer=${peer}`),
    ...(network === 'testnet' ? ['--testnet'] : network === 'regtest' ? ['--regtest'] : []),
  ];
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function folderSize(dir: string): Promise<number> {
  let total = 0;
  const walk = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) total += (await stat(p).catch(() => ({ size: 0 }))).size;
    }
  };
  await walk(dir);
  return total;
}

async function freeSpace(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

export class NodeService {
  private child: ChildProcess | null = null;
  private rpc: LbcdRpc | null = null;
  private rpcUrl = '';
  private creds = { user: '', pass: '' };
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private diskTimer: ReturnType<typeof setInterval> | null = null;
  private lines: string[] = [];
  private current: NodeStatusView;
  private rate: { at: number; height: number }[] = [];
  private stopping: Promise<void> | null = null;
  private wasSynced = false;

  constructor(private readonly deps: NodeServiceDeps) {
    this.current = this.offStatus();
  }

  get available(): boolean {
    return !!this.deps.binary && existsSync(this.deps.binary);
  }

  private get network(): NetworkName {
    return this.deps.settings.get().network;
  }

  /** The folder in use: the user's choice, or one inside the app data folder. */
  dataDir(): string {
    return this.deps.settings.get().node.dataDir || join(this.deps.appDataDir, 'lbcd');
  }

  private offStatus(): NodeStatusView {
    return {
      state: 'off',
      network: this.network,
      dataDir: this.dataDir(),
      height: 0,
      headers: 0,
      networkHeight: null,
      progress: 0,
      peers: 0,
      diskUsed: null,
      diskFree: null,
      etaSeconds: null,
      listen: this.deps.settings.get().node.listen,
      startedAt: null,
      version: null,
    };
  }

  status(): NodeStatusView {
    return { ...this.current };
  }

  requirements(): NodeRequirementsView {
    return {
      diskGb: DISK_GB[this.network],
      ramGb: RAM_GB,
      systemRamGb: Math.round((totalmem() / 2 ** 30) * 10) / 10,
      defaultDataDir: join(this.deps.appDataDir, 'lbcd'),
    };
  }

  logs(): string[] {
    return [...this.lines];
  }

  get running(): boolean {
    return !!this.child;
  }

  get synced(): boolean {
    return this.current.state === 'synced';
  }

  /** For the wallet: the node's RPC while it runs, flagged synced or not. */
  localNode(): LocalNode | null {
    if (!this.rpc || !this.child) return null;
    return { rpc: this.rpc, label: 'built-in node', synced: this.synced };
  }

  /** For solo mining: RPC access and sync progress while the node runs. */
  soloNode(): SoloNode | null {
    if (!this.rpc || !this.child) return null;
    return { url: this.rpcUrl, username: this.creds.user, password: this.creds.pass, progress: this.synced ? 1 : this.current.progress };
  }

  private publish(patch: Partial<NodeStatusView>): void {
    this.current = { ...this.current, ...patch };
    this.deps.onStatus(this.status());
  }

  private addLines(chunk: string): void {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.lines.push(line);
    }
    if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500);
  }

  /** Changes the blockchain folder (only while the node is stopped). */
  async setDataDir(dir: string): Promise<string> {
    if (this.child) await this.stop();
    this.deps.settings.update({ node: { ...this.deps.settings.get().node, dataDir: dir } });
    this.current = this.offStatus();
    await this.refreshDisk();
    this.deps.onStatus(this.status());
    return this.dataDir();
  }

  async start(): Promise<NodeStatusView> {
    if (this.child) return this.status();
    if (this.stopping) await this.stopping;
    if (!this.available) throw new UserError('nodeBinaryMissing');
    const settings = this.deps.settings.get();
    const network = settings.network;
    const dir = this.dataDir();
    try {
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
    } catch {
      throw new UserError('nodeDirNotWritable', { path: dir });
    }
    const used = await folderSize(dir);
    const free = await freeSpace(dir);
    const neededBytes = (this.deps.requiredDiskGb ?? DISK_GB[network]) * 2 ** 30 - used;
    if (free !== null && neededBytes > free) {
      throw new UserError('nodeLowDisk', { path: dir, needed: Math.ceil(neededBytes / 2 ** 30), free: Math.floor(free / 2 ** 30) });
    }

    const port = await freePort();
    this.creds = { user: `lbcwallet-${randomBytes(6).toString('hex')}`, pass: randomBytes(24).toString('hex') };
    this.rpcUrl = `http://127.0.0.1:${port}/`;
    // An empty config file stops lbcd from writing its sample config; everything is passed as flags.
    const configFile = join(dir, 'lbcd-wallet.conf');
    if (!existsSync(configFile)) writeFileSync(configFile, '# Managed by LBC Wallet; settings are passed on the command line.\n');
    const args = lbcdArgs({ settings, dir, configFile, rpcPort: port, rpcUser: this.creds.user, rpcPass: this.creds.pass });
    log('info', `starting lbcd (${network}) in ${dir}`);
    const child = spawn(this.deps.binary!, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    this.lines = [];
    this.rate = [];
    this.wasSynced = false;
    child.stdout?.setEncoding('utf8').on('data', (d: string) => this.addLines(d));
    child.stderr?.setEncoding('utf8').on('data', (d: string) => this.addLines(d));
    if (child.pid) {
      try {
        // Syncing is heavy; keep the rest of the computer responsive.
        setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
      } catch {
        // not fatal
      }
    }
    child.once('error', (err) => {
      log('error', `lbcd failed to start: ${err.message}`);
      this.onExit(null, err.message);
    });
    child.once('exit', (code) => this.onExit(code, null));
    this.rpc = new LbcdRpc({ url: this.rpcUrl, username: this.creds.user, password: this.creds.pass, post: nodeHttpPost() });
    this.current = { ...this.offStatus(), state: 'starting', dataDir: dir, startedAt: Date.now() };
    this.deps.settings.update({ node: { ...settings.node, enabled: true } });
    this.deps.onStatus(this.status());
    this.deps.onAvailabilityChange();
    this.schedulePoll(1000);
    void this.refreshDisk();
    this.diskTimer = setInterval(() => void this.refreshDisk(), 5 * 60_000);
    return this.status();
  }

  private onExit(code: number | null, error: string | null): void {
    if (!this.child) return;
    const wasStopping = this.current.state === 'stopping';
    this.child = null;
    this.rpc = null;
    this.clearTimers();
    if (wasStopping || code === 0) {
      log('info', 'lbcd stopped');
      this.current = { ...this.offStatus(), diskUsed: this.current.diskUsed, diskFree: this.current.diskFree };
    } else {
      const tail = this.lines.slice(-8).join('\n');
      const locked = /lock|already in use|resource temporarily unavailable/i.test(tail);
      const detail = error ?? `exit code ${code}`;
      log('error', `lbcd exited unexpectedly (${detail})\n${tail}`);
      const err = locked ? new UserError('nodeAlreadyRunning') : new UserError('nodeStartFailed', { detail });
      this.current = { ...this.offStatus(), state: 'error', error: err.message, errorCode: err.code, errorParams: err.params };
      this.deps.onNotice({ kind: 'node', code: 'nodeStopped', params: { detail } });
    }
    this.deps.onStatus(this.status());
    this.deps.onAvailabilityChange();
  }

  private clearTimers(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.diskTimer) clearInterval(this.diskTimer);
    this.pollTimer = null;
    this.diskTimer = null;
  }

  private schedulePoll(ms: number): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => void this.poll(), ms);
  }

  private async poll(): Promise<void> {
    const rpc = this.rpc;
    if (!rpc || !this.child || this.current.state === 'stopping') return;
    try {
      const info = await rpc.call<{ blocks: number; mediantime: number }>('getblockchaininfo', [], 10_000);
      const peers = await rpc.call<{ startingheight: number }[]>('getpeerinfo', [], 10_000).catch(() => []);
      const version = this.current.version ?? (await rpc.call<{ version: number }>('getinfo', [], 10_000).then((i) => lbcdVersion(i.version)).catch(() => null));
      const now = Date.now() / 1000;
      const lag = Math.max(0, now - info.mediantime);
      // lbcd reports no header count or verification progress, so estimate the
      // network's height from peers and public hubs; the best block's age is a
      // fallback only, since blocks have come slower than the 2.5-minute target.
      const byTime = info.blocks + Math.floor(lag / BLOCK_SECONDS);
      const byPeers = peers.reduce((m, p) => Math.max(m, p.startingheight ?? 0), 0);
      const reported = Math.max(byPeers, this.deps.hubHeight() ?? 0);
      const networkHeight = Math.max(info.blocks, reported > 0 ? reported : this.network === 'regtest' ? 0 : byTime);
      const synced = lag < SYNCED_LAG_SECONDS || (this.network === 'regtest' && info.blocks >= networkHeight);
      const progress = synced ? 1 : networkHeight > 0 ? Math.min(0.999, info.blocks / networkHeight) : 0;
      this.rate.push({ at: Date.now(), height: info.blocks });
      this.rate = this.rate.filter((r) => Date.now() - r.at < 120_000);
      const first = this.rate[0]!;
      const perSec = this.rate.length > 1 ? (info.blocks - first.height) / ((Date.now() - first.at) / 1000) : 0;
      const etaSeconds = !synced && perSec > 0 ? Math.round((networkHeight - info.blocks) / perSec) : null;
      this.publish({
        state: synced ? 'synced' : 'syncing',
        height: info.blocks,
        headers: info.blocks,
        networkHeight,
        progress,
        peers: peers.length,
        etaSeconds,
        version,
        error: undefined,
        errorCode: undefined,
      });
      if (synced !== this.wasSynced) {
        this.wasSynced = synced;
        if (synced) {
          log('info', `lbcd synced at height ${info.blocks}`);
          this.deps.onNotice({ kind: 'node', code: 'nodeSynced', params: { height: info.blocks } });
        }
        this.deps.onAvailabilityChange();
      }
      this.schedulePoll(synced ? 10_000 : 3_000);
    } catch (err) {
      // The RPC server needs a moment after start, and lbcd answers 503s while busy.
      if (this.current.state !== 'starting') log('warn', `node status: ${describeError(err).message}`);
      this.schedulePoll(2_000);
    }
  }

  private async refreshDisk(): Promise<void> {
    const dir = this.dataDir();
    const [used, free] = await Promise.all([existsSync(dir) ? folderSize(dir) : Promise.resolve(0), freeSpace(existsSync(dir) ? dir : this.deps.appDataDir)]);
    this.current = { ...this.current, diskUsed: used, diskFree: free };
    this.deps.onStatus(this.status());
  }

  /** Stops the node gracefully (RPC "stop"), killing it only if it does not exit in time. */
  async stop(options: { remember?: boolean } = {}): Promise<NodeStatusView> {
    const child = this.child;
    if (!child) return this.status();
    if (options.remember !== false) this.deps.settings.update({ node: { ...this.deps.settings.get().node, enabled: false } });
    if (!this.stopping) {
      this.publish({ state: 'stopping' });
      this.stopping = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          log('warn', 'lbcd did not stop in time; terminating');
          child.kill('SIGKILL');
        }, STOP_TIMEOUT_MS);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        const rpc = this.rpc;
        void (rpc ? rpc.call('stop', [], 10_000) : Promise.reject(new Error('no rpc'))).catch(() => child.kill('SIGTERM'));
      }).finally(() => {
        this.stopping = null;
      });
    }
    await this.stopping;
    return this.status();
  }

  /** Stops the node when the app quits, keeping it enabled for the next start. */
  async shutdown(): Promise<void> {
    await this.stop({ remember: false });
    this.clearTimers();
  }
}
