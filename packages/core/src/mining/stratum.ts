import { Emitter, sleep } from '../util/emitter.js';
import { LineRpcClient, RpcError } from '../net/line-rpc.js';
import type { LineTransportFactory, SocketEndpoint } from '../net/transport.js';
import { fromHex, isHex } from '../encoding/bytes.js';
import { bitsToTarget } from '../crypto/pow.js';
import { parseLbryNotify, shareTargetForDifficulty, submitParams, type StratumJob, type WorkUnit } from './work.js';

export interface StratumOptions {
  endpoint: SocketEndpoint;
  username: string;
  password: string;
  transportFactory: LineTransportFactory;
  agent: string;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export type StratumState = 'idle' | 'connecting' | 'subscribing' | 'authorizing' | 'ready' | 'reconnecting' | 'stopped' | 'error';

export type StratumEvents = {
  state: { state: StratumState; error?: string };
  job: { job: StratumJob; difficulty: number; shareTarget: bigint; blockTarget: bigint };
  difficulty: number;
  share: { accepted: boolean; reason?: string; jobId: string; latencyMs: number };
  message: string;
};

/**
 * Stratum v1 mining client for LBRY pools (yiimp / NOMP style).
 * Handles subscribe → authorize → notify, vardiff, extranonce changes,
 * client.reconnect and automatic reconnection with backoff.
 */
export class StratumClient extends Emitter<StratumEvents> {
  private client: LineRpcClient | null = null;
  private stopped = true;
  private endpoint: SocketEndpoint;
  extranonce1: Uint8Array = new Uint8Array(0);
  extranonce2Size = 4;
  difficulty = 1;
  private pendingDifficulty: number | null = null;
  currentJob: StratumJob | null = null;
  state: StratumState = 'idle';
  private loop: Promise<void> | null = null;

  constructor(private readonly options: StratumOptions) {
    super();
    this.endpoint = options.endpoint;
  }

  private log(level: 'info' | 'warn' | 'error', message: string) {
    this.options.log?.(level, message);
  }

  private setState(state: StratumState, error?: string) {
    this.state = state;
    this.emit('state', { state, error });
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.client?.close();
    this.client = null;
    this.setState('stopped');
    await this.loop?.catch(() => undefined);
  }

  private async run(): Promise<void> {
    let failures = 0;
    while (!this.stopped) {
      try {
        await this.session();
        failures = 0;
      } catch (err) {
        failures++;
        const msg = err instanceof Error ? err.message : String(err);
        if (this.stopped) break;
        this.log('warn', `pool connection error: ${msg}`);
        this.setState('error', msg);
      }
      if (this.stopped) break;
      const delay = Math.min(60_000, 2_000 * 2 ** Math.min(failures, 5));
      this.setState('reconnecting');
      await sleep(delay);
    }
  }

  /** One connection lifetime; resolves when the connection closes. */
  private async session(): Promise<void> {
    this.setState('connecting');
    const client = new LineRpcClient(this.options.transportFactory(this.endpoint), { defaultTimeoutMs: 30_000 });
    this.client = client;
    const closed = new Promise<void>((resolve) => client.onClose(() => resolve()));
    client.onNotification((method, params) => this.handleNotification(method, params));
    await client.connect();
    this.log('info', `connected to ${this.endpoint.host}:${this.endpoint.port}`);

    this.setState('subscribing');
    const sub = await client.request<unknown[]>('mining.subscribe', [this.options.agent]);
    if (!Array.isArray(sub) || sub.length < 3 || typeof sub[1] !== 'string' || typeof sub[2] !== 'number') {
      client.close();
      throw new Error('unexpected mining.subscribe response');
    }
    this.setExtranonce(sub[1] as string, sub[2] as number);

    this.setState('authorizing');
    const authorized = await client.request<boolean>('mining.authorize', [this.options.username, this.options.password]);
    if (authorized !== true) {
      client.close();
      this.stopped = true;
      this.setState('error', 'Pool rejected the worker login (check the payout address / worker name)');
      return;
    }
    // Optional NiceHash-style extension; ignore failures.
    client.request('mining.extranonce.subscribe', [], 5_000).catch(() => undefined);
    this.setState('ready');
    this.log('info', `authorized as ${this.options.username}`);
    await closed;
    if (this.client === client) this.client = null;
    if (!this.stopped) throw new Error('pool closed the connection');
  }

  private setExtranonce(en1: string, size: number) {
    if (!isHex(en1) || size < 1 || size > 16) throw new Error('invalid extranonce from pool');
    this.extranonce1 = fromHex(en1);
    this.extranonce2Size = size;
  }

  private handleNotification(method: string, params: unknown) {
    const p = Array.isArray(params) ? params : [];
    try {
      switch (method) {
        case 'mining.set_difficulty': {
          const d = Number(p[0]);
          if (d > 0) {
            this.pendingDifficulty = d;
            this.emit('difficulty', d);
            // A new difficulty officially applies from the next job. Raising it early is
            // always safe (we just submit fewer shares); lowering waits for mining.notify.
            if (this.currentJob && d > this.difficulty) {
              this.difficulty = d;
              this.publishJob(this.currentJob);
            }
          }
          break;
        }
        case 'mining.notify': {
          const job = parseLbryNotify(p);
          if (this.pendingDifficulty !== null) this.difficulty = this.pendingDifficulty;
          this.currentJob = job;
          this.publishJob(job);
          break;
        }
        case 'mining.set_extranonce':
          this.setExtranonce(String(p[0]), Number(p[1]));
          break;
        case 'client.reconnect': {
          const host = typeof p[0] === 'string' && p[0] ? p[0] : this.endpoint.host;
          const port = Number(p[1]) || this.endpoint.port;
          this.log('info', `pool requested reconnect to ${host}:${port}`);
          this.endpoint = { ...this.endpoint, host, port };
          this.client?.close();
          break;
        }
        case 'client.show_message':
          this.emit('message', String(p[0] ?? ''));
          break;
        default:
          break;
      }
    } catch (err) {
      this.log('warn', `bad ${method} from pool: ${(err as Error).message}`);
    }
  }

  private publishJob(job: StratumJob) {
    this.emit('job', { job, difficulty: this.difficulty, shareTarget: shareTargetForDifficulty(this.difficulty), blockTarget: bitsToTarget(job.bits) });
  }

  /** Submits a share. Resolves true when the pool accepts it. */
  async submit(work: WorkUnit, nonce: number): Promise<boolean> {
    const client = this.client;
    if (!client || this.state !== 'ready') return false;
    const started = Date.now();
    try {
      const ok = await client.request<boolean>('mining.submit', submitParams(this.options.username, work, nonce), 30_000);
      this.emit('share', { accepted: ok === true, jobId: work.jobId, latencyMs: Date.now() - started, reason: ok === true ? undefined : 'rejected' });
      return ok === true;
    } catch (err) {
      const reason = err instanceof RpcError ? err.message : (err as Error).message;
      this.emit('share', { accepted: false, jobId: work.jobId, latencyMs: Date.now() - started, reason });
      return false;
    }
  }
}
