/**
 * A minimal client for the Esplora HTTP API (blockstream.info, mempool.space,
 * or your own server): what a swap needs from the Bitcoin chain. The platform
 * supplies the HTTPS calls.
 */

export interface EsploraHttp {
  getJson(url: string): Promise<unknown>;
  /** POSTs a text body and returns the response text; rejects on HTTP errors with the server's message. */
  postText(url: string, body: string): Promise<string>;
}

export interface EsploraTx {
  txid: string;
  vin: { txid: string; vout: number; scriptsig: string; witness?: string[]; is_coinbase?: boolean }[];
  vout: { scriptpubkey: string; value: number }[];
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

function isTx(v: unknown): v is EsploraTx {
  const t = v as EsploraTx;
  return !!t && typeof t.txid === 'string' && Array.isArray(t.vin) && Array.isArray(t.vout) && !!t.status && typeof t.status.confirmed === 'boolean';
}

export class EsploraClient {
  private readonly base: string;

  constructor(
    base: string,
    private readonly http: EsploraHttp,
  ) {
    this.base = base.replace(/\/+$/, '');
    // Plain http only for a test server on this computer.
    if (!/^https:\/\//.test(this.base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(this.base)) throw new Error('the Bitcoin explorer address must start with https://');
  }

  get server(): string {
    return this.base;
  }

  async tipHeight(): Promise<number> {
    const h = await this.http.getJson(`${this.base}/blocks/tip/height`);
    if (typeof h !== 'number' || !Number.isInteger(h) || h < 0) throw new Error('unexpected answer from the Bitcoin explorer');
    return h;
  }

  /** Transactions paying to or spending from an address (newest first; the first pages are enough for a contract address). */
  async addressTxs(address: string): Promise<EsploraTx[]> {
    const list = await this.http.getJson(`${this.base}/address/${encodeURIComponent(address)}/txs`);
    if (!Array.isArray(list) || !list.every(isTx)) throw new Error('unexpected answer from the Bitcoin explorer');
    return list;
  }

  async broadcast(rawHex: string): Promise<string> {
    const txid = (await this.http.postText(`${this.base}/tx`, rawHex)).trim();
    if (!/^[0-9a-f]{64}$/.test(txid)) throw new Error(`the Bitcoin explorer refused the transaction: ${txid.slice(0, 200)}`);
    return txid;
  }

  /** Fee rate (sat/vB) for confirmation within about `blocks` blocks; at least 1. */
  async feeRate(blocks = 6): Promise<number> {
    const estimates = (await this.http.getJson(`${this.base}/fee-estimates`)) as Record<string, number> | null;
    if (!estimates || typeof estimates !== 'object') throw new Error('unexpected answer from the Bitcoin explorer');
    const targets = Object.keys(estimates)
      .map(Number)
      .filter((n) => Number.isFinite(n) && typeof estimates[String(n)] === 'number')
      .sort((a, b) => a - b);
    const target = targets.find((n) => n >= blocks) ?? targets[targets.length - 1];
    const rate = target !== undefined ? estimates[String(target)]! : 1;
    return Math.max(1, Math.ceil(rate));
  }
}
