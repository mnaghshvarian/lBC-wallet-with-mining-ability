import type { ByteTransport, HttpPost, LineTransport, SocketEndpoint } from '@lbcwallet/core';

export type LogLevel = 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string) => void;

/**
 * A small store of JSON documents addressed by relative names such as
 * `settings.json` or `wallets/<id>.lbcwallet.json`. Reads are synchronous so
 * services stay simple; implementations either use the file system directly
 * (desktop) or keep a cache that is loaded at startup and written behind
 * (Android). Writes must be atomic: a crash leaves the old or the new
 * document, never a torn one.
 */
export interface JsonFiles {
  read<T>(name: string): T | null;
  write(name: string, value: unknown, options?: { backup?: boolean }): void;
  /** Names in `dir` ending with `suffix`, as `dir/<file>`. */
  list(dir: string, suffix: string): string[];
  remove(name: string): void;
}

export interface SocketOptions {
  socks5?: { host: string; port: number };
  connectTimeoutMs: number;
}

/** Everything the shared services need from the operating system. */
export interface Platform {
  kind: 'desktop' | 'android' | 'web';
  /** Identifies the app to LBRY hubs, e.g. "LBC Wallet Desktop/1.1". */
  clientName: string;
  files: JsonFiles;
  log(level: LogLevel, scope: string, message: string): void;
  /** Newline-delimited JSON socket (LBRY hubs, Stratum). */
  lineTransport(endpoint: SocketEndpoint, options: SocketOptions): LineTransport;
  /** Raw byte socket (WebSocket connections to the order board's relays); undefined where unsupported. */
  byteTransport?(endpoint: SocketEndpoint, options: SocketOptions): ByteTransport;
  /** HTTP POST for an lbcd node's JSON-RPC; undefined where unsupported. */
  httpPost?(options: { ca?: string }): HttpPost;
  /** Reads a small text file chosen by the user (e.g. an lbcd TLS certificate). */
  readTextFile?(path: string): string;
  /** GET a JSON document over HTTPS (prices, pool statistics, a Bitcoin explorer). */
  fetchJson(url: string): Promise<unknown>;
  /** POST a text body over HTTPS and resolve with the response text (broadcasting through a Bitcoin explorer). */
  postText?(url: string, body: string): Promise<string>;
  cpuCount: number;
}

export function scopedLogger(platform: Platform, scope: string): Logger {
  return (level, message) => platform.log(level, scope, message);
}
