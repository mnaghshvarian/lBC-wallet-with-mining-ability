/**
 * The part of the Esplora HTTP API (blockstream.info, mempool.space) that the
 * wallet's swaps use, answered from a regtest btcd started with --txindex and
 * --addrindex. Lets the swap tests run the real Bitcoin client code against a
 * real Bitcoin node.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LbcdRpc } from '../src/net/lbcd.js';

interface VerboseTx {
  txid: string;
  vin: { txid?: string; vout?: number; coinbase?: string; scriptSig?: { hex: string }; txinwitness?: string[] }[];
  vout: { value: number; n: number; scriptPubKey: { hex: string } }[];
  confirmations?: number;
}

export interface EsploraEmulator {
  url: string;
  close(): Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function startEsploraEmulator(rpc: LbcdRpc): Promise<EsploraEmulator> {
  const toEsplora = (t: VerboseTx, tip: number) => ({
    txid: t.txid,
    vin: t.vin.map((i) =>
      i.coinbase !== undefined
        ? { txid: '0'.repeat(64), vout: 0xffffffff, scriptsig: i.coinbase, is_coinbase: true }
        : { txid: i.txid!, vout: i.vout!, scriptsig: i.scriptSig?.hex ?? '', ...(i.txinwitness ? { witness: i.txinwitness } : {}) },
    ),
    vout: t.vout.map((o) => ({ scriptpubkey: o.scriptPubKey.hex, value: Math.round(o.value * 1e8) })),
    status: t.confirmations && t.confirmations > 0 ? { confirmed: true, block_height: tip - t.confirmations + 1 } : { confirmed: false },
  });

  const server = http.createServer((req, res) => {
    const send = (status: number, body: string, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (req.method === 'GET' && path === '/blocks/tip/height') return send(200, String(await rpc.call<number>('getblockcount')));
      const address = /^\/address\/([^/]+)\/txs$/.exec(path)?.[1];
      if (req.method === 'GET' && address) {
        const tip = await rpc.call<number>('getblockcount');
        let txs: VerboseTx[] = [];
        try {
          txs = await rpc.call<VerboseTx[]>('searchrawtransactions', [decodeURIComponent(address), 1, 0, 100]);
        } catch (err) {
          if (!/No information/i.test((err as Error).message)) throw err;
        }
        // Newest first: unconfirmed, then by height.
        const out = txs.map((t) => toEsplora(t, tip)).sort((a, b) => (b.status.block_height ?? Infinity) - (a.status.block_height ?? Infinity));
        return send(200, JSON.stringify(out));
      }
      if (req.method === 'POST' && path === '/tx') {
        const hex = (await readBody(req)).trim();
        try {
          return send(200, await rpc.call<string>('sendrawtransaction', [hex]), 'text/plain');
        } catch (err) {
          return send(400, `sendrawtransaction RPC error: ${(err as Error).message}`, 'text/plain');
        }
      }
      if (req.method === 'GET' && path === '/fee-estimates') return send(200, JSON.stringify({ '1': 3, '2': 2, '6': 1 }));
      send(404, 'not found', 'text/plain');
    })().catch((err: Error) => send(500, err.message, 'text/plain'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
