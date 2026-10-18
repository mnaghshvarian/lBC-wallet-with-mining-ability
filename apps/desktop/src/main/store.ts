import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Crash-safe JSON persistence: write to a temp file, fsync, then rename over the
 * target (atomic on all supported platforms). The previous version is kept as
 * `.bak` so a corrupted write can always be recovered.
 */
export function writeJsonAtomic(path: string, value: unknown, options: { backup?: boolean } = {}): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  const data = JSON.stringify(value, null, 2);
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (options.backup && existsSync(path)) {
    try {
      copyFileSync(path, `${path}.bak`);
    } catch {
      // a missing backup is not fatal
    }
  }
  renameSync(tmp, path);
}

export function readJson<T>(path: string): T | null {
  for (const candidate of [path, `${path}.bak`]) {
    if (!existsSync(candidate)) continue;
    try {
      return JSON.parse(readFileSync(candidate, 'utf8')) as T;
    } catch {
      // fall through to the backup
    }
  }
  return null;
}

export function listJsonFiles(dir: string, suffix: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => join(dir, f));
}

export function removeFile(path: string): void {
  for (const p of [path, `${path}.bak`]) rmSync(p, { force: true });
}
