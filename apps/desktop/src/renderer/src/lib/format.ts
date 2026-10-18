import { formatHashrate, formatLbc, parseLbc } from '@lbcwallet/core/ui';
import type { PriceView, TxType } from '../../../shared/api';

export { formatHashrate, parseLbc };

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
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
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
  return new Date(unixSeconds * 1000).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function duration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function number(n: number, digits = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function compact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 }).format(n);
}

export function txTitle(type: TxType, counterparty: string | null): string {
  switch (type) {
    case 'receive':
      return 'Received';
    case 'send':
      return counterparty ? `Sent to ${shortAddress(counterparty)}` : 'Sent';
    case 'self':
      return 'Moved between your addresses';
    case 'mining':
      return 'Mining reward';
    case 'tip-in':
      return 'Tip or support received';
    case 'tip-out':
      return counterparty ? `Tip sent to ${shortAddress(counterparty)}` : 'Tip sent';
    case 'support':
      return 'Support created';
    case 'claim':
      return 'Claim (content or channel)';
    case 'unlock':
      return 'Unlocked tips & supports';
  }
}

export function daysText(days: number): string {
  if (!Number.isFinite(days)) return 'never at this hashrate';
  if (days < 1) return `${number(days * 24, 1)} hours`;
  if (days < 365) return `${number(days, 0)} days`;
  return `${number(days / 365, 1)} years`;
}
