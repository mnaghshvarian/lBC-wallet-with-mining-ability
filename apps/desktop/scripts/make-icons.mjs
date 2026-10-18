#!/usr/bin/env node
// Renders the SVG logo to the PNG icons used by Electron and electron-builder.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'src/renderer/src/assets/logo.svg'));

function render(size, out) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng();
  writeFileSync(join(root, out), png);
  console.log(`${out} (${size}px)`);
}

render(1024, 'build/icon.png');
render(512, 'resources/icon.png');
for (const size of [16, 32, 48, 64, 128, 256, 512]) render(size, `build/icons/${size}x${size}.png`);
