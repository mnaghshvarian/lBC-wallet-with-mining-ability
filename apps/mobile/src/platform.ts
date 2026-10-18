import { CapacitorHttp } from '@capacitor/core';
import type { LogLevel, Platform } from '@lbcwallet/services';
import type { DurableFiles } from './files';
import type { DeviceInfo } from './native';
import type { NativeSockets } from './sockets';

/** The services' view of Android: app-private files, native sockets and native HTTPS. */
export function androidPlatform(info: DeviceInfo, files: DurableFiles, sockets: NativeSockets): Platform {
  return {
    kind: 'android',
    clientName: `LBC Wallet Android/${info.versionName}`,
    files,
    log: (level: LogLevel, scope: string, message: string) => {
      // Release builds keep the device log quiet; warnings and errors still help bug reports.
      if (level === 'info' && !info.debug) return;
      (level === 'error' ? console.error : level === 'warn' ? console.warn : console.info)(`[${scope}] ${message}`);
    },
    // SOCKS5 is a desktop feature (the Android settings page hides it).
    lineTransport: (endpoint, options) => sockets.transport(endpoint, options.connectTimeoutMs),
    fetchJson: async (url: string) => {
      if (!url.startsWith('https://')) throw new Error('only https URLs are allowed');
      // Native HTTP: no CORS restrictions, and the system's certificate checks.
      const r = await CapacitorHttp.get({ url, headers: { Accept: 'application/json' }, responseType: 'text', connectTimeout: 15_000, readTimeout: 20_000 });
      if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
      const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data ?? '');
      return text.trim() ? JSON.parse(text) : null;
    },
    cpuCount: Math.max(1, navigator.hardwareConcurrency || 1),
  };
}
