import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds the web part of the Android app into dist/, which `cap sync` copies into the APK.
export default defineConfig({
  base: './',
  plugins: [react()],
  // The miner's hashing threads are module workers (src/mining/hash-worker.ts).
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // Everything is local; one chunk keeps start-up simple.
    chunkSizeWarningLimit: 2000,
  },
});
