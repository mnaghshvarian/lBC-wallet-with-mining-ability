import { describe, expect, it } from 'vitest';
import { pauseReason } from '../src/main/mining/pause';
import { parsePoolUrl } from '../src/main/mining/pool-url';

describe('pauseReason', () => {
  const idle = { pauseOnBattery: true, onlyWhenIdle: true, idleMinutes: 5 };

  it('runs when nothing asks for a pause', () => {
    expect(pauseReason({ pauseOnBattery: false, onlyWhenIdle: false, idleMinutes: 5 }, { onBattery: true, idleSeconds: 0 })).toBeNull();
    expect(pauseReason(idle, { onBattery: false, idleSeconds: 300 })).toBeNull();
  });

  it('pauses on battery first, whatever the idle state', () => {
    expect(pauseReason(idle, { onBattery: true, idleSeconds: 3600 })).toBe('battery');
    expect(pauseReason({ ...idle, pauseOnBattery: false }, { onBattery: true, idleSeconds: 3600 })).toBeNull();
  });

  it('pauses while the computer is in use and resumes once idle long enough', () => {
    expect(pauseReason(idle, { onBattery: false, idleSeconds: 0 })).toBe('in-use');
    expect(pauseReason(idle, { onBattery: false, idleSeconds: 299 })).toBe('in-use');
    expect(pauseReason(idle, { onBattery: false, idleSeconds: 300 })).toBeNull();
    // any input resets the idle counter, which pauses again immediately
    expect(pauseReason(idle, { onBattery: false, idleSeconds: 1 })).toBe('in-use');
  });
});

describe('parsePoolUrl', () => {
  it('accepts stratum URLs with and without a scheme', () => {
    expect(parsePoolUrl('stratum+tcp://lbrypool.net:3334')).toEqual({ host: 'lbrypool.net', port: 3334, tls: false });
    expect(parsePoolUrl(' stratum+ssl://pool.example.com:443/ ')).toEqual({ host: 'pool.example.com', port: 443, tls: true });
    expect(parsePoolUrl('127.0.0.1:33340')).toEqual({ host: '127.0.0.1', port: 33340, tls: false });
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['', 'lbrypool.net', 'http://lbrypool.net:3334', 'stratum+tcp://pool:0', 'stratum+tcp://pool:70000', 'stratum+tcp://a b:1']) {
      expect(() => parsePoolUrl(bad), bad).toThrow();
    }
  });
});
