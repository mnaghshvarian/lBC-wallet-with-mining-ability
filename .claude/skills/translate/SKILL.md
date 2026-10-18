---
name: translate
description: Translate new or changed LBC Wallet UI texts into all 15 languages (or add a new language) with the project's checks — delta extraction, translator instructions, plural forms, placeholder and Latin-term checks, merging, quick-start guides. Use whenever en.json gets new keys, a locale test fails, or someone asks for another language.
---

# Translating LBC Wallet

UI texts live in `packages/ui/src/i18n/locales/<code>.json` (nested JSON; `{name}` placeholders;
plural entries are objects keyed by CLDR category). English (`en.json`) is the source. The test
`packages/ui/test/i18n.test.ts` fails until every language has every English key, the same
placeholders, and only plural forms the language uses. Quick-start guides:
`docs/manual/quickstart/<code>.md`.

Languages (15): en, fa, ar, ur, hi, fr, de, es, pt, nl, ru, zh-CN, ja, ko, th.
Plural forms (Intl.PluralRules): ar zero/one/two/few/many/other · ru one/few/many/other ·
fr/es/pt one/many/other · fa/ur/hi/de/nl one/other · zh-CN/ja/ko/th other.

## 1. Write the English first

Add keys to `en.json` only (texts for beginners: short, concrete, no jargon). New service error
codes need `error.<code>` in en.json with the same placeholders as `ERROR_MESSAGES`
(`packages/services/src/errors.ts`). Run `npx vitest run --dir packages/ui` — "defines every key
the code uses" must pass for English.

## 2. Extract the delta

In a scratch folder (never in the repo), write `delta.en.json` = keys of en.json missing from
another locale (e.g. compare with fa.json), keeping en.json's order. Count the strings.

## 3. Instructions + checker

Write `INSTRUCTIONS.md` for translators: what the feature is (in plain words), the words to use
(reuse each language's existing terms: wallet, lock, collect, refund, Settings → Network…), what
each placeholder holds, the plural forms above, and the rules:

* same structure and key order; real UTF-8, no `\u` escapes; trailing newline;
* placeholders exactly as written; Western digits 0-9;
* keep in Latin script: LBC, LBRY, LBC Wallet, BTC, XMR, USDT, MEXC, Nostr, wss://, sats,
  sat/vB, Esplora, blockstream.info, mempool.space, lbcswap:, bc1…, SOCKS5, BIP39, file names;
* no HTML/Markdown/direction marks; badges and buttons short; legal and safety texts keep every
  point at full strength;
* typography of the existing file (French spaces before : ; ? !, « »/„ “/「」 quotes, Persian ZWNJ).

A checker script compares `delta.<code>.json` with `delta.en.json`: structure/order, placeholders
(a plural form may spell out `{count}`), plural form sets per language, digits, kept Latin terms,
empties. Every translation must print OK before merging.

## 4. Translate

Use parallel agents (for example fa+ar+ur, fr+de+es+pt, nl+ru+th, zh-CN+ja+ko), each told to read
the instructions and their language's existing file, write only their delta files and their own
quick-start guide, run the checker, and re-read as a native speaker. For a whole new language,
split en.json by top-level sections across 2–3 agents with a shared glossary, then merge the
parts and check the whole file.

## 5. Merge and verify

Merge each delta into its locale in English key order (keys missing from the locale come from the
delta; keys English no longer has are dropped). Then:

```bash
npx vitest run --dir packages/ui        # all locales, plurals, placeholders
npm run typecheck
```

Look at the result in the app (Settings → General → Language), especially right-to-left
languages, long German/Russian words in buttons, and Devanagari/Thai line heights.

## Adding a new language

1. Full translation `locales/<code>.json` (all keys) and `docs/manual/quickstart/<code>.md`.
2. `packages/ui/src/i18n/index.ts`: import it, add to `LANGUAGES` (name in its own script,
   English name, `dir`) and `DICTIONARIES`.
3. `packages/services/src/settings.ts`: add the code to `LANGUAGES`.
4. Tests: the language count in `packages/ui/test/i18n.test.ts`, the accepted languages in
   `packages/services/test/settings.test.ts`, and the plural forms table in the checker.
5. Fonts: a script the systems may lack needs a bundled font (`@fontsource-variable/...`,
   imported in `packages/ui/src/index.tsx`) and a `:root:lang(<code>) body` rule in
   `packages/ui/src/styles/global.css` (joined scripts also go in the letter-spacing reset).
6. Docs: the language lists in README.md, docs/manual/README.md, DISCLAIMER.md ("in N
   languages", then `node apps/desktop/scripts/license-text.mjs`), docs/ROADMAP.md,
   docs/ARCHITECTURE.md, release notes and announcements.
