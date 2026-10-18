import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

let logFile: string | null = null;
const MAX_BYTES = 5 * 1024 * 1024;

export function initLog(dir: string): void {
  mkdirSync(dir, { recursive: true });
  logFile = join(dir, 'lbc-wallet.log');
}

/** Never log secrets: callers pass only operational messages. */
export function log(level: 'info' | 'warn' | 'error', scope: string, message: string): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}\n`;
  if (level === 'error') console.error(line.trimEnd());
  else console.log(line.trimEnd());
  if (!logFile) return;
  try {
    if (existsSync(logFile) && statSync(logFile).size > MAX_BYTES) renameSync(logFile, `${logFile}.1`);
    appendFileSync(logFile, line, { mode: 0o600 });
  } catch {
    // logging must never crash the app
  }
}

export const logger = (scope: string) => (level: 'info' | 'warn' | 'error', message: string) => log(level, scope, message);
