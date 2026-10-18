import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultSettings, type Settings } from '@lbcwallet/services';
import { hostPort, lbcdArgs, lbcdVersion } from '../src/main/node-service';

function args(patch: (s: Settings) => void = () => {}): string[] {
  const settings = defaultSettings(4);
  patch(settings);
  return lbcdArgs({ settings, dir: '/data/node', configFile: '/data/node/lbcd-wallet.conf', rpcPort: 40123, rpcUser: 'u', rpcPass: 'p' });
}

describe('lbcd command line', () => {
  it('binds RPC to loopback and keeps the indexes the wallet needs', () => {
    const a = args();
    expect(a).toContain('--rpclisten=127.0.0.1:40123');
    expect(a).toContain('--txindex');
    expect(a).toContain('--addrindex');
    expect(a).toContain(`--datadir=${join('/data/node', 'data')}`);
    expect(a.some((x) => x.startsWith('--rpclisten=0.0.0.0'))).toBe(false);
  });

  it('accepts incoming connections only when asked', () => {
    expect(args()).toContain('--nolisten');
    expect(args().some((x) => x === '--upnp' || x.startsWith('--listen='))).toBe(false);
    const on = args((s) => (s.node.listen = true));
    expect(on).toContain('--listen=0.0.0.0:9246');
    expect(on).toContain('--upnp');
    expect(on).not.toContain('--nolisten');
  });

  it('sends peer connections through the SOCKS5 proxy when it is on', () => {
    expect(args().some((x) => x.startsWith('--proxy'))).toBe(false);
    const tor = args((s) => (s.socks5 = { enabled: true, host: '127.0.0.1', port: 9050 }));
    expect(tor).toContain('--proxy=127.0.0.1:9050');
    expect(hostPort('::1', 9050)).toBe('[::1]:9050');
  });

  it('adds manual peers and the test-network flags', () => {
    const a = args((s) => {
      s.network = 'regtest';
      s.node.peers = ['127.0.0.1:29246', '[::1]:29246'];
    });
    expect(a).toEqual(expect.arrayContaining(['--addpeer=127.0.0.1:29246', '--addpeer=[::1]:29246', '--regtest']));
    expect(args((s) => (s.network = 'testnet'))).toContain('--testnet');
    expect(args().some((x) => x === '--testnet' || x === '--regtest')).toBe(false);
  });
});

describe('lbcdVersion', () => {
  it('formats the numeric version', () => {
    expect(lbcdVersion(22_119_000)).toBe('lbcd 0.22.119');
    expect(lbcdVersion(0)).toBe('lbcd (development build)');
  });
});
