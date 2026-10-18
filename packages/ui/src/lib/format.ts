import { formatHashrate, formatLbc, parseLbc } from '@lbcwallet/core/ui';
import type { PriceView, TxType } from '@lbcwallet/services/api';
import { createTranslator, type Translate } from '../i18n';

export { formatHashrate, parseLbc };

// Formatting follows the UI language (month names, calendars, units), but always
// with Latin digits so amounts and heights read and copy the same everywhere.
let locale = 'en-u-nu-latn';
let t: Translate = createTranslator('en');

/** Called by the store whenever the UI language changes. */
export function setFormatLanguage(lang: string, translate: Translate): void {
  locale = `${lang}-u-nu-latn`;
  t = translate;
}

/** Formats a dewies string as LBC. */
export function lbc(dewies: string | bigint, opts: { decimals?: number; sign?: boolean } = {}): string {
  const v = typeof dewies === 'bigint' ? dewies : BigInt(dewies || '0');
  const text = formatLbc(v, { minDecimals: 2, maxDecimals: opts.decimals ?? 8 });
  return opts.sign && v > 0n ? `+${text}` : text;
}

export function toNumberLbc(dewies: string | bigint): number {
  const v = typeof dewies === 'bigint' ? dewies : BigInt(dewies || '0');
  return Number(v) / 1e8;
}

export function fiat(dewies: string | bigint, price: PriceView | null): string | null {
  if (!price) return null;
  const value = toNumberLbc(dewies) * price.price;
  return formatFiat(value, price.currency);
}

export function formatFiat(value: number, currency: string): string {
  if (currency === 'BTC') {
    return `₿${value.toFixed(value !== 0 && Math.abs(value) < 0.0001 ? 8 : 6)}`;
  }
  const abs = Math.abs(value);
  const digits = abs === 0 ? 2 : abs < 0.01 ? 6 : abs < 1 ? 4 : 2;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

export function shortAddress(address: string, head = 8, tail = 6): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export function dateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return t('time.justNow');
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), 'hour');
  if (diff < 86400 * 7) return rtf.format(-Math.floor(diff / 86400), 'day');
  return new Date(unixSeconds * 1000).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

function unit(value: number, u: 'day' | 'hour' | 'minute' | 'second'): string {
  return new Intl.NumberFormat(locale, { style: 'unit', unit: u, unitDisplay: 'narrow' }).format(value);
}

export function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${unit(d, 'day')} ${unit(h, 'hour')}`;
  if (h > 0) return `${unit(h, 'hour')} ${unit(m, 'minute')}`;
  if (m > 0) return `${unit(m, 'minute')} ${unit(s % 60, 'second')}`;
  return unit(s, 'second');
}

export function number(n: number, digits = 0): string {
  return n.toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** A small amount by its first digits that aren't zero: 0.0098, not 9.8e-3. */
export function significant(n: number, digits = 2): string {
  return n.toLocaleString(locale, { maximumSignificantDigits: digits });
}

/**
 * A temperature in the UI language (e.g. "40°C", Arabic "40°م"), isolated so a
 * right-to-left sentence cannot reorder it into "C° 40".
 */
export function celsius(value: number): string {
  const text = new Intl.NumberFormat(locale, { style: 'unit', unit: 'celsius', maximumFractionDigits: 0 }).format(value);
  return `\u2068${text}\u2069`;
}

/** A list in the UI language: "a, b and c", Chinese "a、b和c". */
export function list(items: string[]): string {
  return new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);
}

export function compact(n: number): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 }).format(n);
}

export function percent(fraction: number, digits = 1): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(fraction);
}

export function bytes(n: number): string {
  const gb = n / 2 ** 30;
  if (gb >= 1) return new Intl.NumberFormat(locale, { style: 'unit', unit: 'gigabyte', maximumFractionDigits: 1 }).format(gb);
  return new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 }).format(n / 2 ** 20);
}

export function txTitle(type: TxType, counterparty: string | null): string {
  const to = counterparty ? shortAddress(counterparty) : '';
  switch (type) {
    case 'receive':
      return t('tx.receive');
    case 'send':
      return counterparty ? t('tx.sendTo', { to }) : t('tx.send');
    case 'self':
      return t('tx.self');
    case 'mining':
      return t('tx.mining');
    case 'tip-in':
      return t('tx.tipIn');
    case 'tip-out':
      return counterparty ? t('tx.tipOutTo', { to }) : t('tx.tipOut');
    case 'support':
      return t('tx.support');
    case 'claim':
      return t('tx.claim');
    case 'unlock':
      return t('tx.unlock');
  }
}

export function daysText(days: number): string {
  if (!Number.isFinite(days)) return t('mining.neverAtThisRate');
  if (days < 1) return new Intl.NumberFormat(locale, { style: 'unit', unit: 'hour', unitDisplay: 'long', maximumFractionDigits: 1 }).format(days * 24);
  if (days < 365) return new Intl.NumberFormat(locale, { style: 'unit', unit: 'day', unitDisplay: 'long', maximumFractionDigits: 0 }).format(days);
  return new Intl.NumberFormat(locale, { style: 'unit', unit: 'year', unitDisplay: 'long', maximumFractionDigits: 1 }).format(days / 365);
}
