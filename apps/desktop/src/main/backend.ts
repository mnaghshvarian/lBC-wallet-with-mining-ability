import { readFileSync } from 'node:fs';
import { HubBackend, LbcdBackend, LbcdRpc, getNetwork, type ChainBackend, type SocketEndpoint } from '@lbcwallet/core';
import { nodeHttpPost, nodeLineTransport } from '@lbcwallet/core/node';
import type { Settings } from '../shared/api';
import { logger } from './log';

export const CLIENT_NAME = 'LBC Wallet Desktop/1.0';

export function hubServers(settings: Settings): SocketEndpoint[] {
  const net = getNetwork(settings.network);
  const list = [...(settings.useDefaultHubs ? net.defaultHubs : []), ...settings.customHubs];
  const seen = new Set<string>();
  return list.filter((h) => {
    const k = `${h.host}:${h.port}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function transportFactory(settings: Settings) {
  const socks5 = settings.socks5.enabled ? { host: settings.socks5.host, port: settings.socks5.port } : undefined;
  return (ep: SocketEndpoint) => nodeLineTransport(ep, { socks5, connectTimeoutMs: socks5 ? 30_000 : 8_000 });
}

export function lbcdRpc(settings: Settings): LbcdRpc {
  let ca: string | undefined;
  if (settings.lbcd.certPath) {
    try {
      ca = readFileSync(settings.lbcd.certPath, 'utf8');
    } catch (err) {
      throw new Error(`Cannot read node certificate: ${(err as Error).message}`);
    }
  }
  return new LbcdRpc({
    url: settings.lbcd.url,
    username: settings.lbcd.username,
    password: settings.lbcd.password,
    post: nodeHttpPost({ ca }),
  });
}

/** Builds the chain backend selected in settings (remote hubs or the user's own lbcd). */
export function createBackend(settings: Settings): ChainBackend {
  const network = getNetwork(settings.network);
  if (settings.backendMode === 'lbcd') {
    const url = new URL(settings.lbcd.url);
    return new LbcdBackend(lbcdRpc(settings), network, { label: `lbcd ${url.host}`, log: logger('lbcd') });
  }
  const servers = hubServers(settings);
  if (servers.length === 0) throw new Error('No hub servers configured. Add one in Settings → Network.');
  // Spread load across hubs: start at a random server each session.
  const offset = Math.floor(Math.random() * servers.length);
  const rotated = [...servers.slice(offset), ...servers.slice(0, offset)];
  return new HubBackend({ servers: rotated, transportFactory: transportFactory(settings), network, clientName: CLIENT_NAME, log: logger('hub') });
}
