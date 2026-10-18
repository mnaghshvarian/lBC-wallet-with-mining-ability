import { Emitter, mapLimit } from '../util/emitter.js';
import { RpcError } from './line-rpc.js';
import type { HttpPost } from './transport.js';
import type { BackendEvents, BackendStatus, ChainBackend, ChainTip, FetchedTransaction, HistoryItem } from './backend.js';
import { historyStatus } from './backend.js';
import { sha256 } from '../crypto/hash.js';
import { toHex, utf8Encode } from '../encoding/bytes.js';
import type { NetworkParams } from '../networks.js';

export interface LbcdRpcOptions {
  url: string;
  username: string;
  password: string;
  post: HttpPost;
  timeoutMs?: number;
}

/** Bitcoin-Core-style JSON-RPC client for lbcd (and lbrycrd). */
export class LbcdRpc {
  private id = 0;

  constructor(private readonly options: LbcdRpcOptions) {}

  async call<T = unknown>(method: string, params: unknown[] = [], timeoutMs?: number): Promise<T> {
    const auth = btoaUtf8(`${this.options.username}:${this.options.password}`);
    const body = JSON.stringify({ jsonrpc: '1.0', id: ++this.id, method, params });
    let res: { status: number; body: string } | undefined;
    // lbcd answers 503 when its RPC client/concurrency limits are reached; back off and retry.
    for (let attempt = 0; attempt < 6; attempt++) {
      res = await this.options.post({
        url: this.options.url,
        body,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        timeoutMs: timeoutMs ?? this.options.timeoutMs ?? 30_000,
      });
      if (res.status !== 503) break;
      await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
    }
    res = res!;
    if (res.status === 401 || res.status === 403) throw new RpcError('Node rejected the RPC username/password', res.status);
    let parsed: { result?: T; error?: { code?: number; message?: string } | null };
    try {
      parsed = JSON.parse(res.body);
    } catch {
      throw new RpcError(`Unexpected response from node (HTTP ${res.status})`, res.status);
    }
    if (parsed.error) throw new RpcError(parsed.error.message ?? 'RPC error', parsed.error.code);
    return parsed.result as T;
  }
}

function btoaUtf8(text: string): string {
  const bytes = utf8Encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  if (typeof btoa === 'function') return btoa(bin);
  // Node < 16 fallback is unnecessary: Node 22 / Electron / RN all provide btoa.
  throw new Error('btoa unavailable');
}

interface SearchTx {
  txid: string;
  hex?: string;
  blockhash?: string;
  confirmations?: number;
}

/**
 * Full-node backend: talks to the user's own lbcd. Requires lbcd to run with
 * `--txindex --addrindex` (for `searchrawtransactions`). No merkle proofs are
 * needed because the node is trusted.
 */
export class LbcdBackend extends Emitter<BackendEvents> implements ChainBackend {
  readonly kind = 'lbcd' as const;
  readonly untrusted = false;
  private status: BackendStatus = { connected: false, kind: 'lbcd' };
  private tip: ChainTip | null = null;
  private subscriptions = new Map<string, string | null>();
  private poller: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private lastMempoolSize = -1;

  constructor(
    readonly rpc: LbcdRpc,
    private readonly network: NetworkParams,
    private readonly options: { pollIntervalMs?: number; label?: string; log?: (level: 'info' | 'warn' | 'error', m: string) => void } = {},
  ) {
    super();
  }

  getStatus(): BackendStatus {
    return { ...this.status };
  }

  private setStatus(patch: Partial<BackendStatus>) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.getStatus());
  }

  async start(): Promise<void> {
    const started = Date.now();
    const info = await this.rpc.call<{ chain: string; blocks: number; bestblockhash: string }>('getblockchaininfo');
    const expected = this.network.name === 'mainnet' ? ['mainnet', 'main'] : this.network.name === 'testnet' ? ['testnet3', 'test', 'testnet'] : ['regtest'];
    if (!expected.includes(info.chain)) throw new Error(`node is on ${info.chain}, wallet expects ${this.network.name}`);
    await this.refreshTip();
    this.setStatus({ connected: true, server: this.options.label ?? 'lbcd', latencyMs: Date.now() - started, height: this.tip!.height, error: undefined });
    this.emit('tip', this.tip!);
    this.poller = setInterval(() => void this.poll(), this.options.pollIntervalMs ?? 5_000);
  }

  async stop(): Promise<void> {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
    this.setStatus({ connected: false });
  }

  private async refreshTip(): Promise<boolean> {
    const hash = await this.rpc.call<string>('getbestblockhash');
    const header = await this.rpc.call<string>('getblockheader', [hash, false]);
    const verbose = await this.rpc.call<{ height: number }>('getblockheader', [hash, true]);
    const changed = !this.tip || this.tip.header !== header;
    this.tip = { height: verbose.height, header };
    return changed;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const tipChanged = await this.refreshTip();
      if (tipChanged) {
        this.setStatus({ connected: true, height: this.tip!.height, error: undefined });
        this.emit('tip', this.tip!);
      }
      const mempool = await this.rpc.call<string[]>('getrawmempool');
      const mempoolChanged = mempool.length !== this.lastMempoolSize;
      this.lastMempoolSize = mempool.length;
      if (tipChanged || mempoolChanged) {
        const addresses = [...this.subscriptions.keys()];
        const statuses = await mapLimit(addresses, 4, (a) => this.computeStatus(a));
        addresses.forEach((address, i) => {
          const status = statuses[i]!;
          if (this.subscriptions.get(address) !== status) {
            this.subscriptions.set(address, status);
            this.emit('addressStatus', { address, status });
          }
        });
      }
    } catch (err) {
      this.setStatus({ connected: false, error: (err as Error).message });
      this.options.log?.('warn', `lbcd poll failed: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }

  async getTip(): Promise<ChainTip> {
    if (!this.tip) await this.refreshTip();
    return this.tip!;
  }

  async getHeaders(startHeight: number, count: number): Promise<string[]> {
    const heights = Array.from({ length: count }, (_, i) => startHeight + i).filter((h) => !this.tip || h <= this.tip.height);
    return mapLimit(heights, 4, async (h) => {
      const hash = await this.rpc.call<string>('getblockhash', [h]);
      return this.rpc.call<string>('getblockheader', [hash, false]);
    });
  }

  private async computeStatus(address: string): Promise<string | null> {
    return historyStatus(await this.getHistory(address), (t) => toHex(sha256(utf8Encode(t))));
  }

  async subscribeAddresses(addresses: string[]): Promise<(string | null)[]> {
    const statuses = await mapLimit(addresses, 4, (a) => this.computeStatus(a));
    addresses.forEach((a, i) => this.subscriptions.set(a, statuses[i]!));
    return statuses;
  }

  async getHistory(address: string): Promise<HistoryItem[]> {
    const tipHeight = (await this.getTip()).height;
    const items: HistoryItem[] = [];
    const pageSize = 1000;
    for (let skip = 0; ; skip += pageSize) {
      let page: SearchTx[];
      try {
        page = await this.rpc.call<SearchTx[]>('searchrawtransactions', [address, 1, skip, pageSize, 0, false]);
      } catch (err) {
        // lbcd returns "No information available about address" for unused addresses
        if (err instanceof RpcError && /no information|not found|no transactions/i.test(err.message)) break;
        if (err instanceof RpcError && /addrindex|address index/i.test(err.message)) {
          throw new Error('lbcd must run with --addrindex --txindex to serve a wallet');
        }
        throw err;
      }
      for (const tx of page ?? []) {
        const confirmations = tx.confirmations ?? 0;
        items.push({ txid: tx.txid, height: confirmations > 0 ? tipHeight - confirmations + 1 : 0 });
      }
      if (!page || page.length < pageSize) break;
    }
    // Hub ordering: confirmed by height, then mempool.
    const confirmed = items.filter((i) => i.height > 0).sort((a, b) => a.height - b.height || a.txid.localeCompare(b.txid));
    const mempool = items.filter((i) => i.height <= 0).sort((a, b) => a.txid.localeCompare(b.txid));
    const seen = new Set<string>();
    return [...confirmed, ...mempool].filter((i) => (seen.has(i.txid) ? false : (seen.add(i.txid), true)));
  }

  async getTransactions(txids: string[]): Promise<Map<string, FetchedTransaction>> {
    const out = new Map<string, FetchedTransaction>();
    const tipHeight = (await this.getTip()).height;
    await mapLimit([...new Set(txids)], 4, async (txid) => {
      try {
        const v = await this.rpc.call<{ hex: string; confirmations?: number }>('getrawtransaction', [txid, 1]);
        const conf = v.confirmations ?? 0;
        out.set(txid, { hex: v.hex, height: conf > 0 ? tipHeight - conf + 1 : 0 });
      } catch (err) {
        if (!(err instanceof RpcError)) throw err;
      }
    });
    return out;
  }

  async broadcast(rawHex: string): Promise<string> {
    const txid = await this.rpc.call<string>('sendrawtransaction', [rawHex]);
    void this.poll();
    return txid;
  }
}
