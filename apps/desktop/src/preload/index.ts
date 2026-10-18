/**
 * Preload bridge: exposes a minimal, typed API as `window.lbc`. The renderer
 * runs sandboxed with context isolation and has no Node.js access.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { LbcApi, LbcEvents } from '../shared/api';

const EVENTS: (keyof LbcEvents)[] = ['wallet:changed', 'wallet:locked', 'network:status', 'miner:stats', 'miner:log', 'price:update', 'notice'];

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as { ok: true; value: T } | { ok: false; error: string };
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

let lastActivity = 0;

const api: LbcApi = {
  app: {
    info: () => call('app:info'),
    openExternal: (url) => call('app:openExternal', url),
    copy: (text, opts) => call('app:copy', text, opts),
    paste: () => call('app:paste'),
    activity: () => {
      const now = Date.now();
      if (now - lastActivity < 5000) return;
      lastActivity = now;
      ipcRenderer.send('app:activity');
    },
    quit: () => call('app:quit'),
  },
  settings: {
    get: () => call('settings:get'),
    update: (patch) => call('settings:update', patch),
  },
  wallets: {
    list: () => call('wallets:list'),
    generateMnemonic: (words) => call('wallets:generateMnemonic', words),
    checkPhrase: (phrase) => call('wallets:checkPhrase', phrase),
    suggestWords: (prefix) => call('wallets:suggestWords', prefix),
    scan: (phrase, passphrase) => call('wallets:scan', phrase, passphrase),
    create: (params) => call('wallets:create', params),
    open: (id, password) => call('wallets:open', id, password),
    lock: () => call('wallets:lock'),
    remove: (id, password) => call('wallets:remove', id, password),
    rename: (name) => call('wallets:rename', name),
    changePassword: (a, b) => call('wallets:changePassword', a, b),
    reveal: (password) => call('wallets:reveal', password),
    xpub: () => call('wallets:xpub'),
    passwordStrength: (password) => call('wallets:passwordStrength', password),
  },
  wallet: {
    overview: () => call('wallet:overview'),
    transactions: () => call('wallet:transactions'),
    transaction: (txid) => call('wallet:transaction', txid),
    addresses: () => call('wallet:addresses'),
    newAddress: () => call('wallet:newAddress'),
    setLabel: (key, label) => call('wallet:setLabel', key, label),
    validateAddress: (address) => call('wallet:validateAddress', address),
    prepareSend: (params) => call('wallet:prepareSend', params),
    prepareUnlock: () => call('wallet:prepareUnlock'),
    send: (params) => call('wallet:send', params),
    rescan: () => call('wallet:rescan'),
    exportCsv: () => call('wallet:exportCsv'),
    contacts: () => call('wallet:contacts'),
    saveContact: (c) => call('wallet:saveContact', c),
    deleteContact: (id) => call('wallet:deleteContact', id),
  },
  network: {
    status: () => call('network:status'),
    testHub: (endpoint) => call('network:testHub', endpoint),
    testNode: () => call('network:testNode'),
    reconnect: () => call('network:reconnect'),
  },
  miner: {
    status: () => call('miner:status'),
    start: () => call('miner:start'),
    stop: () => call('miner:stop'),
    logs: () => call('miner:logs'),
    estimate: () => call('miner:estimate'),
    poolBalance: () => call('miner:poolBalance'),
  },
  price: {
    get: () => call('price:get'),
  },
  on: (event, handler) => {
    if (!EVENTS.includes(event)) throw new Error(`unknown event ${String(event)}`);
    const listener = (_e: IpcRendererEvent, payload: unknown) => handler(payload as never);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
};

contextBridge.exposeInMainWorld('lbc', api);
