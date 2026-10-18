import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('installer license page', () => {
  it('matches DISCLAIMER.md and LICENSE', () => {
    // Throws (and prints how to fix it) when build/license_en.txt is out of date.
    expect(() => execFileSync(process.execPath, [join(__dirname, '../scripts/license-text.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
