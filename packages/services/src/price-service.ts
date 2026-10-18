import type { PriceView } from './api.js';
import type { SettingsStore } from './settings.js';
import { scopedLogger, type Logger, type Platform } from './platform.js';

const REFRESH_MS = 5 * 60_000;

/** LBC market price. CoinPaprika first, CoinGecko as a fallback. Disabled when "show fiat" is off. */
export class PriceService {
  private current: PriceView | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly log: Logger;

  constructor(
    private readonly platform: Platform,
    private readonly settings: SettingsStore,
    private readonly onUpdate: (p: PriceView) => void,
  ) {
    this.log = scopedLogger(platform, 'price');
    settings.onChange((next, prev) => {
      if (next.showFiat !== prev.showFiat || next.fiatCurrency !== prev.fiatCurrency) {
        this.current = null;
        this.restart();
      }
    });
  }

  start(): void {
    this.restart();
  }

  private restart(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.settings.get().showFiat) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get(): PriceView | null {
    return this.settings.get().showFiat ? this.current : null;
  }

  private async refresh(): Promise<void> {
    const currency = this.settings.get().fiatCurrency;
    try {
      this.current = await this.fromPaprika(currency);
    } catch (err) {
      this.log('warn', `coinpaprika: ${(err as Error).message}`);
      try {
        this.current = await this.fromGecko(currency);
      } catch (err2) {
        this.log('warn', `coingecko: ${(err2 as Error).message}`);
        return;
      }
    }
    this.onUpdate(this.current);
  }

  private async getJson<T>(url: string): Promise<T> {
    return (await this.platform.fetchJson(url)) as T;
  }

  private async fromPaprika(currency: string): Promise<PriceView> {
    const data = await this.getJson<{ quotes: Record<string, { price: number; percent_change_24h: number }> }>(
      `https://api.coinpaprika.com/v1/tickers/lbc-lbry-credits?quotes=${encodeURIComponent(currency)}`,
    );
    const q = data.quotes?.[currency];
    if (!q || typeof q.price !== 'number') throw new Error('no quote');
    return { currency, price: q.price, change24h: q.percent_change_24h ?? null, updatedAt: Date.now(), source: 'CoinPaprika' };
  }

  private async fromGecko(currency: string): Promise<PriceView> {
    const c = currency.toLowerCase();
    const data = await this.getJson<Record<string, Record<string, number>>>(
      `https://api.coingecko.com/api/v3/simple/price?ids=lbry-credits&vs_currencies=${encodeURIComponent(c)}&include_24hr_change=true`,
    );
    const row = data['lbry-credits'];
    const price = row?.[c];
    if (typeof price !== 'number') throw new Error('no quote');
    return { currency, price, change24h: row?.[`${c}_24h_change`] ?? null, updatedAt: Date.now(), source: 'CoinGecko' };
  }
}
