import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from '@lbcwallet/services';
import { DICTIONARIES, LANGUAGES, createTranslator, isPlural, leafKeys, resolveLanguage, type Dictionary } from '../src/i18n';

const en = DICTIONARIES.en!;
const SOURCES = [join(__dirname, '../src'), join(__dirname, '../../../apps/desktop/src/main')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

function entry(dict: Dictionary, key: string): string | Dictionary | undefined {
  let node: string | Dictionary | undefined = dict;
  for (const part of key.split('.')) {
    if (!node || typeof node === 'string') return undefined;
    node = node[part];
  }
  return node;
}

/** Placeholder names used by a string or by every form of a plural entry. */
function placeholders(v: string | Dictionary): string[] {
  const texts = typeof v === 'string' ? [v] : Object.values(v).filter((x): x is string => typeof x === 'string');
  return [...new Set(texts.flatMap((s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!)))].sort();
}

/** Keys used in code: t('a.b'), tr(x, 'a.b'), l('b') for menu.b, and prefixes of t(`a.${x}`). */
function usedKeys(): { exact: Set<string>; prefixes: Set<string> } {
  const exact = new Set<string>();
  const prefixes = new Set<string>();
  for (const file of SOURCES.flatMap(sourceFiles)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\(\s*'([\w.]+)'/g)) exact.add(m[1]!);
    for (const m of src.matchAll(/\btr\([^,]+,\s*'([\w.]+)'/g)) exact.add(m[1]!);
    for (const m of src.matchAll(/\bl\('(\w+)'\)/g)) exact.add(`menu.${m[1]}`);
    for (const m of src.matchAll(/\bt\(\s*`([\w.]+)\$\{/g)) prefixes.add(m[1]!);
  }
  return { exact, prefixes };
}

describe('dictionaries', () => {
  it('has a dictionary for every listed language', () => {
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(Object.keys(DICTIONARIES).sort());
    expect(LANGUAGES).toHaveLength(15);
  });

  it('defines every key the code uses', () => {
    const { exact, prefixes } = usedKeys();
    expect(exact.size).toBeGreaterThan(300);
    const missing = [...exact].filter((k) => entry(en, k) === undefined || (typeof entry(en, k) === 'object' && !isPlural(entry(en, k)!)));
    expect(missing).toEqual([]);
    const all = leafKeys(en);
    for (const p of prefixes) expect(all.some((k) => k.startsWith(p)), p).toBe(true);
  });

  it('has an English text for every service error code, with the same placeholders', () => {
    for (const [code, text] of Object.entries(ERROR_MESSAGES)) {
      const v = entry(en, `error.${code}`);
      expect(v, code).toBeTypeOf('string');
      expect(placeholders(v!), code).toEqual(placeholders(text));
    }
  });

  for (const { code } of LANGUAGES.filter((l) => l.code !== 'en')) {
    describe(code, () => {
      const dict = DICTIONARIES[code]!;
      const keys = leafKeys(dict);

      it('translates every English key', () => {
        const have = new Set(keys);
        expect(leafKeys(en).filter((k) => !have.has(k))).toEqual([]);
      });

      it('has no keys that English does not have', () => {
        const english = new Set(leafKeys(en));
        expect(keys.filter((k) => !english.has(k))).toEqual([]);
      });

      it('keeps the placeholders of the English text', () => {
        const wrong = keys.filter((k) => {
          const mine = entry(dict, k)!;
          const theirs = entry(en, k);
          if (theirs === undefined) return false;
          const expected = placeholders(theirs);
          // A plural form may spell out the number instead of using {count} (e.g. "one" → "a block").
          const got = placeholders(mine);
          return got.some((p) => !expected.includes(p)) || expected.filter((p) => p !== 'count').some((p) => !got.includes(p));
        });
        expect(wrong).toEqual([]);
      });

      it('gives plural entries the forms the language needs', () => {
        const rules = new Intl.PluralRules(code);
        const needed = rules.resolvedOptions().pluralCategories;
        for (const k of keys) {
          const v = entry(dict, k)!;
          if (typeof v === 'string') continue;
          expect(v.other, k).toBeTypeOf('string');
          for (const form of Object.keys(v)) expect(needed, `${k}.${form}`).toContain(form);
        }
      });

      it('has no empty texts', () => {
        expect(keys.filter((k) => {
          const v = entry(dict, k)!;
          return typeof v === 'string' ? !v.trim() : Object.values(v).some((x) => typeof x !== 'string' || !x.trim());
        })).toEqual([]);
      });
    });
  }
});

describe('translator', () => {
  it('interpolates parameters and picks plural forms', () => {
    const t = createTranslator('en');
    expect(t('badge.maturesIn', { count: 1 })).toBe('Matures in 1 block');
    expect(t('badge.maturesIn', { count: 5 })).toBe('Matures in 5 blocks');
    expect(t('review.sendButton', { amount: '1.5' })).toBe('Send 1.5 LBC');
  });

  it('falls back to English, then to the key', () => {
    const t = createTranslator('xx');
    expect(t('nav.send')).toBe('Send');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('uses Arabic plural categories', () => {
    expect(new Intl.PluralRules('ar').select(0)).toBe('zero');
    expect(new Intl.PluralRules('ar').select(2)).toBe('two');
    const t = createTranslator('ar');
    // Every count yields some text (never the key).
    for (const n of [0, 1, 2, 3, 11, 100]) expect(t('badge.maturesIn', { count: n })).not.toBe('badge.maturesIn');
  });

  it('resolves the language from the setting and the system', () => {
    expect(resolveLanguage('auto', ['fa-IR', 'en-US'])).toBe('fa');
    expect(resolveLanguage('auto', ['zh-TW'])).toBe('zh-CN');
    expect(resolveLanguage('auto', ['pt-BR'])).toBe('pt');
    expect(resolveLanguage('auto', ['sw-KE'])).toBe('en');
    expect(resolveLanguage('de', ['fa-IR'])).toBe('de');
    expect(resolveLanguage('xx', ['ja-JP'])).toBe('ja');
  });
});
