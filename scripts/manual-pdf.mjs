// Renders the beginner's manual (docs/manual/README.md) to docs/manual/LBC-Wallet-Manual.pdf.
//   node scripts/manual-pdf.mjs [path to a Chromium executable]
// Uses playwright-core with an installed Chromium (PLAYWRIGHT_BROWSERS_PATH or the given path).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'docs/manual');
const markdown = readFileSync(join(dir, 'README.md'), 'utf8');

// GitHub-style heading ids, so the table of contents links work inside the PDF.
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
const marked = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      return `<h${depth} id="${slug(text)}">${text}</h${depth}>\n`;
    },
  },
});

// GitHub alerts (> [!WARNING]) become coloured boxes.
const ALERTS = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' };
let html = marked.parse(markdown);
html = html.replace(/<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/g, (_, kind) => `<blockquote class="alert ${kind.toLowerCase()}"><p><strong>${ALERTS[kind]}.</strong> `);
// Links to other repository files point at GitHub; in-page anchors stay.
html = html.replace(/href="\.\.\/\.\.\/([^"#]+)"/g, 'href="https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/blob/HEAD/$1"');
html = html.replace(/href="(quickstart\/[^"]+)"/g, 'href="https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/blob/HEAD/docs/manual/$1"');
// Pictures are embedded (a generated page may not load local files).
html = html.replace(/src="(images\/[^"]+\.(png|gif))"/g, (_, file, ext) => `src="data:image/${ext};base64,${readFileSync(join(dir, file)).toString('base64')}"`);

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>LBC Wallet — the complete beginner's manual</title>
<style>
  @page { size: A4; margin: 16mm 15mm; }
  body { font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1b2233; }
  h1 { font-size: 22pt; color: #0b7a5f; margin: 0 0 8pt; }
  h2 { font-size: 15pt; color: #0b7a5f; border-bottom: 1px solid #d5dbe7; padding-bottom: 3pt; margin-top: 18pt; break-after: avoid; }
  h3 { font-size: 12pt; margin-top: 12pt; break-after: avoid; }
  a { color: #1565c0; text-decoration: none; }
  img { max-width: 100%; border: 1px solid #d5dbe7; border-radius: 6px; margin: 4pt 0; break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; font-size: 9pt; margin: 6pt 0; }
  th, td { border: 1px solid #d5dbe7; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #f1f4f9; }
  code { font-family: 'Cascadia Mono', Menlo, Consolas, monospace; font-size: 9pt; background: #f1f4f9; padding: 0 3px; border-radius: 3px; word-break: break-all; }
  pre { background: #f1f4f9; padding: 6pt 8pt; border-radius: 6px; white-space: pre-wrap; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 8pt 0; padding: 6pt 10pt; border-left: 4px solid #9aa5b8; background: #f6f8fb; break-inside: avoid; }
  blockquote.alert.warning, blockquote.alert.caution { border-color: #d9480f; background: #fff4ec; }
  blockquote.alert.important { border-color: #7048e8; background: #f3f0ff; }
  blockquote.alert.note, blockquote.alert.tip { border-color: #1c7ed6; background: #eef6ff; }
  hr { border: none; border-top: 1px solid #d5dbe7; margin: 12pt 0; }
</style></head><body>${html}</body></html>`;

const executablePath = process.argv[2] ?? [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].find((p) => p && existsSync(p));
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const tab = await browser.newPage();
await tab.setContent(page, { waitUntil: 'load' });
const pdf = await tab.pdf({
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="font-size:8px;color:#888;width:100%;text-align:center">LBC Wallet manual · page <span class="pageNumber"></span> of <span class="totalPages"></span> · experimental, unaudited software — use at your own risk</div>',
  margin: { top: '16mm', bottom: '18mm', left: '15mm', right: '15mm' },
});
await browser.close();
writeFileSync(join(dir, 'LBC-Wallet-Manual.pdf'), pdf);
console.log(`wrote docs/manual/LBC-Wallet-Manual.pdf (${(pdf.length / 1e6).toFixed(1)} MB)`);
