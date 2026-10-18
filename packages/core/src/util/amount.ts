import { DEWIES_PER_LBC } from '../networks.js';

/**
 * Amount helpers. All on-chain values are integers in dewies (1e-8 LBC) held as
 * `bigint`, because the total supply (1.08e17 dewies) exceeds the safe integer
 * range of IEEE doubles.
 */

const DECIMALS = 8;
const INVALID = 'Enter a valid amount';
// Characters that may group thousands: comma, dot, and the plain, no-break and narrow no-break space.
const GROUPING = [',', '.', ' ', '\u00a0', '\u202f'];

/**
 * Parses a user-entered LBC amount ("12.5", "0.00000001") into dewies. Throws on bad input.
 * BTC amounts, which have the same eight decimals, are parsed with it too (into satoshis).
 *
 * Keyboards and habits differ, so the text is normalised first:
 * - Arabic-Indic (٠-٩), Persian (۰-۹) and Devanagari (०-९) digits become ASCII digits and the
 *   Arabic decimal separator "٫" (U+066B) a dot. A plain, no-break (U+00A0) or narrow no-break
 *   (U+202F) space between groups of three digits groups thousands ("1 000,5") and is dropped.
 * - With both "," and ".", the last one is the decimal separator and the other groups thousands:
 *   "1.000,5" and "1,000.5" are both 1000.5. Grouped digits must come in threes.
 * - With only commas, one comma followed by 1–8 digits is a decimal comma ("12,5" is 12.5, "0,001"
 *   is 0.001) and several commas each followed by three digits group thousands ("1,000,000").
 *   One comma followed by exactly three digits could be either when what precedes it could start
 *   a grouped number (1–3 digits, no leading zero): "1,000" is rejected rather than guessed, while
 *   "0,001" can only be a decimal. A dot on its own is always the decimal separator.
 * - More than 8 decimals, exponents, signs and empty input are rejected.
 */
export function parseLbc(input: string): bigint {
  const text = latinDigits(input.trim()).replace(/\u066b/g, '.');
  const decimal = decimalSeparator(text);
  const at = decimal ? text.indexOf(decimal) : text.length;
  const whole = ungroup(text.slice(0, at));
  const frac = text.slice(at + 1);
  if (whole === null || !/^\d*$/.test(frac) || !(whole || frac)) throw new Error(INVALID);
  if (frac.length > DECIMALS) throw new Error('LBC supports at most 8 decimal places');
  return BigInt(whole || '0') * DEWIES_PER_LBC + BigInt((frac + '0'.repeat(DECIMALS)).slice(0, DECIMALS));
}

/** Arabic-Indic, Persian and Devanagari digits as ASCII digits; each script's run from its zero (U+0660, U+06F0, U+0966). */
function latinDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9\u0966-\u096f]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code - (code >= 0x0966 ? 0x0966 : code >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/**
 * The decimal separator of a typed amount: the last of "," and "." when both occur, else "." or a
 * lone comma ("12,5"); "" when there is none, as with several commas ("1,000,000"), which group
 * thousands. Throws on "1,000": a possible first group, one comma and three digits fit either reading.
 */
function decimalSeparator(text: string): '.' | ',' | '' {
  const comma = text.lastIndexOf(',');
  const dot = text.lastIndexOf('.');
  if (dot > comma) return '.';
  if (comma < 0) return '';
  if (dot < 0 && text.indexOf(',') < comma) return '';
  if (dot < 0 && /^[1-9]\d{0,2},\d{3}$/.test(text)) throw new Error(INVALID);
  return ',';
}

/** "1,000,000" → "1000000": one kind of grouping character between groups of three digits, or null. */
function ungroup(whole: string): string | null {
  const separators = [...new Set(whole.replace(/\d/g, ''))];
  const separator = separators[0];
  if (separator === undefined) return whole;
  if (separators.length > 1 || !GROUPING.includes(separator)) return null;
  const [first = '', ...groups] = whole.split(separator);
  return /^\d{1,3}$/.test(first) && groups.every((g) => /^\d{3}$/.test(g)) ? first + groups.join('') : null;
}

/** Formats dewies as an LBC decimal string. Trailing zeros are trimmed beyond `minDecimals`. */
export function formatLbc(dewies: bigint, options: { minDecimals?: number; maxDecimals?: number; group?: boolean } = {}): string {
  const { minDecimals = 2, maxDecimals = 8, group = true } = options;
  const negative = dewies < 0n;
  const abs = negative ? -dewies : dewies;
  const whole = abs / DEWIES_PER_LBC;
  let frac = (abs % DEWIES_PER_LBC).toString().padStart(DECIMALS, '0');
  if (maxDecimals < DECIMALS) {
    // round half up at maxDecimals
    const factor = 10n ** BigInt(DECIMALS - maxDecimals);
    const rounded = (abs + factor / 2n) / factor;
    const scaled = 10n ** BigInt(maxDecimals);
    const w = rounded / scaled;
    const f = (rounded % scaled).toString().padStart(maxDecimals, '0');
    return finish(negative, w, f, minDecimals, group);
  }
  frac = frac.slice(0, maxDecimals);
  return finish(negative, whole, frac, minDecimals, group);
}

function finish(negative: boolean, whole: bigint, frac: string, minDecimals: number, group: boolean): string {
  let f = frac;
  while (f.length > minDecimals && f.endsWith('0')) f = f.slice(0, -1);
  const w = group ? whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole.toString();
  return `${negative ? '-' : ''}${w}${f.length ? '.' + f : ''}`;
}

/** LBC (as a JS number, e.g. from a JSON-RPC response) → dewies, without float drift. */
export function lbcNumberToDewies(value: number): bigint {
  return parseLbc(value.toFixed(DECIMALS));
}

export function dewiesToNumber(dewies: bigint): number {
  return Number(dewies) / Number(DEWIES_PER_LBC);
}
