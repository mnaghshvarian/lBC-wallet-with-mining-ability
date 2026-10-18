import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.mnaghshvarian.lbcwallet',
  appName: 'LBC Wallet',
  webDir: 'dist',
  android: {
    // Only the app's own files are loaded; nothing over plain http.
    allowMixedContent: false,
  },
  plugins: {
    // Edge-to-edge: the UI pads itself with the injected --safe-area-inset-* values.
    SystemBars: { insetsHandling: 'css' },
  },
};

export default config;
