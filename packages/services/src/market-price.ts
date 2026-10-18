import type { MarketPriceView } from './api.js';
import type { Platform } from './platform.js';

/**
 * The reference price the order board compares offers with: what LBC trades
 * for on MEXC (the exchange with the most LBC volume), in US dollars, and so
 * in Bitcoin and Monero; CoinPaprika's average when MEXC cannot be reached.
 * Only shown for comparison: offers set their own prices.
 */
export async function fetchMarketPrice(platform: Platform): Promise<MarketPriceView> {
  try {
    return await fromMexc(platform);
  } catch (err) {
    platform.log('warn', 'market', `MEXC price: ${(err as Error).message}`);
    return fromPaprika(platform);
  }
}

function positive(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) throw new Error('no price');
  return n;
}

async function fromMexc(platform: Platform): Promise<MarketPriceView> {
  const ticker = async (symbol: string) => positive(((await platform.fetchJson(`https://api.mexc.com/api/v3/ticker/price?symbol=${symbol}`)) as { price?: unknown } | null)?.price);
  const [usd, btcUsd, xmrUsd] = await Promise.all([ticker('LBCUSDT'), ticker('BTCUSDT'), ticker('XMRUSDT').catch(() => null)]);
  return { usd, sats: (usd / btcUsd) * 1e8, xmr: xmrUsd ? usd / xmrUsd : null, btcUsd, xmrUsd, source: 'MEXC', updatedAt: Date.now() };
}

async function fromPaprika(platform: Platform): Promise<MarketPriceView> {
  type Ticker = { quotes?: Record<string, { price?: unknown }> } | null;
  const [lbc, btc, xmr] = await Promise.all([
    platform.fetchJson('https://api.coinpaprika.com/v1/tickers/lbc-lbry-credits?quotes=USD,BTC') as Promise<Ticker>,
    platform.fetchJson('https://api.coinpaprika.com/v1/tickers/btc-bitcoin?quotes=USD') as Promise<Ticker>,
    (platform.fetchJson('https://api.coinpaprika.com/v1/tickers/xmr-monero?quotes=USD') as Promise<Ticker>).catch(() => null),
  ]);
  const usd = positive(lbc?.quotes?.USD?.price);
  const btcUsd = positive(btc?.quotes?.USD?.price);
  let xmrUsd: number | null = null;
  try {
    xmrUsd = positive(xmr?.quotes?.USD?.price);
  } catch {
    // shown without Monero
  }
  return { usd, sats: (usd / btcUsd) * 1e8, xmr: xmrUsd ? usd / xmrUsd : null, btcUsd, xmrUsd, source: 'CoinPaprika', updatedAt: Date.now() };
}
