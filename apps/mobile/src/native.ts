import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** One line received on a socket, or the socket closing. */
export interface SocketEvent {
  id: string;
  type: 'line' | 'close';
  line?: string;
  error?: string;
}

export interface DeviceInfo {
  /** Android API level and version name. */
  sdkInt: number;
  release: string;
  /** System WebView version. */
  webView: string;
  versionName: string;
  /** Folder holding the wallet files (app-private storage). */
  dataDir: string;
  debug: boolean;
}

/** The app's own native plugin (android/app/src/main/java/.../LbcNativePlugin.java). */
export interface LbcNativePlugin {
  info(): Promise<DeviceInfo>;
  /** Every stored document, by relative name (e.g. "wallets/<id>.lbcwallet.json"). */
  loadFiles(): Promise<{ files: Record<string, string> }>;
  /** Atomically replaces a document. */
  writeFile(options: { name: string; content: string }): Promise<void>;
  deleteFile(options: { name: string }): Promise<void>;
  /** Opens a TCP (or TLS, with certificate and host name checks) connection. */
  socketConnect(options: { host: string; port: number; tls: boolean; timeoutMs: number }): Promise<{ id: string }>;
  socketWrite(options: { id: string; data: string }): Promise<void>;
  socketClose(options: { id: string }): Promise<void>;
  /** Blocks screenshots and hides the app preview while sensitive data is shown. */
  setSecure(options: { on: boolean }): Promise<void>;
  /** Opens an https link in the user's browser. */
  openUrl(options: { url: string }): Promise<void>;
  /** Copies text; sensitive text is hidden from clipboard previews and cleared after 30 seconds. */
  copy(options: { text: string; sensitive: boolean }): Promise<void>;
  paste(): Promise<{ text: string }>;
  /** Shares a text file through the Android share sheet. */
  shareText(options: { filename: string; mimeType: string; text: string; title: string }): Promise<void>;
  exit(): Promise<void>;
  addListener(event: 'socket', handler: (e: SocketEvent) => void): Promise<PluginListenerHandle>;
}

export const LbcNative = registerPlugin<LbcNativePlugin>('LbcNative');
