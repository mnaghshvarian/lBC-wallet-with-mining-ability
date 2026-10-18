/**
 * Preload bridge: exposes a minimal, typed API as `window.lbc`. The renderer
 * runs sandboxed with context isolation and has no Node.js access; every call
 * goes over IPC to the main process, which validates it.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { createApi } from '@lbcwallet/services/client';
import type { ApiResult } from '@lbcwallet/services/api';

const api = createApi({
  invoke: (channel, args) => ipcRenderer.invoke(channel, ...args) as Promise<ApiResult<unknown>>,
  subscribe: (event, handler) => {
    const listener = (_e: IpcRendererEvent, payload: unknown) => handler(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
  activity: () => ipcRenderer.send('app:activity'),
});

contextBridge.exposeInMainWorld('lbc', api);
