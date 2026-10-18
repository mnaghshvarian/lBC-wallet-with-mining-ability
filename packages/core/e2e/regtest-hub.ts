/**
 * A small LBRY-hub emulator backed by lbcd (regtest). It reproduces the
 * behaviour of lbryio/hub's herald that the wallet relies on:
 *  - status = sha256("txid:height:" …) with confirmed txs in block order, then mempool;
 *  - get_batch returns [raw, {block_height, merkle, pos}];
 *  - header and address notifications.
 * Used by the hub end-to-end tests and handy for running the desktop app
 * against a local regtest chain (`npm run regtest-hub`).
 */
import net from 'node:net';
import { createHash } from 'node:crypto';
import { concatBytes, hashFromHex, hashToHex } from '../src/encoding/bytes.js';
import { sha256d } from '../src/crypto/hash.js';
import type { LbcdRpc } from '../src/net/lbcd.js';

interface Client {
  socket: net.Socket;
  addresses: Map<string, string | null>;
  headers: boolean;
}

function merkleBranch(txids: string[], pos: number): string[] {
  let level = txids.map(hashFromHex);
  let index = pos;
  const branch: string[] = [];
  while (level.length > 1) {
    if (level.length % 2 === 1) level.push(level[level.length - 1]!);
    branch.push(hashToHex(level[index ^ 1]!));
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(sha256d(concatBytes(level[i]!, level[i + 1]!)));
    level = next;
    index >>= 1;
  }
  return branch;
}

export interface RegtestHub {
  port: number;
  close(): Promise<void>;
}

export async function startRegtestHub(rpc: LbcdRpc, options: { port?: number; pollMs?: number } = {}): Promise<RegtestHub> {
  const clients = new Set<Client>();
  const blockTxs = new Map<string, string[]>();
  let tip = { height: -1, hash: '', hex: '' };
  let mempoolKey = '';

  const blockHeights = new Map<string, number>();
  /** Height of a block, from the block itself (never from the moving tip). */
  async function heightOf(blockHash: string): Promise<number> {
    let h = blockHeights.get(blockHash);
    if (h === undefined) {
      h = (await rpc.call<{ height: number }>('getblockheader', [blockHash, true])).height;
      blockHeights.set(blockHash, h);
    }
    return h;
  }

  async function txidsOf(blockHash: string): Promise<string[]> {
    let t = blockTxs.get(blockHash);
    if (!t) {
      const block = await rpc.call<{ tx: string[] }>('getblock', [blockHash, 1]);
      t = block.tx;
      blockTxs.set(blockHash, t);
    }
    return t;
  }

  async function history(address: string): Promise<{ tx_hash: string; height: number }[]> {
    let rows: { txid: string; blockhash?: string; confirmations?: number; vin?: { txid?: string }[] }[] = [];
    try {
      rows = await rpc.call('searchrawtransactions', [address, 1, 0, 10000, 0, false]);
    } catch (err) {
      if (!/no information/i.test((err as Error).message)) throw err;
    }
    const confirmed: { tx_hash: string; height: number; pos: number }[] = [];
    const mempool: { tx_hash: string; height: number }[] = [];
    const mempoolSet = new Set(await rpc.call<string[]>('getrawmempool'));
    for (const r of rows) {
      if (r.blockhash && (r.confirmations ?? 0) > 0) {
        const height = await heightOf(r.blockhash);
        const pos = (await txidsOf(r.blockhash)).indexOf(r.txid);
        confirmed.push({ tx_hash: r.txid, height, pos });
      } else {
        const unconfirmedParent = (r.vin ?? []).some((i) => i.txid && mempoolSet.has(i.txid));
        mempool.push({ tx_hash: r.txid, height: unconfirmedParent ? -1 : 0 });
      }
    }
    confirmed.sort((a, b) => a.height - b.height || a.pos - b.pos);
    return [...confirmed.map(({ tx_hash, height }) => ({ tx_hash, height })), ...mempool];
  }

  async function status(address: string): Promise<string | null> {
    const h = await history(address);
    if (h.length === 0) return null;
    return createHash('sha256').update(h.map((x) => `${x.tx_hash}:${x.height}:`).join('')).digest('hex');
  }

  async function refreshTip(): Promise<boolean> {
    const hash = await rpc.call<string>('getbestblockhash');
    if (hash === tip.hash) return false;
    const header = await rpc.call<{ height: number }>('getblockheader', [hash, true]);
    const hex = await rpc.call<string>('getblockheader', [hash, false]);
    tip = { height: header.height, hash, hex };
    return true;
  }

  async function handle(client: Client, method: string, params: unknown[]): Promise<unknown> {
    switch (method) {
      case 'server.version':
        return ['LBRY Hub regtest emulator 0.1', '0.107.0'];
      case 'server.ping':
        return null;
      case 'server.features':
        return { genesis_hash: '6e3fcf1299d4ec5d79c3a4c91d624a4acf9e2e173d95a1a0504f677669687556', hash_function: 'sha256' };
      case 'blockchain.headers.subscribe':
        client.headers = true;
        return { hex: tip.hex, height: tip.height };
      case 'blockchain.block.headers': {
        const [start, count] = params as [number, number];
        const out: string[] = [];
        // Serve up to the node's current height (the cached tip can lag behind between polls).
        const best = await rpc.call<number>('getblockcount');
        for (let h = start; h < start + Math.min(count, 2016) && h <= best; h++) {
          const hash = await rpc.call<string>('getblockhash', [h]);
          out.push(await rpc.call<string>('getblockheader', [hash, false]));
        }
        return { hex: out.join(''), count: out.length, max: 2016 };
      }
      case 'blockchain.address.subscribe': {
        const addrs = params as string[];
        const result: (string | null)[] = [];
        for (const a of addrs) {
          const s = await status(a);
          client.addresses.set(a, s);
          result.push(s);
        }
        return result;
      }
      case 'blockchain.address.get_history':
        return history(params[0] as string);
      case 'blockchain.transaction.get':
        return rpc.call<string>('getrawtransaction', [params[0], 0]);
      case 'blockchain.transaction.get_batch': {
        const out: Record<string, [string | null, Record<string, unknown>]> = {};
        for (const txid of params as string[]) {
          try {
            const tx = await rpc.call<{ hex: string; blockhash?: string; confirmations?: number }>('getrawtransaction', [txid, 1]);
            if (tx.blockhash && (tx.confirmations ?? 0) > 0) {
              const txids = await txidsOf(tx.blockhash);
              const pos = txids.indexOf(txid);
              out[txid] = [tx.hex, { block_height: await heightOf(tx.blockhash), merkle: merkleBranch(txids, pos), pos }];
            } else {
              out[txid] = [tx.hex, { block_height: -1 }];
            }
          } catch {
            out[txid] = [null, { block_height: -1 }];
          }
        }
        return out;
      }
      case 'blockchain.transaction.broadcast':
        return rpc.call<string>('sendrawtransaction', [params[0]]);
      default:
        throw Object.assign(new Error(`unknown method "${method}"`), { code: -32601 });
    }
  }

  await refreshTip();
  const server = net.createServer((socket) => {
    const client: Client = { socket, addresses: new Map(), headers: false };
    clients.add(client);
    socket.setEncoding('utf8');
    let buf = '';
    let chain = Promise.resolve();
    socket.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as { id: number; method: string; params?: unknown[] };
        chain = chain.then(async () => {
          try {
            const result = await handle(client, msg.method, msg.params ?? []);
            socket.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
          } catch (err) {
            socket.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: (err as { code?: number }).code ?? 1, message: (err as Error).message } }) + '\n');
          }
        });
      }
    });
    socket.on('close', () => clients.delete(client));
    socket.on('error', () => undefined);
  });

  let polling = false;
  const poller = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const tipChanged = await refreshTip();
      const mempool = (await rpc.call<string[]>('getrawmempool')).sort().join(',');
      const mempoolChanged = mempool !== mempoolKey;
      mempoolKey = mempool;
      if (!tipChanged && !mempoolChanged) return;
      for (const c of clients) {
        if (tipChanged && c.headers) c.socket.write(JSON.stringify({ jsonrpc: '2.0', method: 'blockchain.headers.subscribe', params: [{ hex: tip.hex, height: tip.height }] }) + '\n');
        for (const [address, old] of c.addresses) {
          const s = await status(address);
          if (s !== old) {
            c.addresses.set(address, s);
            c.socket.write(JSON.stringify({ jsonrpc: '2.0', method: 'blockchain.address.subscribe', params: [address, s] }) + '\n');
          }
        }
      }
    } catch {
      // node busy; try again next tick
    } finally {
      polling = false;
    }
  }, options.pollMs ?? 250);

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () =>
      new Promise((resolve) => {
        clearInterval(poller);
        for (const c of clients) c.socket.destroy();
        server.close(() => resolve());
      }),
  };
}
