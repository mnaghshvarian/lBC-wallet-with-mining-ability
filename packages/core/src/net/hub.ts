import { Emitter, chunk, mapLimit, sleep } from '../util/emitter.js';
import { LineRpcClient, RpcError } from './line-rpc.js';
import type { LineTransportFactory, SocketEndpoint } from './transport.js';
import type { BackendEvents, BackendStatus, ChainBackend, ChainTip, FetchedTransaction, HistoryItem } from './backend.js';
import { HEADER_SIZE, parseHeader } from '../crypto/pow.js';
import type { NetworkParams } from '../networks.js';

export interface HubBackendOptions {
  servers: SocketEndpoint[];
  transportFactory: LineTransportFactory;
  network: NetworkParams;
  clientName: string;
  /** Protocol version announced to the hub (LBRY hubs accept 0.54–0.199). */
  protocolVersion?: string;
  requestTimeoutMs?: number;
  connectTimeoutMs?: number;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

const SUBSCRIBE_BATCH = 100;
const TX_BATCH = 100;

/**
 * Client for LBRY hubs (lbryio/hub "herald" in Python and herald.go), which
 * speak an Electrum-derived JSON-RPC protocol over TCP.
 *
 * Compatibility notes derived from both server implementations:
 *  - address methods take base58 addresses (`blockchain.address.*`);
 *  - `blockchain.transaction.get` is unreliable on herald.go, so transactions
 *    are fetched with `blockchain.transaction.get_batch` (≤100 per call);
 *  - empty address status is `null` (Python) or `""` (Go).
 */
export class HubBackend extends Emitter<BackendEvents> implements ChainBackend {
  readonly kind = 'hub' as const;
  readonly untrusted = true;
  private client: LineRpcClient | null = null;
  private current: SocketEndpoint | null = null;
  private stopped = true;
  private connecting: Promise<void> | null = null;
  private status: BackendStatus = { connected: false, kind: 'hub' };
  private tip: ChainTip | null = null;
  private subscribed = new Set<string>();
  private keepalive: ReturnType<typeof setInterval> | null = null;
  private serverIndex = 0;
  private batchSupported = true;
  private hadConnection = false;

  constructor(private readonly options: HubBackendOptions) {
    super();
    if (options.servers.length === 0) throw new Error('no hub servers configured');
  }

  private log(level: 'info' | 'warn' | 'error', message: string) {
    this.options.log?.(level, message);
  }

  getStatus(): BackendStatus {
    return { ...this.status };
  }

  private setStatus(patch: Partial<BackendStatus>) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.getStatus());
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.ensureConnected();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    this.client?.close();
    this.client = null;
    this.setStatus({ connected: false });
  }

  private ensureConnected(): Promise<void> {
    if (this.client && !this.client.isClosed) return Promise.resolve();
    if (!this.connecting) {
      this.connecting = this.connectLoop().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  /** Tries servers round-robin with backoff until one works (or the backend is stopped). */
  private async connectLoop(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      const servers = this.options.servers;
      const endpoint = servers[this.serverIndex % servers.length]!;
      try {
        await this.connectTo(endpoint);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log('warn', `hub ${endpoint.host}:${endpoint.port} failed: ${msg}`);
        this.setStatus({ connected: false, error: `${endpoint.host}: ${msg}` });
        this.serverIndex++;
        attempt++;
        if (attempt % servers.length === 0) {
          const delay = Math.min(30_000, 2_000 * 2 ** Math.min(4, Math.floor(attempt / servers.length) - 1));
          await sleep(delay);
        }
      }
    }
    throw new Error('hub backend stopped');
  }

  private async connectTo(endpoint: SocketEndpoint): Promise<void> {
    const transport = this.options.transportFactory(endpoint);
    const client = new LineRpcClient(transport, { jsonrpc2: true, defaultTimeoutMs: this.options.requestTimeoutMs ?? 30_000 });
    const started = Date.now();
    await withTimeout(client.connect(), this.options.connectTimeoutMs ?? 8_000, 'connect timeout');
    try {
      const version = await client.request<[string, string]>('server.version', [this.options.clientName, this.options.protocolVersion ?? '0.113.0'], 8_000);
      const latencyMs = Date.now() - started;
      const tipRaw = await client.request<{ hex: string; height: number }>('blockchain.headers.subscribe', [true], 10_000);
      const tip = normalizeTip(tipRaw);
      this.checkNetwork(tip);
      client.onNotification((method, params) => this.handleNotification(method, params));
      client.onClose(() => this.handleClose(client));
      this.client = client;
      this.current = endpoint;
      this.tip = tip;
      this.batchSupported = true;
      const wasReconnect = this.hadConnection;
      this.hadConnection = true;
      this.subscribed.clear();
      this.setStatus({
        connected: true,
        server: `${endpoint.host}:${endpoint.port}`,
        serverVersion: Array.isArray(version) ? String(version[0]) : String(version),
        latencyMs,
        height: tip.height,
        error: undefined,
      });
      this.startKeepalive(client);
      this.log('info', `connected to hub ${endpoint.host}:${endpoint.port} at height ${tip.height}`);
      this.emit('tip', tip);
      if (wasReconnect) this.emit('reconnected', undefined);
    } catch (err) {
      client.close();
      throw err;
    }
  }

  private checkNetwork(tip: ChainTip) {
    if (tip.header.length !== HEADER_SIZE * 2) throw new Error('server returned a non-LBRY header');
  }

  private startKeepalive(client: LineRpcClient) {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = setInterval(() => {
      if (client.isClosed) return;
      if (Date.now() - Math.max(client.lastReceived, client.lastSent) > 50_000) {
        client.request('server.ping', [], 10_000).catch(() => client.close());
      }
    }, 10_000);
  }

  private handleClose(client: LineRpcClient) {
    if (this.client !== client) return;
    this.client = null;
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    this.setStatus({ connected: false });
    if (this.stopped) return;
    this.log('warn', `lost connection to ${this.current?.host}; reconnecting`);
    this.serverIndex++;
    void this.ensureConnected().catch(() => undefined);
  }

  private handleNotification(method: string, params: unknown) {
    if (method === 'blockchain.headers.subscribe' && Array.isArray(params) && params[0]) {
      const tip = normalizeTip(params[0] as { hex: string; height: number });
      this.tip = tip;
      this.setStatus({ height: tip.height });
      this.emit('tip', tip);
    } else if ((method === 'blockchain.address.subscribe' || method === 'blockchain.scripthash.subscribe') && Array.isArray(params)) {
      const [address, status] = params as [string, string | null];
      this.emit('addressStatus', { address, status: status ? status : null });
    }
  }

  private async rpc<T>(method: string, params: unknown[], timeoutMs?: number): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.ensureConnected();
      const client = this.client;
      if (!client) continue;
      try {
        return await client.request<T>(method, params, timeoutMs);
      } catch (err) {
        if (err instanceof RpcError) throw err;
        // transport problem: drop the connection and retry on another server
        this.log('warn', `${method} failed (${(err as Error).message}); retrying`);
        client.close();
      }
    }
    throw new Error(`${method} failed after retries`);
  }

  async getTip(): Promise<ChainTip> {
    await this.ensureConnected();
    if (!this.tip) throw new Error('no tip yet');
    return this.tip;
  }

  async getHeaders(startHeight: number, count: number): Promise<string[]> {
    const result = await this.rpc<{ hex?: string; count: number }>('blockchain.block.headers', [startHeight, count]);
    const hex = result.hex ?? '';
    const out: string[] = [];
    for (let i = 0; i < hex.length; i += HEADER_SIZE * 2) out.push(hex.slice(i, i + HEADER_SIZE * 2));
    return out;
  }

  async subscribeAddresses(addresses: string[]): Promise<(string | null)[]> {
    const results: (string | null)[] = [];
    for (const batch of chunk(addresses, SUBSCRIBE_BATCH)) {
      const statuses = await this.rpc<(string | null)[] | string | null>('blockchain.address.subscribe', batch, 60_000);
      const list = Array.isArray(statuses) ? statuses : [statuses];
      if (list.length !== batch.length) throw new Error('hub returned a mismatched subscription result');
      for (const s of list) results.push(s ? s : null);
      for (const a of batch) this.subscribed.add(a);
    }
    return results;
  }

  async getHistory(address: string): Promise<HistoryItem[]> {
    const raw = await this.rpc<{ tx_hash: string; height: number }[]>('blockchain.address.get_history', [address], 60_000);
    return (raw ?? []).map((h) => ({ txid: h.tx_hash, height: h.height }));
  }

  async getTransactions(txids: string[]): Promise<Map<string, FetchedTransaction>> {
    const out = new Map<string, FetchedTransaction>();
    const batches = chunk([...new Set(txids)], TX_BATCH);
    await mapLimit(batches, 4, async (batch) => {
      if (this.batchSupported) {
        try {
          const res = await this.rpc<Record<string, [string | null, { block_height?: number; merkle?: string[]; pos?: number }]>>(
            'blockchain.transaction.get_batch',
            batch,
            120_000,
          );
          for (const txid of batch) {
            const entry = res?.[txid];
            if (!entry || !entry[0]) continue;
            const info = entry[1] ?? {};
            const height = info.block_height && info.block_height > 0 ? info.block_height : 0;
            out.set(txid, {
              hex: entry[0],
              height,
              merkle: height > 0 && Array.isArray(info.merkle) && typeof info.pos === 'number' ? { branch: info.merkle, pos: info.pos } : undefined,
            });
          }
          return;
        } catch (err) {
          if (!(err instanceof RpcError)) throw err;
          this.log('warn', `get_batch unsupported (${err.message}); falling back to transaction.get`);
          this.batchSupported = false;
        }
      }
      await mapLimit(batch, 8, async (txid) => {
        try {
          const res = await this.rpc<unknown>('blockchain.transaction.get', [txid]);
          const hex = typeof res === 'string' ? res : (res as { TxRaw?: string })?.TxRaw;
          if (hex) out.set(txid, { hex, height: -1 });
        } catch (err) {
          if (!(err instanceof RpcError)) throw err;
        }
      });
    });
    return out;
  }

  async broadcast(rawHex: string): Promise<string> {
    return this.rpc<string>('blockchain.transaction.broadcast', [rawHex], 60_000);
  }
}

function normalizeTip(raw: { hex: string; height: number } | { hex: string; height: number }[]): ChainTip {
  const t = Array.isArray(raw) ? raw[0]! : raw;
  if (!t || typeof t.hex !== 'string' || typeof t.height !== 'number') throw new Error('invalid header notification');
  parseHeader(hexToBytesSafe(t.hex));
  return { height: t.height, header: t.hex };
}

function hexToBytesSafe(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Measures round-trip latency to a hub (used by the server picker in settings). */
export async function probeHub(
  endpoint: SocketEndpoint,
  transportFactory: LineTransportFactory,
  network: NetworkParams,
  clientName: string,
): Promise<{ ok: true; latencyMs: number; height: number; version: string } | { ok: false; error: string }> {
  const client = new LineRpcClient(transportFactory(endpoint), { jsonrpc2: true, defaultTimeoutMs: 8_000 });
  const started = Date.now();
  try {
    await withTimeout(client.connect(), 8_000, 'connect timeout');
    const version = await client.request<[string, string]>('server.version', [clientName, '0.113.0']);
    const tip = normalizeTip(await client.request<{ hex: string; height: number }>('blockchain.headers.subscribe', [true]));
    void network;
    return { ok: true, latencyMs: Date.now() - started, height: tip.height, version: Array.isArray(version) ? String(version[0]) : String(version) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    client.close();
  }
}
