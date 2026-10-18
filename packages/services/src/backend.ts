import { HubBackend, LbcdBackend, LbcdRpc, getNetwork, type ChainBackend, type LineTransport, type SocketEndpoint } from '@lbcwallet/core';
import type { Settings } from './api.js';
import { UserError } from './errors.js';
import { scopedLogger, type Platform } from './platform.js';

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

export function transportFactory(settings: Settings, platform: Platform): (ep: SocketEndpoint) => LineTransport {
  const socks5 = settings.socks5.enabled ? { host: settings.socks5.host, port: settings.socks5.port } : undefined;
  return (ep) => platform.lineTransport(ep, { socks5, connectTimeoutMs: socks5 ? 30_000 : 8_000 });
}

/** JSON-RPC client for the user's own lbcd (Settings → Network). */
export function lbcdRpc(settings: Settings, platform: Platform): LbcdRpc {
  if (!platform.httpPost) throw new UserError('nodeUnsupported');
  if (!settings.lbcd.url || !settings.lbcd.username) throw new UserError('nodeNotConfigured');
  let ca: string | undefined;
  if (settings.lbcd.certPath) {
    try {
      ca = platform.readTextFile?.(settings.lbcd.certPath);
    } catch (err) {
      throw new UserError('nodeCertUnreadable', { detail: (err as Error).message });
    }
  }
  return new LbcdRpc({
    url: settings.lbcd.url,
    username: settings.lbcd.username,
    password: settings.lbcd.password,
    post: platform.httpPost({ ca }),
  });
}

/** Connection details of the built-in node, while it is running. */
export interface LocalNode {
  rpc: LbcdRpc;
  label: string;
  synced: boolean;
}

export function createHubBackend(settings: Settings, platform: Platform): HubBackend {
  const servers = hubServers(settings);
  if (servers.length === 0) throw new UserError('noHubs');
  // Spread load across hubs: start at a random server each session.
  const offset = Math.floor(Math.random() * servers.length);
  const rotated = [...servers.slice(offset), ...servers.slice(0, offset)];
  return new HubBackend({
    servers: rotated,
    transportFactory: transportFactory(settings, platform),
    network: getNetwork(settings.network),
    clientName: platform.clientName,
    log: scopedLogger(platform, 'hub'),
  });
}

/**
 * Builds the chain backend selected in settings: public hubs, the user's own
 * lbcd, or the built-in node once it is synced (hubs until then).
 */
export function createBackend(settings: Settings, platform: Platform, localNode?: LocalNode | null): ChainBackend {
  const network = getNetwork(settings.network);
  if (settings.backendMode === 'lbcd') {
    const url = new URL(settings.lbcd.url);
    return new LbcdBackend(lbcdRpc(settings, platform), network, { label: `lbcd ${url.host}`, log: scopedLogger(platform, 'lbcd') });
  }
  if (settings.backendMode === 'local' && localNode?.synced) {
    return new LbcdBackend(localNode.rpc, network, { label: localNode.label, log: scopedLogger(platform, 'lbcd') });
  }
  return createHubBackend(settings, platform);
}
