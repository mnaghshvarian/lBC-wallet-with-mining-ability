import { describe, expect, it } from 'vitest';
import { btc, coin, setBitcoinUnit } from '../src/lib/format';

describe('Bitcoin amounts by unit', () => {
  it('automatic: sats below 0.001 BTC, BTC above', () => {
    setBitcoinUnit('auto');
    expect(btc(20_500n)).toBe('20,500 sats');
    expect(btc(410_000n)).toBe('0.0041 BTC');
    expect(coin('20500', 'BTC')).toBe('20,500 sats');
    expect(coin('1500000000', 'LBC')).toBe('15.00 LBC');
  });

  it('fixed units and scientific notation', () => {
    expect(btc(20_500n, 'btc')).toBe('0.000205 BTC');
    expect(btc(410_000n, 'sats')).toBe('410,000 sats');
    expect(btc(2_050n, 'sci')).toBe('2.05e-5 BTC');
    expect(btc(150_000_000n, 'sci')).toBe('1.50 BTC');
    expect(btc(0n, 'sci')).toBe('0.00 BTC');
  });

  it('follows the setting', () => {
    setBitcoinUnit('sats');
    expect(btc(410_000n)).toBe('410,000 sats');
    setBitcoinUnit('auto');
  });
});
