import { describe, expect, it } from 'vitest';
import { formatLbc, lbcNumberToDewies, parseLbc } from '../src/util/amount.js';

const LBC = 100_000_000n;
const INVALID = 'Enter a valid amount';

describe('parseLbc', () => {
  it('parses plain amounts', () => {
    expect(parseLbc('12.5')).toBe(1_250_000_000n);
    expect(parseLbc('0.00000001')).toBe(1n);
    expect(parseLbc('12')).toBe(12n * LBC);
    expect(parseLbc('12.')).toBe(12n * LBC);
    expect(parseLbc('.5')).toBe(50_000_000n);
    expect(parseLbc(' 12.5 ')).toBe(1_250_000_000n);
    expect(parseLbc('0.12345678')).toBe(12_345_678n);
    expect(parseLbc('007')).toBe(7n * LBC);
  });

  it('reads a lone comma as a decimal comma', () => {
    expect(parseLbc('12,5')).toBe(1_250_000_000n);
    // "0,001" BTC is 0.001 BTC: 100 000 satoshis, not 1 BTC.
    expect(parseLbc('0,001')).toBe(100_000n);
    expect(parseLbc(',5')).toBe(50_000_000n);
    expect(parseLbc('1,0005')).toBe(100_050_000n);
    expect(parseLbc('0,12345678')).toBe(12_345_678n);
    // Nothing after it is not a decimal comma.
    expect(parseLbc('12,')).toBe(parseLbc('12.')); // a trailing comma while typing, like a trailing dot
  });

  it('refuses a lone comma before exactly three digits, which could be either separator', () => {
    for (const ambiguous of ['1,000', '12,500', '999,999']) expect(() => parseLbc(ambiguous)).toThrow(INVALID);
    // Not when what precedes the comma could not start a grouped number: these can only be decimals.
    expect(parseLbc('0,000')).toBe(0n);
    expect(parseLbc('1234,567')).toBe(1_234n * LBC + 56_700_000n);
  });

  it('reads several commas as thousands grouping', () => {
    expect(parseLbc('1,000,000')).toBe(1_000_000n * LBC);
    expect(parseLbc('12,345,678')).toBe(12_345_678n * LBC);
    for (const bad of ['1,00,000', '1,000,00', '1234,567,890', ',000,000', '1,000,000,']) expect(() => parseLbc(bad)).toThrow(INVALID);
  });

  it('takes the last of "," and "." as the decimal separator', () => {
    expect(parseLbc('1.000,5')).toBe(1_000n * LBC + 50_000_000n);
    expect(parseLbc('1,000.5')).toBe(1_000n * LBC + 50_000_000n);
    expect(parseLbc('1.000.000,5')).toBe(1_000_000n * LBC + 50_000_000n);
    expect(parseLbc('1,000,000.5')).toBe(1_000_000n * LBC + 50_000_000n);
    expect(parseLbc('1.000,500')).toBe(1_000n * LBC + 50_000_000n);
    expect(parseLbc('1,000.')).toBe(1_000n * LBC);
    // The other one must then separate groups of exactly three digits.
    for (const bad of ['12,5.5', '1.5,5', '1234,567.5', '1,00.5', '1,000.5.5', '1.000,5,5', '1,000.000.5']) expect(() => parseLbc(bad)).toThrow(INVALID);
  });

  it('drops spaces that group thousands', () => {
    expect(parseLbc('1 000,5')).toBe(1_000n * LBC + 50_000_000n);
    expect(parseLbc('1\u00a0000.5')).toBe(1_000n * LBC + 50_000_000n);
    expect(parseLbc('1\u202f000\u202f000')).toBe(1_000_000n * LBC);
    expect(parseLbc('1 000')).toBe(1_000n * LBC);
    expect(parseLbc('1 000,000')).toBe(1_000n * LBC);
    for (const bad of ['12 5', '1 00', '1  000', '1 ,5', '12, 5', '1 000,000.5']) expect(() => parseLbc(bad)).toThrow(INVALID);
  });

  it('reads Arabic-Indic, Persian and Devanagari digits', () => {
    expect(parseLbc('۱۲٫۵')).toBe(1_250_000_000n); // Persian, with the Arabic decimal separator
    expect(parseLbc('۱۲,۵')).toBe(1_250_000_000n);
    expect(parseLbc('١٢.٥')).toBe(1_250_000_000n); // Arabic-Indic
    expect(parseLbc('٠٫٠٠١')).toBe(100_000n);
    expect(parseLbc('१२.५')).toBe(1_250_000_000n); // Devanagari
    expect(parseLbc('۱,۰۰۰,۰۰۰.۵')).toBe(1_000_000n * LBC + 50_000_000n);
    expect(() => parseLbc('١٢e٥')).toThrow(INVALID);
  });

  it('rejects signs, exponents, too many decimals and empty input', () => {
    for (const bad of ['', '   ', '.', ',', '-1', '+1', '1e5', '1E5', '1.5e3', 'abc', '0x10', '12.5.5', '1.000.000', '١٢٫٥٫']) {
      expect(() => parseLbc(bad)).toThrow(INVALID);
    }
    expect(() => parseLbc('0.123456789')).toThrow('LBC supports at most 8 decimal places');
    expect(() => parseLbc('0,123456789')).toThrow('LBC supports at most 8 decimal places');
  });
});

describe('formatLbc', () => {
  it('formats dewies with grouping and trimmed zeros', () => {
    expect(formatLbc(1_000n * LBC + 50_000_000n)).toBe('1,000.50');
    expect(formatLbc(1n)).toBe('0.00000001');
    expect(formatLbc(-150_000_000n)).toBe('-1.50');
    expect(formatLbc(123_456_789n, { maxDecimals: 2 })).toBe('1.23');
    expect(formatLbc(125_000_000n, { maxDecimals: 1 })).toBe('1.3');
    expect(formatLbc(1_000_000n * LBC, { group: false, minDecimals: 0 })).toBe('1000000');
  });

  it('round-trips through parseLbc', () => {
    for (const v of [1n, 12_345_678n, 1_000n * LBC + 50_000_000n, 123_456_789n * LBC]) expect(parseLbc(formatLbc(v))).toBe(v);
    expect(lbcNumberToDewies(12.5)).toBe(1_250_000_000n);
    expect(lbcNumberToDewies(0.1 + 0.2)).toBe(30_000_000n);
  });
});
