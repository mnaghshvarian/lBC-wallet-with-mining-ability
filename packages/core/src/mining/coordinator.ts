import { Emitter } from '../util/emitter.js';
import { toHex } from '../encoding/bytes.js';
import { bitsToTarget } from '../crypto/pow.js';
import { StratumClient, type StratumOptions, type StratumState } from './stratum.js';
import { SoloTemplateWork, getBlockTemplate, submitBlock, type BlockTemplate } from './solo.js';
import { checkNonce, extranonce2For, setNonce, stratumWork, type StratumJob, type WorkUnit } from './work.js';
import { LbryScanner } from './scanner.js';
import type { LbcdRpc } from '../net/lbcd.js';

/** A set of hashing threads. Each thread scans nonces 0..2^32-1 of its assigned work. */
export interface HashThreads {
  readonly size: number;
  assign(thread: number, key: string, work: WorkUnit): void;
  idle(): void;
  destroy(): Promise<void>;
  onHit(handler: (thread: number, key: string, nonce: number) => void): void;
  onExhausted(handler: (thread: number, key: string) => void): void;
  onHashes(handler: (thread: number, count: number) => void): void;
}

export type MinerMode = 'pool' | 'solo';

export interface MinerStats {
  state: 'stopped' | 'starting' | 'connecting' | 'mining' | 'waiting' | 'error';
  mode: MinerMode | null;
  threads: number;
  /** Hash rate over the last ~10 s and ~60 s (H/s). */
  hashrate: number;
  hashrateAvg: number;
  totalHashes: number;
  accepted: number;
  rejected: number;
  blocksFound: number;
  /** Pool share difficulty (pool mode). */
  difficulty: number;
  height: number | null;
  networkBits: number | null;
  startedAt: number | null;
  lastShareAt: number | null;
  lastJobAt: number | null;
  error?: string;
  server?: string;
}

export type MinerEvents = {
  stats: MinerStats;
  log: { level: 'info' | 'warn' | 'error'; message: string; at: number };
  share: { accepted: boolean; reason?: string };
  block: { hash: string; height: number; accepted: boolean; reason?: string };
};

interface Assigned {
  work: WorkUnit;
  coinbaseHex?: string;
  solo?: SoloTemplateWork;
  height: number | null;
}

/**
 * Drives the hashing threads from a pool (Stratum) or the user's own node
 * (getblocktemplate). Every hit is re-checked with the reference hash before it
 * leaves the wallet.
 */
export class MinerCoordinator extends Emitter<MinerEvents> {
  private stratum: StratumClient | null = null;
  private soloTimer: ReturnType<typeof setInterval> | null = null;
  private soloRpc: LbcdRpc | null = null;
  private soloPayout: Uint8Array | null = null;
  private soloWork: SoloTemplateWork | null = null;
  private assigned = new Map<string, Assigned>();
  private threadKeys: (string | null)[];
  private extranonceCounter = 1n;
  private samples: { t: number; total: number }[] = [];
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private stratumJob: { job: StratumJob; shareTarget: bigint; blockTarget: bigint } | null = null;
  stats: MinerStats;

  constructor(private readonly threads: HashThreads) {
    super();
    this.threadKeys = new Array(threads.size).fill(null);
    this.stats = this.freshStats(null);
    threads.onHashes((_, count) => {
      this.stats.totalHashes += count;
    });
    threads.onHit((thread, key, nonce) => void this.handleHit(thread, key, nonce));
    threads.onExhausted((thread, key) => {
      if (this.threadKeys[thread] === key) this.assignThread(thread);
    });
  }

  private freshStats(mode: MinerMode | null): MinerStats {
    return {
      state: 'stopped',
      mode,
      threads: this.threads.size,
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

  private log(level: 'info' | 'warn' | 'error', message: string) {
    this.emit('log', { level, message, at: Date.now() });
  }

  private publish(patch: Partial<MinerStats> = {}) {
    this.stats = { ...this.stats, ...patch };
    this.emit('stats', { ...this.stats });
  }

  private startStats() {
    this.samples = [{ t: Date.now(), total: this.stats.totalHashes }];
    this.statsTimer = setInterval(() => {
      const now = Date.now();
      this.samples.push({ t: now, total: this.stats.totalHashes });
      while (this.samples.length > 2 && now - this.samples[0]!.t > 60_000) this.samples.shift();
      const rate = (windowMs: number) => {
        const recent = this.samples.filter((s) => now - s.t <= windowMs);
        const first = recent[0] ?? this.samples[0]!;
        const last = this.samples[this.samples.length - 1]!;
        const dt = (last.t - first.t) / 1000;
        return dt > 0 ? (last.total - first.total) / dt : 0;
      };
      this.publish({ hashrate: rate(10_500), hashrateAvg: rate(60_500) });
    }, 1000);
  }

  get running(): boolean {
    return this.stats.state !== 'stopped';
  }

  /** Mines on a Stratum pool. */
  startPool(options: StratumOptions): void {
    if (this.running) throw new Error('miner already running');
    this.stats = this.freshStats('pool');
    this.publish({ state: 'connecting', startedAt: Date.now(), server: `${options.endpoint.host}:${options.endpoint.port}` });
    this.startStats();
    const client = new StratumClient({ ...options, log: (level, message) => this.log(level, message) });
    this.stratum = client;
    client.on('state', ({ state, error }) => this.onStratumState(state, error));
    client.on('job', ({ job, difficulty, shareTarget, blockTarget }) => {
      this.stratumJob = { job, shareTarget, blockTarget };
      this.publish({ difficulty, networkBits: job.bits, lastJobAt: Date.now(), state: 'mining', error: undefined });
      this.reassignAll();
    });
    client.on('share', ({ accepted, reason }) => {
      if (accepted) this.publish({ accepted: this.stats.accepted + 1, lastShareAt: Date.now() });
      else {
        this.publish({ rejected: this.stats.rejected + 1 });
        this.log('warn', `share rejected: ${reason ?? 'unknown reason'}`);
      }
      this.emit('share', { accepted, reason });
    });
    client.on('message', (m) => this.log('info', `pool: ${m}`));
    client.start();
  }

  private onStratumState(state: StratumState, error?: string) {
    if (state === 'ready') this.log('info', 'pool login accepted, waiting for work');
    if (state === 'error' || state === 'reconnecting') {
      this.threads.idle();
      this.threadKeys.fill(null);
      this.publish({ state: state === 'error' ? 'error' : 'connecting', error });
    }
    if (state === 'connecting') this.publish({ state: 'connecting' });
  }

  /** Solo mines against the user's node; rewards go to `payoutScript`. */
  async startSolo(rpc: LbcdRpc, payoutScript: Uint8Array): Promise<void> {
    if (this.running) throw new Error('miner already running');
    this.stats = this.freshStats('solo');
    this.publish({ state: 'connecting', startedAt: Date.now(), server: 'local node' });
    this.startStats();
    this.soloRpc = rpc;
    this.soloPayout = payoutScript;
    await this.refreshTemplate(true);
    this.soloTimer = setInterval(() => void this.refreshTemplate(false), 2_000);
  }

  private lastTemplateKey = '';
  private lastTemplateAt = 0;

  private async refreshTemplate(force: boolean): Promise<void> {
    if (!this.soloRpc || !this.soloPayout) return;
    let template: BlockTemplate;
    try {
      template = await getBlockTemplate(this.soloRpc);
    } catch (err) {
      const msg = (err as Error).message;
      this.threads.idle();
      this.threadKeys.fill(null);
      this.publish({ state: 'error', error: `node: ${msg}` });
      if (force) this.log('error', `getblocktemplate failed: ${msg}`);
      return;
    }
    const key = `${template.previousblockhash}:${template.transactions.length}`;
    const tipChanged = !this.soloWork || this.soloWork.template.previousblockhash !== template.previousblockhash;
    // New block: switch immediately. New transactions only: refresh at most every 30 s.
    if (!force && !tipChanged && (key === this.lastTemplateKey || Date.now() - this.lastTemplateAt < 30_000)) return;
    this.lastTemplateKey = key;
    this.lastTemplateAt = Date.now();
    this.soloWork = new SoloTemplateWork(template, this.soloPayout);
    if (tipChanged) this.log('info', `mining block ${template.height} (${template.transactions.length} transactions)`);
    this.publish({ state: 'mining', height: template.height, networkBits: parseInt(template.bits, 16), lastJobAt: Date.now(), error: undefined });
    this.reassignAll();
  }

  private reassignAll() {
    this.assigned.clear();
    for (let i = 0; i < this.threads.size; i++) this.assignThread(i);
  }

  private assignThread(thread: number) {
    let entry: Assigned | null = null;
    if (this.stratum && this.stratumJob) {
      const { job, shareTarget, blockTarget } = this.stratumJob;
      const en2 = extranonce2For(this.extranonceCounter++, this.stratum.extranonce2Size);
      entry = { work: stratumWork(job, this.stratum.extranonce1, en2, shareTarget, blockTarget), height: null };
    } else if (this.soloWork) {
      const en = extranonce2For(this.extranonceCounter++, 8);
      const w = this.soloWork.work(en);
      entry = { work: w, coinbaseHex: w.coinbaseHex, solo: this.soloWork, height: this.soloWork.height };
    }
    if (!entry) return;
    const key = `${entry.work.jobId}#${entry.work.extranonce2}`;
    const previous = this.threadKeys[thread];
    if (previous) this.assigned.delete(previous);
    this.assigned.set(key, entry);
    this.threadKeys[thread] = key;
    this.threads.assign(thread, key, entry.work);
  }

  private async handleHit(thread: number, key: string, nonce: number): Promise<void> {
    const entry = this.assigned.get(key);
    if (!entry) return; // stale
    const check = checkNonce(entry.work, nonce);
    if (!check.meetsShare) {
      this.log('error', `thread ${thread} reported an invalid result (nonce ${nonce}); ignoring`);
      return;
    }
    if (this.stratum) {
      if (check.meetsBlock) this.log('info', 'share meets the network target — this could be a block!');
      void this.stratum.submit(entry.work, nonce);
      return;
    }
    if (entry.solo && entry.coinbaseHex) {
      const header = entry.work.header.slice();
      setNonce(header, nonce);
      const blockHex = entry.solo.serializeBlock(header, entry.coinbaseHex);
      const hash = toHex(check.hash.slice().reverse());
      try {
        const reason = await submitBlock(this.soloRpc!, blockHex);
        const accepted = reason === null;
        if (accepted) {
          this.publish({ blocksFound: this.stats.blocksFound + 1, lastShareAt: Date.now() });
          this.log('info', `found block ${entry.height} (${hash})`);
        } else {
          this.log('warn', `node rejected block ${entry.height}: ${reason}`);
        }
        this.emit('block', { hash, height: entry.height ?? 0, accepted, reason: reason ?? undefined });
      } catch (err) {
        this.log('error', `submitblock failed: ${(err as Error).message}`);
      }
      await this.refreshTemplate(true);
    }
  }

  async stop(): Promise<void> {
    if (this.soloTimer) clearInterval(this.soloTimer);
    this.soloTimer = null;
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.threads.idle();
    this.threadKeys.fill(null);
    this.assigned.clear();
    const s = this.stratum;
    this.stratum = null;
    this.stratumJob = null;
    this.soloWork = null;
    this.soloRpc = null;
    await s?.stop();
    this.publish({ state: 'stopped', hashrate: 0 });
  }
}

/**
 * Runs hashing on the current thread in small time slices. Used in tests and
 * as a fallback where worker threads are unavailable.
 */
export class InProcessThreads implements HashThreads {
  private scanners: LbryScanner[] = [];
  private jobs: ({ key: string; next: number } | null)[];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hit: (thread: number, key: string, nonce: number) => void = () => {};
  private exhausted: (thread: number, key: string) => void = () => {};
  private hashes: (thread: number, count: number) => void = () => {};

  private constructor(
    readonly size: number,
    private readonly sliceHashes: number,
  ) {
    this.jobs = new Array(size).fill(null);
  }

  static async create(size = 1, sliceHashes = 4096): Promise<InProcessThreads> {
    const t = new InProcessThreads(size, sliceHashes);
    for (let i = 0; i < size; i++) t.scanners.push(await LbryScanner.create());
    return t;
  }

  assign(thread: number, key: string, work: WorkUnit): void {
    this.scanners[thread]!.setWork(work.header, work.target);
    this.jobs[thread] = { key, next: 0 };
    this.schedule();
  }

  idle(): void {
    this.jobs.fill(null);
  }

  async destroy(): Promise<void> {
    this.idle();
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      let active = false;
      this.jobs.forEach((job, i) => {
        if (!job) return;
        active = true;
        const count = Math.min(this.sliceHashes, 0x1_0000_0000 - job.next);
        const r = this.scanners[i]!.scan(job.next, count);
        this.hashes(i, r.hashes);
        job.next += r.hashes;
        if (r.found) this.hit(i, job.key, r.nonce!);
        if (job.next >= 0x1_0000_0000 && this.jobs[i] === job) {
          this.jobs[i] = null;
          this.exhausted(i, job.key);
        }
      });
      if (active) this.schedule();
    }, 0);
  }

  onHit(h: (thread: number, key: string, nonce: number) => void) {
    this.hit = h;
  }
  onExhausted(h: (thread: number, key: string) => void) {
    this.exhausted = h;
  }
  onHashes(h: (thread: number, count: number) => void) {
    this.hashes = h;
  }
}

export { bitsToTarget };
