import type { HashThreads, ScannerFlavor, WorkUnit } from '@lbcwallet/core';

type WorkerMessage = { type: 'ready'; engine?: ScannerFlavor } | { type: 'hit'; key: string; nonce: number } | { type: 'exhausted'; key: string } | { type: 'hashes'; count: number } | { type: 'error'; message: string };

/** HashThreads backed by Web Workers running hash-worker.ts (one worker per thread). */
export class WebWorkerThreads implements HashThreads {
  private workers: Worker[] = [];
  private hit: (thread: number, key: string, nonce: number) => void = () => {};
  private exhausted: (thread: number, key: string) => void = () => {};
  private hashes: (thread: number, count: number) => void = () => {};
  /** Scanner build the threads are running (reported by each thread when it starts). */
  engine: ScannerFlavor = 'scalar';

  private constructor(readonly size: number) {}

  /** Starts `size` workers; fails when one cannot load the WebAssembly scanner. */
  static async create(size: number, onError: (message: string) => void): Promise<WebWorkerThreads> {
    const t = new WebWorkerThreads(size);
    try {
      await Promise.all(
        Array.from({ length: size }, (_, i) => {
          const w = new Worker(new URL('./hash-worker.ts', import.meta.url), { type: 'module', name: `hash-${i}` });
          t.workers.push(w);
          return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('hash worker did not start')), 20_000);
            w.onmessage = (e: MessageEvent<WorkerMessage>) => {
              const msg = e.data;
              switch (msg.type) {
                case 'ready':
                  clearTimeout(timer);
                  if (msg.engine) t.engine = msg.engine;
                  resolve();
                  break;
                case 'hit':
                  t.hit(i, msg.key, msg.nonce);
                  break;
                case 'exhausted':
                  t.exhausted(i, msg.key);
                  break;
                case 'hashes':
                  t.hashes(i, msg.count);
                  break;
                case 'error':
                  clearTimeout(timer);
                  onError(`thread ${i}: ${msg.message}`);
                  reject(new Error(msg.message));
                  break;
              }
            };
            w.onerror = (e) => {
              clearTimeout(timer);
              e.preventDefault();
              onError(`thread ${i} crashed: ${e.message || 'unknown error'}`);
              reject(new Error(e.message || 'hash worker crashed'));
            };
          });
        }),
      );
    } catch (err) {
      await t.destroy();
      throw err;
    }
    return t;
  }

  assign(thread: number, key: string, work: WorkUnit): void {
    this.workers[thread]?.postMessage({ type: 'assign', key, header: work.header, target: work.target.toString(16), stopOnHit: !!work.stopOnHit });
  }

  idle(): void {
    for (const w of this.workers) w.postMessage({ type: 'idle' });
  }

  async destroy(): Promise<void> {
    for (const w of this.workers) w.terminate();
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
