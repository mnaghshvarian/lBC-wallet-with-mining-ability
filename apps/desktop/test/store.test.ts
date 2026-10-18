import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readJson, writeJsonAtomic } from '../src/main/store';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'lbc-wallet-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('atomic JSON storage', () => {
  it('falls back to the backup when the main file is corrupt', () => {
    const file = join(tempDir(), 'wallet.json');
    writeJsonAtomic(file, { v: 1 }, { backup: true });
    writeJsonAtomic(file, { v: 2 }, { backup: true });
    expect(readJson(file)).toEqual({ v: 2 });
    writeFileSync(file, '{"v": 3, truncated');
    expect(readJson(file)).toEqual({ v: 1 });
  });
});
