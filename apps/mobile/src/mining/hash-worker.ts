/**
 * Web Worker entry: one hashing thread on the phone. Receives work from the
 * miner, scans nonces with the WASM LBRY scanner in bursts of a few
 * milliseconds (so new work and idle requests are picked up quickly) and
 * reports hits, hash counts and nonce-space exhaustion. Same messages as the
 * desktop app's hash worker.
 */
import { LbryScanner } from '@lbcwallet/core';

type InMsg = { type: 'assign'; key: string; header: Uint8Array; target: string; stopOnHit?: boolean } | { type: 'idle' };

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent<InMsg>) => void) | null;
}

const SLICE = 8_192;
const NONCE_SPACE = 0x1_0000_0000;
/** Hash this long before looking at new messages. */
const BURST_MS = 30;

const scope = self as unknown as WorkerScope;

async function main(): Promise<void> {
  const scanner = await LbryScanner.create();
  let job: { key: string; next: number; stopOnHit: boolean } | null = null;
  let running = false;
  let pending = 0;
  let lastReport = performance.now();
  // A message to ourselves continues the loop without setTimeout's minimum delay.
  const tick = new MessageChannel();

  const report = () => {
    if (pending > 0) scope.postMessage({ type: 'hashes', count: pending });
    pending = 0;
    lastReport = performance.now();
  };

  const loop = () => {
    const current = job;
    if (!current) {
      running = false;
      report();
      return;
    }
    const until = performance.now() + BURST_MS;
    do {
      const r = scanner.scan(current.next, Math.min(SLICE, NONCE_SPACE - current.next));
      current.next += r.hashes;
      pending += r.hashes;
      if (r.found) {
        scope.postMessage({ type: 'hit', key: current.key, nonce: r.nonce });
        // Solo work: the hit is a whole block; wait for new work instead of reporting more.
        if (current.stopOnHit) {
          if (job === current) job = null;
          break;
        }
      }
      if (current.next >= NONCE_SPACE) {
        if (job === current) {
          job = null;
          scope.postMessage({ type: 'exhausted', key: current.key });
        }
        break;
      }
    } while (performance.now() < until);
    if (performance.now() - lastReport >= 250) report();
    tick.port2.postMessage(null);
  };
  tick.port1.onmessage = loop;

  scope.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'assign') {
      scanner.setWork(msg.header, BigInt(`0x${msg.target}`));
      job = { key: msg.key, next: 0, stopOnHit: !!msg.stopOnHit };
      if (!running) {
        running = true;
        tick.port2.postMessage(null);
      }
    } else if (msg.type === 'idle') {
      job = null;
    }
  };
  scope.postMessage({ type: 'ready', engine: scanner.flavor });
}

void main().catch((err) => {
  scope.postMessage({ type: 'error', message: (err as Error).message });
});
