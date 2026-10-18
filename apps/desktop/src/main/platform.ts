import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cpus } from 'node:os';
import { app, net } from 'electron';
import { nodeHttpPost, nodeLineTransport } from '@lbcwallet/core/node';
import type { JsonFiles, Platform } from '@lbcwallet/services';
import { listJsonFiles, readJson, removeFile, writeJsonAtomic } from './store';
import { log } from './log';

/** JSON documents stored as files under the app data folder (atomic writes, optional .bak). */
export function fileStore(dataDir: string): JsonFiles {
  const path = (name: string) => {
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error(`invalid document name ${name}`);
    return join(dataDir, ...name.split('/'));
  };
  return {
    read: <T>(name: string) => readJson<T>(path(name)),
    write: (name, value, options) => writeJsonAtomic(path(name), value, options),
    list: (dir, suffix) => listJsonFiles(path(dir), suffix).map((p) => `${dir}/${basename(p)}`),
    remove: (name) => removeFile(path(name)),
  };
}

export function desktopPlatform(dataDir: string): Platform {
  return {
    kind: 'desktop',
    clientName: `LBC Wallet Desktop/${app.getVersion()}`,
    files: fileStore(dataDir),
    log,
    lineTransport: (endpoint, options) => nodeLineTransport(endpoint, options),
    httpPost: (options) => nodeHttpPost(options),
    readTextFile: (p) => readFileSync(p, 'utf8'),
    // Electron's net module uses the session's proxy settings (SOCKS5 when enabled).
    fetchJson: async (url) => {
      const res = await net.fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      return body.trim() ? (JSON.parse(body) as unknown) : null;
    },
    cpuCount: cpus().length,
  };
}
