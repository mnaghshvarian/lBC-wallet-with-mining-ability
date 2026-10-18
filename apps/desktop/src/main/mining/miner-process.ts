/**
 * Electron utility process that owns all mining work: the Stratum/solo
 * coordinator and the hashing worker threads. Running here (instead of in the
 * main process) keeps the UI responsive and lets us lower the OS priority of
 * every mining thread.
 */
import { join } from 'node:path';
import os from 'node:os';
import { LbcdRpc, MinerCoordinator } from '@lbcwallet/core';
import { nodeHttpPost, nodeLineTransport } from '@lbcwallet/core/node';
import { WorkerThreads } from './worker-threads';

export interface MinerStartMessage {
  type: 'start';
  mode: 'pool' | 'solo';
  threads: number;
  lowPriority: boolean;
  workerPath: string;
  pool?: { host: string; port: number; tls: boolean; username: string; password: string; agent: string; socks5?: { host: string; port: number } };
  solo?: { url: string; username: string; password: string; ca?: string; payoutScriptHex: string };
}

type InMsg = MinerStartMessage | { type: 'stop' };

interface ParentPort {
  on(event: 'message', listener: (e: { data: InMsg }) => void): void;
  postMessage(message: unknown): void;
}

const port = (process as unknown as { parentPort: ParentPort }).parentPort;
let coordinator: MinerCoordinator | null = null;
let threads: WorkerThreads | null = null;

function post(message: unknown) {
  port.postMessage(message);
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g)?.map((b) => parseInt(b, 16)) ?? []);
}

async function start(msg: MinerStartMessage): Promise<void> {
  await stop();
  if (msg.lowPriority) {
    try {
      // Must happen before the worker threads exist: new threads inherit it.
      os.setPriority(0, os.constants.priority.PRIORITY_LOW);
    } catch {
      post({ type: 'log', entry: { level: 'warn', message: 'could not lower process priority', at: Date.now() } });
    }
  }
  const workerPath = msg.workerPath || join(__dirname, 'hashWorker.js');
  threads = await WorkerThreads.create(msg.threads, workerPath, (m) => post({ type: 'log', entry: { level: 'error', message: m, at: Date.now() } }));
  coordinator = new MinerCoordinator(threads);
  coordinator.on('stats', (stats) => post({ type: 'stats', stats }));
  coordinator.on('log', (entry) => post({ type: 'log', entry }));
  coordinator.on('block', (b) => post({ type: 'block', block: b }));
  if (msg.mode === 'pool' && msg.pool) {
    const p = msg.pool;
    coordinator.startPool({
      endpoint: { host: p.host, port: p.port, tls: p.tls },
      username: p.username,
      password: p.password,
      agent: p.agent,
      transportFactory: (ep) => nodeLineTransport(ep, { socks5: p.socks5, connectTimeoutMs: 15_000 }),
    });
  } else if (msg.mode === 'solo' && msg.solo) {
    const s = msg.solo;
    const rpc = new LbcdRpc({ url: s.url, username: s.username, password: s.password, post: nodeHttpPost({ ca: s.ca }) });
    await coordinator.startSolo(rpc, hexToBytes(s.payoutScriptHex));
  } else {
    throw new Error('invalid miner configuration');
  }
}

async function stop(): Promise<void> {
  const c = coordinator;
  const t = threads;
  coordinator = null;
  threads = null;
  await c?.stop();
  await t?.destroy();
}

port.on('message', (e) => {
  const msg = e.data;
  if (msg.type === 'start') {
    start(msg).catch((err) => {
      post({ type: 'log', entry: { level: 'error', message: (err as Error).message, at: Date.now() } });
      post({ type: 'failed', error: (err as Error).message });
    });
  } else if (msg.type === 'stop') {
    stop()
      .catch(() => undefined)
      .finally(() => post({ type: 'stopped' }));
  }
});

post({ type: 'ready' });
