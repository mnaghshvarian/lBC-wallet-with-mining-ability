/**
 * Spins up a throw-away lbcd in regtest mode for end-to-end tests.
 * Set LBCD_BIN to the lbcd binary (built from github.com/lbryio/lbcd), and
 * BTCD_BIN to btcd (scripts/build-btcd.sh) for the Bitcoin side of swaps.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { LbcdRpc } from '../src/net/lbcd.js';
import { nodeHttpPost } from '../src/node/index.js';

export const LBCD_BIN = process.env.LBCD_BIN ?? 'lbcd';
export const BTCD_BIN = process.env.BTCD_BIN ?? 'btcd';

export function lbcdAvailable(): boolean {
  if (process.env.LBCD_BIN) return existsSync(process.env.LBCD_BIN);
  return false;
}

export function btcdAvailable(): boolean {
  if (process.env.BTCD_BIN) return existsSync(process.env.BTCD_BIN);
  return false;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export interface RegtestNode {
  rpc: LbcdRpc;
  rpcUrl: string;
  port: number;
  /** Peer-to-peer port, so other nodes can sync from this one. */
  p2pPort: number;
  generate(n: number): Promise<string[]>;
  stop(): Promise<void>;
}

export async function startRegtest(miningAddress: string): Promise<RegtestNode> {
  return startNode(LBCD_BIN, miningAddress);
}

/** A Bitcoin regtest node (btcd), for the Bitcoin side of swap tests. */
export async function startBtcRegtest(miningAddress: string): Promise<RegtestNode> {
  return startNode(BTCD_BIN, miningAddress);
}

/** lbcd and btcd take the same options. */
async function startNode(bin: string, miningAddress: string): Promise<RegtestNode> {
  const dir = mkdtempSync(join(tmpdir(), 'lbcd-e2e-'));
  const port = await freePort();
  const p2pPort = await freePort();
  const args = [
    '--regtest',
    `--datadir=${join(dir, 'data')}`,
    `--logdir=${join(dir, 'logs')}`,
    `--configfile=${join(dir, 'none.conf')}`,
    '--notls',
    '--rpcuser=e2e',
    '--rpcpass=e2e',
    `--rpclisten=127.0.0.1:${port}`,
    `--listen=127.0.0.1:${p2pPort}`,
    '--txindex',
    '--addrindex',
    `--miningaddr=${miningAddress}`,
    '--debuglevel=warn',
  ];
  const proc: ChildProcess = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  proc.stdout?.on('data', (d) => (output += d.toString()));
  proc.stderr?.on('data', (d) => (output += d.toString()));
  const rpcUrl = `http://127.0.0.1:${port}/`;
  const rpc = new LbcdRpc({ url: rpcUrl, username: 'e2e', password: 'e2e', post: nodeHttpPost() });
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      await rpc.call('getblockcount');
      break;
    } catch {
      if (Date.now() > deadline || proc.exitCode !== null) throw new Error(`${bin} did not start:\n${output}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return {
    rpc,
    rpcUrl,
    port,
    p2pPort,
    generate: (n) => rpc.call<string[]>('generate', [n], 120_000),
    stop: async () => {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        if (proc.exitCode !== null) return resolve();
        const t = setTimeout(() => {
          proc.kill('SIGKILL');
          resolve();
        }, 10_000);
        proc.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
      // Windows may hold the files for a moment after the process ends.
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      } catch {
        // a leftover temporary folder is harmless
      }
    },
  };
}

export async function waitFor<T>(fn: () => T | Promise<T>, predicate: (v: T) => boolean, timeoutMs = 20_000, label = 'condition'): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (predicate(v)) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
