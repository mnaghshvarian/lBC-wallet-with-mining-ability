import { DEWIES_PER_LBC } from '../networks.js';

/**
 * Amount helpers. All on-chain values are integers in dewies (1e-8 LBC) held as
 * `bigint`, because the total supply (1.08e17 dewies) exceeds the safe integer
 * range of IEEE doubles.
 */

const DECIMALS = 8;

/** Parses a user-entered LBC amount ("12.5", "0.00000001") into dewies. Throws on bad input. */
export function parseLbc(input: string): bigint {
  const text = input.trim().replace(/,/g, '');
  if (!/^\d*(\.\d*)?$/.test(text) || text === '' || text === '.') {
    throw new Error('Enter a valid amount');
  }
  const [whole = '0', frac = ''] = text.split('.');
  if (frac.length > DECIMALS) throw new Error('LBC supports at most 8 decimal places');
  const dewies = BigInt(whole || '0') * DEWIES_PER_LBC + BigInt((frac + '0'.repeat(DECIMALS)).slice(0, DECIMALS));
  return dewies;
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
