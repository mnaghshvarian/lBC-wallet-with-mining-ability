/** Parses stratum+tcp://host:port (or stratum+ssl:// for TLS); the scheme is optional. */
export function parsePoolUrl(url: string): { host: string; port: number; tls: boolean } {
  const text = url.trim();
  const m = /^(?:(stratum\+tcp|stratum\+ssl|stratum\+tls|stratum|tcp|ssl):\/\/)?([^:/\s]+):(\d{1,5})\/?$/i.exec(text);
  if (!m) throw new Error('Pool address must look like stratum+tcp://host:port');
  const port = Number(m[3]);
  if (port < 1 || port > 65535) throw new Error('Invalid pool port');
  const scheme = (m[1] ?? 'stratum+tcp').toLowerCase();
  return { host: m[2]!, port, tls: scheme.includes('ssl') || scheme.includes('tls') };
}
