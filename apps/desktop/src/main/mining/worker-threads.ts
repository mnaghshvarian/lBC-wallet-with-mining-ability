import { Worker } from 'node:worker_threads';
import type { HashThreads, WorkUnit } from '@lbcwallet/core';

/** HashThreads backed by Node worker_threads running hash-worker.js. */
export class WorkerThreads implements HashThreads {
  private workers: Worker[] = [];
  private hit: (thread: number, key: string, nonce: number) => void = () => {};
  private exhausted: (thread: number, key: string) => void = () => {};
  private hashes: (thread: number, count: number) => void = () => {};

  private constructor(readonly size: number) {}

  static async create(size: number, workerPath: string, onError: (message: string) => void): Promise<WorkerThreads> {
    const t = new WorkerThreads(size);
    await Promise.all(
      Array.from({ length: size }, (_, i) => {
        const w = new Worker(workerPath);
        t.workers.push(w);
        return new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('hash worker did not start')), 15_000);
          w.on('message', (msg: { type: string; key?: string; nonce?: number; count?: number; message?: string }) => {
            switch (msg.type) {
              case 'ready':
                clearTimeout(timer);
                resolve();
                break;
              case 'hit':
                t.hit(i, msg.key!, msg.nonce!);
                break;
              case 'exhausted':
                t.exhausted(i, msg.key!);
                break;
              case 'hashes':
                t.hashes(i, msg.count!);
                break;
              case 'error':
                onError(`thread ${i}: ${msg.message}`);
                break;
            }
          });
          w.on('error', (err: Error) => {
            clearTimeout(timer);
            onError(`thread ${i} crashed: ${err.message}`);
            reject(err);
          });
        });
      }),
    );
    return t;
  }

  assign(thread: number, key: string, work: WorkUnit): void {
    this.workers[thread]?.postMessage({ type: 'assign', key, header: work.header, target: work.target.toString(16) });
  }

  idle(): void {
    for (const w of this.workers) w.postMessage({ type: 'idle' });
  }

  async destroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
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
