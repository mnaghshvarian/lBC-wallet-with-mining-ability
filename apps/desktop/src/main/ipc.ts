import { writeFileSync } from 'node:fs';
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { cpus } from 'node:os';
import { createCoreHandlers, invokeHandler, text, UserError, type AppInfo, type CoreServices, type Handlers } from '@lbcwallet/services';
import type { MinerService } from './miner-service';
import type { NodeService } from './node-service';
import { logger } from './log';
import { tr } from './i18n';

const log = logger('ipc');

export interface Services extends CoreServices {
  miner: MinerService;
  node: NodeService;
  isTrustedUrl: (url: string) => boolean;
}

export function appInfo(s: Services): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    kind: 'desktop',
    platform: process.platform,
    arch: process.arch,
    runtime: `Electron ${process.versions.electron} · Chrome ${process.versions.chrome?.split('.')[0]}`,
    dataDir: app.getPath('userData'),
    cpuCount: cpus().length,
    isPackaged: app.isPackaged,
    capabilities: { mining: true, soloMining: true, idleMining: true, node: s.node.available, ownNode: true, proxy: true },
  };
}

/** Desktop-only API channels: OS integration, the miner and the built-in node. */
function desktopHandlers(s: Services, getWindow: () => BrowserWindow | null): Handlers {
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    'app:info': () => appInfo(s),
    'app:openExternal': async (url: unknown) => {
      const u = new URL(text(url, 'url', 2000));
      if (u.protocol !== 'https:') throw new UserError('onlyHttps');
      await shell.openExternal(u.toString());
    },
    'app:copy': (value: unknown, opts?: unknown) => {
      const v = text(value, 'text', 5000);
      clipboard.writeText(v);
      if (clearTimer) clearTimeout(clearTimer);
      if ((opts as { sensitive?: boolean } | undefined)?.sensitive) {
        // Clear sensitive data from the clipboard after 30 seconds.
        clearTimer = setTimeout(() => {
          void Promise.resolve(clipboard.readText()).then((current) => {
            if (current === v) clipboard.clear();
          });
        }, 30_000);
      }
    },
    'app:paste': async () => (await Promise.resolve(clipboard.readText())).trim().slice(0, 5000),
    'app:quit': () => app.quit(),
    // Secret screens: Windows and macOS leave the window out of screenshots and screen sharing.
    'app:secureScreen': (on: unknown) => {
      getWindow()?.setContentProtection(on === true);
    },

    'wallet:exportCsv': async () => {
      const csv = s.wallets.exportCsv();
      const win = getWindow();
      const opts = {
        title: tr(s.settings.get().language, 'dialog.exportTitle'),
        defaultPath: `lbc-transactions-${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return { saved: false };
      writeFileSync(r.filePath, csv, { mode: 0o600 });
      return { saved: true, path: r.filePath };
    },

    'miner:status': () => s.miner.status(),
    'miner:start': () => s.miner.start(),
    'miner:stop': () => s.miner.stop(),
    'miner:logs': () => s.miner.getLogs(),
    'miner:estimate': () => s.miner.estimate(),
    'miner:poolBalance': () => s.miningInfo.poolBalance(s.miner.payoutInUse()),

    'node:status': () => s.node.status(),
    'node:requirements': () => s.node.requirements(),
    'node:start': () => s.node.start(),
    'node:stop': () => s.node.stop(),
    'node:chooseDataDir': async () => {
      const win = getWindow();
      const opts = {
        title: tr(s.settings.get().language, 'dialog.chooseNodeFolder'),
        defaultPath: s.node.status().dataDir,
        properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
      };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (r.canceled || !r.filePaths[0]) return null;
      return s.node.setDataDir(r.filePaths[0]);
    },
    'node:openDataDir': async () => {
      await shell.openPath(s.node.status().dataDir);
    },
    'node:logs': () => s.node.logs(),
  };
}

export function registerIpc(s: Services, getWindow: () => BrowserWindow | null): void {
  const handlers: Handlers = { ...createCoreHandlers(s), ...desktopHandlers(s, getWindow) };
  for (const channel of Object.keys(handlers)) {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!event.senderFrame || !s.isTrustedUrl(event.senderFrame.url)) {
        log('warn', `rejected IPC ${channel} from untrusted frame`);
        return { ok: false, error: 'Untrusted sender', code: 'untrustedSender' };
      }
      return invokeHandler(handlers, channel, args, (m) => log('warn', m));
    });
  }
  ipcMain.on('app:activity', (event) => {
    if (event.senderFrame && s.isTrustedUrl(event.senderFrame.url)) s.wallets.touch();
  });
}
