/**
 * A minimal LBRY Stratum pool for tests. Jobs are built from lbcd's
 * getblocktemplate exactly the way node-stratum-pool / yiimp do it, and shares
 * are validated by reconstructing the header pool-side (NOMP serializeHeader),
 * so the wallet's miner is tested against the pool convention — not against
 * itself. Shares that meet the network target are submitted to lbcd as blocks.
 */
import net from 'node:net';
import { concatBytes, fromHex, toHex, ByteWriter } from '../src/encoding/bytes.js';
import { sha256d } from '../src/crypto/hash.js';
import { bitsToTarget, hashToBigInt, lbryPowHash } from '../src/crypto/pow.js';
import { coinbaseMerkleBranch } from '../src/wallet/verify.js';
import { pushNumber } from '../src/script/script.js';
import { swapWords, shareTargetForDifficulty } from '../src/mining/work.js';
import type { LbcdRpc } from '../src/net/lbcd.js';
import type { BlockTemplate } from '../src/mining/solo.js';
import { Transaction } from '../src/tx/transaction.js';

interface PoolJob {
  id: string;
  template: BlockTemplate;
  coinb1: Uint8Array;
  coinb2: Uint8Array;
  branch: Uint8Array[];
}

export interface TestPool {
  port: number;
  accepted: number;
  rejected: number;
  blocks: string[];
  rejectReasons: string[];
  inFlight: number;
  close(): Promise<void>;
}

function nompReverseByteOrder(hex: string): string {
  return toHex(swapWords(fromHex(hex)).reverse());
}

export async function startTestPool(rpc: LbcdRpc, payoutScript: Uint8Array, difficulty: number, listenPort = 0): Promise<TestPool> {
  const extranonce1Size = 4;
  const extranonce2Size = 4;
  let jobSeq = 0;
  const jobs = new Map<string, PoolJob>();
  const seen = new Set<string>();
  const sockets = new Set<net.Socket>();
  const state: TestPool = { port: 0, accepted: 0, rejected: 0, blocks: [], rejectReasons: [], inFlight: 0, close: async () => undefined };

  async function makeJob(): Promise<PoolJob> {
    const template = await rpc.call<BlockTemplate>('getblocktemplate', [{ capabilities: ['coinbasevalue'], rules: ['segwit'] }]);
    // coinbase: version | 1 input | null prevout | scriptSig(len) [height ... extranonce1 extranonce2 ...] | seq | outputs | locktime
    const heightPush = pushNumber(template.height);
    const tag = new TextEncoder().encode('/testpool/');
    const scriptLen = heightPush.length + extranonce1Size + extranonce2Size + tag.length;
    const coinb1 = new ByteWriter().u32LE(1).varint(1).bytes(new Uint8Array(32)).u32LE(0xffffffff).varint(scriptLen).bytes(heightPush).toBytes();
    const coinb2 = new ByteWriter().bytes(tag).u32LE(0xffffffff).varint(1).u64LE(BigInt(template.coinbasevalue)).varBytes(payoutScript).u32LE(0).toBytes();
    const branch = coinbaseMerkleBranch(template.transactions.map((t) => t.txid ?? Transaction.fromHex(t.data).txid));
    const job: PoolJob = { id: (++jobSeq).toString(16), template, coinb1, coinb2, branch };
    jobs.set(job.id, job);
    return job;
  }

  function notifyParams(job: PoolJob) {
    const t = job.template;
    return [
      job.id,
      nompReverseByteOrder(t.previousblockhash),
      nompReverseByteOrder(t.claimtrie),
      toHex(job.coinb1),
      toHex(job.coinb2),
      job.branch.map((b) => toHex(b)),
      (t.version >>> 0).toString(16).padStart(8, '0'),
      t.bits,
      t.curtime.toString(16).padStart(8, '0'),
      true,
    ];
  }

  /** node-stratum-pool LBRY blockTemplate.serializeHeader */
  function serializeHeader(t: BlockTemplate, merkleRootDisplay: string, ntime: string, nonce: string): Uint8Array {
    return fromHex([nonce, t.bits, ntime, t.claimtrie, merkleRootDisplay, t.previousblockhash, (t.version >>> 0).toString(16).padStart(8, '0')].join('')).reverse();
  }

  let current = await makeJob();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    const en1 = toHex(new Uint8Array([0xde, 0xad, 0xbe, sockets.size & 0xff]));
    let buf = '';
    const send = (obj: unknown) => socket.write(JSON.stringify(obj) + '\n');
    socket.on('data', async (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line) as { id: number; method: string; params: unknown[] };
        if (msg.method === 'mining.subscribe') {
          send({ id: msg.id, result: [[['mining.set_difficulty', 'x'], ['mining.notify', 'x']], en1, extranonce2Size], error: null });
        } else if (msg.method === 'mining.authorize') {
          send({ id: msg.id, result: true, error: null });
          send({ id: null, method: 'mining.set_difficulty', params: [difficulty] });
          send({ id: null, method: 'mining.notify', params: notifyParams(current) });
        } else if (msg.method === 'mining.extranonce.subscribe') {
          send({ id: msg.id, result: false, error: [20, 'not supported', null] });
        } else if (msg.method === 'mining.submit') {
          const [, jobId, en2, ntime, nonce] = msg.params as string[];
          const job = jobs.get(jobId!);
          const key = `${jobId}:${en2}:${ntime}:${nonce}`;
          const reject = (code: number, reason: string) => {
            state.rejected++;
            state.rejectReasons.push(reason);
            send({ id: msg.id, result: null, error: [code, reason, null] });
          };
          if (!job) return reject(21, 'Job not found');
          if (seen.has(key)) return reject(22, 'Duplicate share');
          seen.add(key);
          const coinbase = concatBytes(job.coinb1, fromHex(en1), fromHex(en2!), job.coinb2);
          let root = sha256d(coinbase);
          for (const b of job.branch) root = sha256d(concatBytes(root, b));
          const header = serializeHeader(job.template, toHex(root.slice().reverse()), ntime!, nonce!);
          const value = hashToBigInt(lbryPowHash(header));
          if (value > shareTargetForDifficulty(difficulty)) return reject(23, 'Low difficulty share');
          state.accepted++;
          send({ id: msg.id, result: true, error: null });
          if (value <= bitsToTarget(parseInt(job.template.bits, 16))) {
            const block = new ByteWriter().bytes(header).varint(job.template.transactions.length + 1).bytes(coinbase);
            for (const t of job.template.transactions) block.bytes(fromHex(t.data));
            state.inFlight++;
            const result = await rpc.call<string | null>('submitblock', [toHex(block.toBytes())]).finally(() => state.inFlight--);
            if (result === null) {
              state.blocks.push(toHex(sha256d(header).reverse()));
              current = await makeJob();
              for (const s of sockets) s.write(JSON.stringify({ id: null, method: 'mining.notify', params: notifyParams(current) }) + '\n');
            } else {
              state.rejectReasons.push(`block rejected: ${result}`);
            }
          }
        }
      }
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(listenPort, '127.0.0.1', () => resolve()));
  state.port = (server.address() as net.AddressInfo).port;
  state.close = () =>
    new Promise((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    });
  return state;
}
