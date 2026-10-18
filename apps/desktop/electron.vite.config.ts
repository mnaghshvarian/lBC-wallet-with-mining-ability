import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Everything (including @lbcwallet/core and its audited crypto deps) is bundled,
// so the packaged app ships no node_modules and no native modules.
export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          minerProcess: resolve(__dirname, 'src/main/mining/miner-process.ts'),
          hashWorker: resolve(__dirname, 'src/main/mining/hash-worker.ts'),
        },
        external: ['electron'],
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        external: ['electron'],
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
      minify: 'esbuild',
      sourcemap: false,
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
