import { EVENT_CHANNELS, type ApiResult, type LbcApi, type LbcEvents } from './api.js';

/** An API failure with the services' translatable error code. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** How a UI reaches the services: Electron IPC on desktop, direct calls on Android. */
export interface ApiTransport {
  invoke(channel: string, args: unknown[]): Promise<ApiResult<unknown>>;
  subscribe(event: keyof LbcEvents, handler: (payload: unknown) => void): () => void;
  /** Fire-and-forget user-activity ping for the auto-lock timer. */
  activity(): void;
}

/** Builds the typed `window.lbc` API on top of a transport. */
export function createApi(transport: ApiTransport): LbcApi {
  const call = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const r = await transport.invoke(channel, args);
    if (!r.ok) throw new ApiError(r.error, r.code, r.params);
    return r.value as T;
  };
  let lastActivity = 0;
  return {
    app: {
      info: () => call('app:info'),
      openExternal: (url) => call('app:openExternal', url),
      copy: (text, opts) => call('app:copy', text, opts),
      paste: () => call('app:paste'),
      activity: () => {
        const now = Date.now();
        if (now - lastActivity < 5000) return;
        lastActivity = now;
        transport.activity();
      },
      quit: () => call('app:quit'),
      secureScreen: (on) => call('app:secureScreen', on),
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
    node: {
      status: () => call('node:status'),
      requirements: () => call('node:requirements'),
      start: () => call('node:start'),
      stop: () => call('node:stop'),
      chooseDataDir: () => call('node:chooseDataDir'),
      openDataDir: () => call('node:openDataDir'),
      logs: () => call('node:logs'),
    },
    miner: {
      status: () => call('miner:status'),
      start: () => call('miner:start'),
      stop: () => call('miner:stop'),
      logs: () => call('miner:logs'),
      estimate: () => call('miner:estimate'),
      poolBalance: () => call('miner:poolBalance'),
    },
    swap: {
      list: () => call('swap:list'),
      start: (params) => call('swap:start', params),
      inspect: (code) => call('swap:inspect', code),
      join: (params) => call('swap:join', params),
      accept: (params) => call('swap:accept', params),
      lock: (params) => call('swap:lock', params),
      cancel: (id) => call('swap:cancel', id),
      remove: (id) => call('swap:remove', id),
      btcFee: () => call('swap:btcFee'),
    },
    price: {
      get: () => call('price:get'),
    },
    on: (event, handler) => {
      if (!EVENT_CHANNELS.includes(event)) throw new Error(`unknown event ${String(event)}`);
      return transport.subscribe(event, (payload) => handler(payload as never));
    },
  };
}
