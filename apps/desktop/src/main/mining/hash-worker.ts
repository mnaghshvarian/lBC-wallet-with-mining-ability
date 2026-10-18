/**
 * worker_threads entry: one hashing thread. Receives work from the miner
 * process, scans nonces with the WASM LBRY scanner in short slices (so new
 * work and idle requests are picked up within milliseconds) and reports hits,
 * hash counts and nonce-space exhaustion.
 */
import { parentPort } from 'node:worker_threads';
import { LbryScanner } from '@lbcwallet/core';

type InMsg = { type: 'assign'; key: string; header: Uint8Array; target: string; stopOnHit?: boolean } | { type: 'idle' };

const SLICE = 16_384;
const NONCE_SPACE = 0x1_0000_0000;

async function main(): Promise<void> {
  if (!parentPort) throw new Error('hash worker must run in a worker thread');
  const port = parentPort;
  const scanner = await LbryScanner.create();
  let job: { key: string; next: number; stopOnHit: boolean } | null = null;
  let running = false;
  let pending = 0;
  let lastReport = Date.now();

  const report = () => {
    if (pending > 0) port.postMessage({ type: 'hashes', count: pending });
    pending = 0;
    lastReport = Date.now();
  };

  const loop = () => {
    const current = job;
    if (!current) {
      running = false;
      report();
      return;
    }
    const r = scanner.scan(current.next, Math.min(SLICE, NONCE_SPACE - current.next));
    current.next += r.hashes;
    pending += r.hashes;
    if (r.found) {
      port.postMessage({ type: 'hit', key: current.key, nonce: r.nonce });
      // Solo work: the hit is a whole block; wait for new work instead of reporting more.
      if (current.stopOnHit && job === current) job = null;
    }
    if (current.next >= NONCE_SPACE && job === current) {
      job = null;
      port.postMessage({ type: 'exhausted', key: current.key });
    }
    if (Date.now() - lastReport >= 250) report();
    setImmediate(loop);
  };

  port.on('message', (msg: InMsg) => {
    if (msg.type === 'assign') {
      scanner.setWork(msg.header, BigInt(`0x${msg.target}`));
      job = { key: msg.key, next: 0, stopOnHit: !!msg.stopOnHit };
      if (!running) {
        running = true;
        setImmediate(loop);
      }
    } else if (msg.type === 'idle') {
      job = null;
    }
  });
  port.postMessage({ type: 'ready', engine: scanner.flavor });
}

void main().catch((err) => {
  parentPort?.postMessage({ type: 'error', message: (err as Error).message });
});
