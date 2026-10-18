// Turns DISCLAIMER.md + LICENSE into the plain-text license page shown by the
// Windows installer and the macOS disk image (build/license_en.txt).
//   node scripts/license-text.mjs          # write the file
//   node scripts/license-text.mjs --check  # fail if it is out of date
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const target = join(root, 'apps/desktop/build/license_en.txt');

function wrap(text, width = 78, indent = '') {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > width) {
      out.push(line);
      line = indent + word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

// Installers show plain text; keep it ASCII so every installer renders it correctly.
const ascii = (s) =>
  s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/—/g, '-')
    .replace(/…/g, '...');

export function licenseText() {
  const disclaimer = readFileSync(join(root, 'DISCLAIMER.md'), 'utf8');
  const license = readFileSync(join(root, 'LICENSE'), 'utf8');
  const lines = [];
  for (const block of disclaimer.split(/\n\s*\n/)) {
    let p = block.trim();
    if (!p) continue;
    p = p.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1').replace(/<(https?:\/\/[^>]+)>/g, '$1').replace(/\*\*/g, '').replace(/`/g, '');
    if (p.startsWith('#')) {
      lines.push(p.replace(/^#+\s*/, '').toUpperCase(), '');
    } else if (p.startsWith('>')) {
      lines.push(...wrap(p.replace(/^>\s?/gm, ' ')), '');
    } else if (p.startsWith('* ')) {
      for (const item of p.split(/\n(?=\* )/)) lines.push(...wrap(item, 78, '  '));
      lines.push('');
    } else {
      lines.push(...wrap(p), '');
    }
  }
  const text = `${lines.join('\n')}\n${'-'.repeat(78)}\n\n${license}`;
  return ascii(text).replace(/\r?\n/g, '\r\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = licenseText();
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== text) {
      console.error('build/license_en.txt is out of date: run node scripts/license-text.mjs');
      process.exit(1);
    }
  } else {
    writeFileSync(target, text);
    console.log(`wrote ${target}`);
  }
}
