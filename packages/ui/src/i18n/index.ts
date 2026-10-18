/**
 * Translations. Dictionaries are nested JSON objects (one file per language)
 * whose leaves are strings with `{param}` placeholders, or plural objects
 * keyed by CLDR category (`zero`, `one`, `two`, `few`, `many`, `other`) and
 * chosen with Intl.PluralRules from the `count` parameter. Missing keys fall
 * back to English, so a partial translation never shows a blank.
 */
import en from './locales/en.json';
import fa from './locales/fa.json';
import ar from './locales/ar.json';
import fr from './locales/fr.json';
import de from './locales/de.json';
import zhCN from './locales/zh-CN.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import th from './locales/th.json';
import nl from './locales/nl.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import ru from './locales/ru.json';
import ur from './locales/ur.json';
import hi from './locales/hi.json';

export type Dictionary = { [key: string]: string | Dictionary };

export interface LanguageInfo {
  code: string;
  /** Name in the language itself. */
  name: string;
  /** English name. */
  english: string;
  dir: 'ltr' | 'rtl';
}

export const LANGUAGES: LanguageInfo[] = [
  { code: 'en', name: 'English', english: 'English', dir: 'ltr' },
  { code: 'fa', name: 'فارسی', english: 'Persian', dir: 'rtl' },
  { code: 'ar', name: 'العربية', english: 'Arabic', dir: 'rtl' },
  { code: 'ur', name: 'اردو', english: 'Urdu', dir: 'rtl' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', dir: 'ltr' },
  { code: 'fr', name: 'Français', english: 'French', dir: 'ltr' },
  { code: 'de', name: 'Deutsch', english: 'German', dir: 'ltr' },
  { code: 'es', name: 'Español', english: 'Spanish', dir: 'ltr' },
  { code: 'pt', name: 'Português', english: 'Portuguese', dir: 'ltr' },
  { code: 'nl', name: 'Nederlands', english: 'Dutch', dir: 'ltr' },
  { code: 'ru', name: 'Русский', english: 'Russian', dir: 'ltr' },
  { code: 'zh-CN', name: '简体中文', english: 'Chinese (Simplified)', dir: 'ltr' },
  { code: 'ja', name: '日本語', english: 'Japanese', dir: 'ltr' },
  { code: 'ko', name: '한국어', english: 'Korean', dir: 'ltr' },
  { code: 'th', name: 'ไทย', english: 'Thai', dir: 'ltr' },
];

export const DICTIONARIES: Record<string, Dictionary> = {
  en: en as Dictionary,
  fa: fa as Dictionary,
  ar: ar as Dictionary,
  fr: fr as Dictionary,
  de: de as Dictionary,
  'zh-CN': zhCN as Dictionary,
  ja: ja as Dictionary,
  ko: ko as Dictionary,
  th: th as Dictionary,
  nl: nl as Dictionary,
  es: es as Dictionary,
  pt: pt as Dictionary,
  ru: ru as Dictionary,
  ur: ur as Dictionary,
  hi: hi as Dictionary,
};

export type Params = Record<string, string | number>;
export type Translate = (key: string, params?: Params) => string;

/** Picks the UI language: the user's choice, else the first supported system language, else English. */
export function resolveLanguage(setting: string, systemLanguages: readonly string[]): string {
  if (setting !== 'auto' && DICTIONARIES[setting]) return setting;
  for (const tag of systemLanguages) {
    const lower = tag.toLowerCase();
    if (lower.startsWith('zh')) return 'zh-CN';
    const base = lower.split(/[-_]/)[0]!;
    if (DICTIONARIES[base]) return base;
  }
  return 'en';
}

export function languageInfo(code: string): LanguageInfo {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0]!;
}

function lookup(dict: Dictionary, key: string): string | Dictionary | undefined {
  let node: string | Dictionary | undefined = dict;
  for (const part of key.split('.')) {
    if (!node || typeof node === 'string') return undefined;
    node = node[part];
  }
  return node;
}

function interpolate(template: string, params: Params | undefined): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

function pick(entry: string | Dictionary | undefined, lang: string, params: Params | undefined, rules: Intl.PluralRules): string | undefined {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof params?.count !== 'number') return undefined;
  const category = rules.select(params.count);
  const form = entry[category] ?? entry.other;
  return typeof form === 'string' ? form : undefined;
}

/** A translator for `lang` with English fallback. Unknown keys return the key itself. */
export function createTranslator(lang: string): Translate {
  const dict = DICTIONARIES[lang] ?? DICTIONARIES.en!;
  const fallback = DICTIONARIES.en!;
  const rules = new Intl.PluralRules(lang);
  const enRules = new Intl.PluralRules('en');
  return (key, params) => {
    const text = pick(lookup(dict, key), lang, params, rules) ?? pick(lookup(fallback, key), 'en', params, enRules) ?? key;
    return interpolate(text, params);
  };
}

/** Every leaf key of a dictionary (plural objects count as one key). */
export function leafKeys(dict: Dictionary, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' || isPlural(v)) out.push(path);
    else out.push(...leafKeys(v, path));
  }
  return out;
}

export function isPlural(v: string | Dictionary): v is Dictionary {
  return typeof v === 'object' && 'other' in v && typeof v.other === 'string';
}
