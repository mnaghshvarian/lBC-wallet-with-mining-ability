import { app, BrowserWindow, Menu, nativeTheme, powerMonitor, session, shell, type MenuItemConstructorOptions } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MiningInfo, PriceService, SettingsStore, SwapService, WalletService, type LbcEvents, type Settings } from '@lbcwallet/services';
import { MinerService } from './miner-service';
import { NodeService } from './node-service';
import { registerIpc } from './ipc';
import { initLog, log } from './log';
import { desktopPlatform } from './platform';
import { tr } from './i18n';

// Sandbox every renderer process, unless the OS sandbox was explicitly disabled
// with --no-sandbox (needed on some Linux setups); forcing it then would crash
// child processes. Renderers still run with `sandbox: true` either way.
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();
app.setName('LBC Wallet');
// Portable / test installs can keep their data elsewhere.
if (process.env.LBC_WALLET_DATA_DIR) app.setPath('userData', process.env.LBC_WALLET_DATA_DIR);
if (process.platform === 'win32') app.setAppUserModelId('io.github.mnaghshvarian.lbcwallet');

const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
const rendererFile = join(__dirname, '../renderer/index.html');
const rendererUrl = pathToFileURL(rendererFile).toString();

function isTrustedUrl(url: string): boolean {
  if (devServerUrl && !app.isPackaged && url.startsWith(devServerUrl)) return true;
  return url === rendererUrl || url.startsWith(rendererUrl + '#') || url.startsWith(rendererUrl + '?');
}

if (!app.requestSingleInstanceLock()) {
  // Another instance owns the wallet files; focus it instead.
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;

  const send = <E extends keyof LbcEvents>(event: E, payload: LbcEvents[E]) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(event, payload);
  };

  // No spell checking anywhere (recovery phrases are typed into this app). With
  // no languages configured Chromium also skips downloading dictionaries from
  // Google at startup (setting a language list is a no-op on macOS).
  app.on('session-created', (ses) => {
    ses.setSpellCheckerEnabled(false);
    ses.setSpellCheckerLanguages([]);
  });

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    const dataDir = app.getPath('userData');
    initLog(join(dataDir, 'logs'));
    log('info', 'app', `starting LBC Wallet ${app.getVersion()} (electron ${process.versions.electron}, ${process.platform}/${process.arch})`);

    const platform = desktopPlatform(dataDir);
    const settings = new SettingsStore(platform.files, platform.cpuCount);
    const applyTheme = () => {
      nativeTheme.themeSource = settings.get().theme;
    };
    applyTheme();
    await applyProxy(settings.get());
    settings.onChange((next, prev) => {
      if (next.theme !== prev.theme) applyTheme();
      if (JSON.stringify(next.socks5) !== JSON.stringify(prev.socks5)) void applyProxy(next);
    });

    const price = new PriceService(platform, settings, (p) => send('price:update', p));
    const wallets = new WalletService(platform, settings, {
      changed: (o) => send('wallet:changed', o),
      locked: (reason) => send('wallet:locked', { reason }),
      network: (st) => send('network:status', st),
      notice: (n) => send('notice', n),
    });
    const miningInfo = new MiningInfo(platform, settings, {
      walletAddress: () => wallets.miningAddress(),
      chainTip: () => wallets.tipBits(),
      price: () => price.get()?.price ?? null,
    });
    const node = new NodeService({
      settings,
      appDataDir: dataDir,
      binary: lbcdBinary(),
      onStatus: (st) => send('node:status', st),
      onNotice: (n) => send('notice', n),
      onAvailabilityChange: () => void wallets.localNodeChanged().catch((e) => log('warn', 'node', `wallet backend switch failed: ${(e as Error).message}`)),
      hubHeight: () => wallets.overview()?.backend.height ?? null,
    });
    wallets.setLocalNode(() => node.localNode());
    let lastBlockNotice = 0;
    const miner = new MinerService({
      settings,
      miningInfo,
      clientName: platform.clientName,
      builtInNode: () => node.soloNode(),
      onStats: (st) => send('miner:stats', st),
      onLog: (e) => send('miner:log', e),
      onBlock: (b) => {
        // One notice per few seconds, even where blocks come fast (test networks).
        if (!b.accepted || Date.now() - lastBlockNotice < 10_000) return;
        lastBlockNotice = Date.now();
        send('notice', { kind: 'block-found', code: 'blockFound', params: { height: b.height } });
      },
    });

    const swaps = new SwapService(platform, settings, {
      wallet: () => wallets.swapWallet(),
      changed: (v) => send('swap:changed', v),
      notice: (n) => send('notice', n),
    });

    registerIpc({ platform, wallets, settings, miner, price, miningInfo, node, swaps, isTrustedUrl }, () => mainWindow);
    price.start();
    swaps.watch();
    // Restart the built-in node if it was running when the app last closed.
    if (settings.get().node.enabled && node.available) {
      void node.start().catch((e) => log('warn', 'node', `could not start the built-in node: ${(e as Error).message}`));
    }

    // Lock the wallet when the computer sleeps or the screen locks.
    const systemLock = () => {
      if (wallets.isOpen) void wallets.lock('system');
    };
    powerMonitor.on('suspend', systemLock);
    powerMonitor.on('lock-screen', systemLock);

    hardenSessions();
    buildMenu(settings.get().language);
    settings.onChange((next, prev) => {
      if (next.language !== prev.language) buildMenu(next.language);
    });
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
    });

    let shuttingDown = false;
    app.on('before-quit', (event) => {
      if (shuttingDown) return;
      event.preventDefault();
      shuttingDown = true;
      price.stop();
      swaps.unwatch();
      Promise.allSettled([miner.shutdown(), wallets.shutdown(), node.shutdown()]).finally(() => {
        log('info', 'app', 'shut down cleanly');
        app.exit(0);
      });
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

/**
 * Hubs and pools connect through the SOCKS5 proxy themselves; this routes the
 * app's HTTPS requests (prices, pool balance) the same way. Chromium resolves
 * host names through a socks5:// proxy, so DNS does not leak either.
 */
async function applyProxy(settings: Settings): Promise<void> {
  const ses = session.defaultSession;
  const { enabled, host, port } = settings.socks5;
  try {
    await ses.setProxy(enabled ? { proxyRules: `socks5://${host}:${port}` } : { mode: 'direct' });
    await ses.closeAllConnections();
    log('info', 'app', enabled ? `HTTPS requests use the SOCKS5 proxy ${host}:${port}` : 'HTTPS requests connect directly');
  } catch (err) {
    log('error', 'app', `could not apply proxy settings: ${(err as Error).message}`);
  }
}

function hardenSessions(): void {
  const ses = session.defaultSession;
  // The renderer needs no device or web permissions at all.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  // Content-Security-Policy for every response (the HTML also carries a meta CSP).
  ses.webRequest.onHeadersReceived((details, callback) => {
    const devExtras = devServerUrl && !app.isPackaged ? " 'unsafe-inline' ws: http://localhost:*" : '';
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src 'self'${devServerUrl && !app.isPackaged ? " 'unsafe-inline'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'${devExtras}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
        ],
      },
    });
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'LBC Wallet',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b1020' : '#f5f7fb',
    autoHideMenuBar: process.platform !== 'darwin',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged || process.env.LBC_WALLET_DEVTOOLS === '1',
    },
  });

  win.once('ready-to-show', () => win.show());

  // Never navigate away from the app, never open new windows; https links go to the browser.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (devServerUrl && !app.isPackaged) void win.loadURL(devServerUrl);
  else void win.loadFile(rendererFile);
  return win;
}

/** The bundled lbcd: in the app's resources when packaged; LBC_WALLET_LBCD_BIN or resources/bin during development. */
function lbcdBinary(): string | null {
  const exe = process.platform === 'win32' ? 'lbcd.exe' : 'lbcd';
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'bin', exe)]
    : [process.env.LBC_WALLET_LBCD_BIN, join(__dirname, '../../resources/bin', `${{ darwin: 'mac', win32: 'win' }[process.platform as string] ?? process.platform}-${process.arch}`, exe)];
  return candidates.find((c): c is string => !!c && existsSync(c)) ?? null;
}

function buildMenu(language: string): void {
  const isMac = process.platform === 'darwin';
  const l = (key: string) => tr(language, `menu.${key}`);
  const repo = 'https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { label: l('file'), submenu: [isMac ? { role: 'close', label: l('close') } : { role: 'quit', label: l('quit') }] },
    {
      label: l('edit'),
      submenu: [
        { role: 'undo', label: l('undo') },
        { role: 'redo', label: l('redo') },
        { type: 'separator' },
        { role: 'cut', label: l('cut') },
        { role: 'copy', label: l('copy') },
        { role: 'paste', label: l('paste') },
        { role: 'selectAll', label: l('selectAll') },
      ],
    },
    {
      label: l('view'),
      submenu: [
        { role: 'resetZoom', label: l('resetZoom') },
        { role: 'zoomIn', label: l('zoomIn') },
        { role: 'zoomOut', label: l('zoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: l('fullscreen') },
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : []),
      ],
    },
    { label: l('window'), submenu: [{ role: 'minimize', label: l('minimize') }, ...(isMac ? [{ role: 'zoom' as const }] : [{ role: 'close' as const, label: l('close') }])] },
    {
      role: 'help',
      label: l('help'),
      submenu: [
        { label: l('manual'), click: () => void shell.openExternal(`${repo}/blob/HEAD/docs/manual/README.md`) },
        { label: l('project'), click: () => void shell.openExternal(repo) },
        { label: l('report'), click: () => void shell.openExternal(`${repo}/issues`) },
        { label: l('explorer'), click: () => void shell.openExternal('https://explorer.lbry.com') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
