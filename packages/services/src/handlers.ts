import { getNetwork, probeHub, WrongPasswordError } from '@lbcwallet/core';
import type { ApiResult, CreateSource, HubEndpoint, HubTestResult, Settings } from './api.js';
import { lbcdRpc, transportFactory } from './backend.js';
import { describeError, UserError } from './errors.js';
import type { MiningInfo } from './mining-info.js';
import type { Platform } from './platform.js';
import type { PriceService } from './price-service.js';
import type { SettingsStore } from './settings.js';
import type { MarketService } from './market-service.js';
import type { SwapService } from './swap-service.js';
import type { WalletService } from './wallet-service.js';

/** One API channel: validates its untrusted arguments, then does the work. */
export type Handler = (...args: unknown[]) => unknown;
export type Handlers = Record<string, Handler>;

export function text(v: unknown, field: string, max = 10_000): string {
  if (typeof v !== 'string') throw new UserError('fieldNotText', { field });
  if (v.length > max) throw new UserError('fieldTooLong', { field });
  return v;
}

export function number(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new UserError('fieldNotNumber', { field });
  return v;
}

export interface CoreServices {
  platform: Platform;
  settings: SettingsStore;
  wallets: WalletService;
  price: PriceService;
  miningInfo: MiningInfo;
  swaps: SwapService;
  market: MarketService;
}

/** An amount in the smallest unit, as a decimal string. */
function units(v: unknown, field: string): string {
  const t = text(v, field, 20);
  if (!/^\d{1,18}$/.test(t)) throw new UserError('invalidAmount');
  return t;
}

function swapId(v: unknown): string {
  const id = text(v, 'id', 16);
  if (!/^[0-9a-f]{16}$/.test(id)) throw new UserError('swapUnknown');
  return id;
}

function marketId(v: unknown, code: 'marketOfferGone' | 'marketUnknownTrade'): string {
  const id = text(v, 'id', 16);
  if (!/^[0-9a-f]{16}$/.test(id)) throw new UserError(code);
  return id;
}

function coin(v: unknown): 'LBC' | 'BTC' {
  if (v !== 'LBC' && v !== 'BTC') throw new UserError('invalidAmount');
  return v;
}

/** Handlers for everything that works the same on every platform. */
export function createCoreHandlers(s: CoreServices): Handlers {
  return {
    // ---------------------------------------------------------------- settings
    'settings:get': () => s.settings.get(),
    'settings:update': (patch: unknown) => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new UserError('invalidSettings');
      const prev = s.settings.get();
      const next = s.settings.update(patch as Partial<Settings>);
      if (next.network !== prev.network) void s.wallets.lock('manual');
      return next;
    },

    // ---------------------------------------------------------------- wallets
    'wallets:list': () => s.wallets.list(),
    'wallets:generateMnemonic': (words: unknown) => s.wallets.generateMnemonic(words === 24 ? 24 : 12),
    'wallets:checkPhrase': (phrase: unknown) => s.wallets.checkPhrase(text(phrase, 'phrase', 1000)),
    'wallets:suggestWords': (prefix: unknown) => s.wallets.suggestWords(text(prefix, 'prefix', 20)),
    'wallets:scan': (phrase: unknown, passphrase?: unknown) =>
      s.wallets.scan(text(phrase, 'phrase', 1000), passphrase === undefined || passphrase === null ? undefined : text(passphrase, 'passphrase', 500)),
    'wallets:create': (params: unknown) => {
      const p = (params ?? {}) as { name?: unknown; password?: unknown; source?: CreateSource };
      const source = p.source;
      if (!source || typeof source !== 'object') throw new UserError('missingSource');
      let clean: CreateSource;
      if (source.type === 'mnemonic') {
        clean = {
          type: 'mnemonic',
          mnemonic: text(source.mnemonic, 'recovery phrase', 1000),
          passphrase: source.passphrase ? text(source.passphrase, 'passphrase', 500) : undefined,
          scheme: source.scheme === 'lbry' ? 'lbry' : 'bip44',
        };
      } else if (source.type === 'xprv') clean = { type: 'xprv', xprv: text(source.xprv, 'extended private key', 200) };
      else if (source.type === 'watch') clean = { type: 'watch', xpub: text(source.xpub, 'extended public key', 200) };
      else throw new UserError('unknownWalletType');
      return s.wallets.create({ name: text(p.name, 'name', 64), password: text(p.password, 'password', 1000), source: clean });
    },
    'wallets:open': (id: unknown, password: unknown) => s.wallets.open(text(id, 'id', 64), text(password, 'password', 1000)),
    'wallets:lock': () => s.wallets.lock('manual'),
    'wallets:remove': (id: unknown, password: unknown) => s.wallets.remove(text(id, 'id', 64), text(password, 'password', 1000)),
    'wallets:rename': (name: unknown) => s.wallets.rename(text(name, 'name', 64)),
    'wallets:changePassword': (a: unknown, b: unknown) => s.wallets.changePassword(text(a, 'password', 1000), text(b, 'password', 1000)),
    'wallets:reveal': (password: unknown) => s.wallets.reveal(text(password, 'password', 1000)),
    'wallets:xpub': () => s.wallets.xpub(),
    'wallets:passwordStrength': (password: unknown) => s.wallets.passwordStrength(text(password, 'password', 1000)),

    // ---------------------------------------------------------------- open wallet
    'wallet:overview': () => s.wallets.overview(),
    'wallet:transactions': () => s.wallets.transactions(),
    'wallet:transaction': (txid: unknown) => s.wallets.transaction(text(txid, 'txid', 64)),
    'wallet:addresses': () => s.wallets.addresses(),
    'wallet:newAddress': () => s.wallets.newAddress(),
    'wallet:setLabel': (key: unknown, label: unknown) => s.wallets.setLabel(text(key, 'key', 100), text(label, 'label', 200)),
    'wallet:validateAddress': (address: unknown) => s.wallets.validateAddress(text(address, 'address', 200)),
    'wallet:prepareSend': (params: unknown) => {
      const p = (params ?? {}) as { address?: unknown; amount?: unknown; feePerByte?: unknown };
      const amount = p.amount === 'max' ? 'max' : text(p.amount, 'amount', 30);
      if (amount !== 'max' && !/^\d+$/.test(amount)) throw new UserError('invalidAmount');
      return s.wallets.prepareSend({
        address: text(p.address, 'address', 200),
        amount,
        feePerByte: p.feePerByte === undefined ? undefined : number(p.feePerByte, 'fee rate'),
      });
    },
    'wallet:prepareUnlock': () => s.wallets.prepareUnlock(),
    'wallet:send': (params: unknown) => {
      const p = (params ?? {}) as { draftId?: unknown; password?: unknown; label?: unknown };
      return s.wallets.send({
        draftId: text(p.draftId, 'draft', 32),
        password: p.password === undefined ? undefined : text(p.password, 'password', 1000),
        label: p.label === undefined ? undefined : text(p.label, 'label', 200),
      });
    },
    'wallet:rescan': () => s.wallets.rescan(),
    'wallet:contacts': () => s.wallets.contacts(),
    'wallet:saveContact': (c: unknown) => {
      const x = (c ?? {}) as { id?: unknown; name?: unknown; address?: unknown; note?: unknown };
      return s.wallets.saveContact({
        id: x.id === undefined ? undefined : text(x.id, 'id', 64),
        name: text(x.name, 'name', 80),
        address: text(x.address, 'address', 200),
        note: x.note === undefined ? undefined : text(x.note, 'note', 500),
      });
    },
    'wallet:deleteContact': (id: unknown) => s.wallets.deleteContact(text(id, 'id', 64)),

    // ---------------------------------------------------------------- network
    'network:status': () => s.wallets.overview()?.backend ?? { connected: false, kind: s.settings.get().backendMode === 'lbcd' ? 'lbcd' : 'hub' },
    'network:testHub': async (endpoint: unknown): Promise<HubTestResult> => {
      const e = (endpoint ?? {}) as HubEndpoint;
      const host = text(e.host, 'host', 253).trim();
      const port = number(e.port, 'port');
      const settings = s.settings.get();
      const r = await probeHub({ host, port, tls: !!e.tls }, transportFactory(settings, s.platform), getNetwork(settings.network), s.platform.clientName);
      return r.ok ? { ok: true, latencyMs: r.latencyMs, height: r.height, version: r.version } : { ok: false, error: describeError(new Error(r.error)).message };
    },
    'network:testNode': async (): Promise<HubTestResult> => {
      const settings = s.settings.get();
      const started = Date.now();
      try {
        const rpc = lbcdRpc(settings, s.platform);
        const info = await rpc.call<{ chain: string; blocks: number }>('getblockchaininfo');
        const expected = settings.network === 'mainnet' ? 'mainnet' : settings.network === 'testnet' ? 'testnet3' : 'regtest';
        if (info.chain !== expected && !(expected === 'mainnet' && info.chain === 'main')) {
          return { ok: false, error: new UserError('nodeWrongChain', { chain: info.chain, expected }).message };
        }
        try {
          const probe = settings.network === 'mainnet' ? 'bCqJrLHdoiRqEZ1whFZ3WHNb33bP34SuGx' : 'mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn';
          await rpc.call('searchrawtransactions', [probe, 0, 0, 1]);
        } catch (err) {
          if (/addrindex|address index/i.test((err as Error).message)) return { ok: false, error: new UserError('nodeNeedsIndexes').message };
        }
        return { ok: true, latencyMs: Date.now() - started, height: info.blocks, version: 'lbcd' };
      } catch (err) {
        return { ok: false, error: describeError(err).message };
      }
    },
    'network:reconnect': () => s.wallets.reconnect(),

    // ---------------------------------------------------------------- price
    'price:get': () => s.price.get(),

    // ---------------------------------------------------------------- swaps
    'swap:list': () => s.swaps.list(),
    'swap:start': (params: unknown) => {
      const p = (params ?? {}) as Record<string, unknown>;
      if (p.give !== 'LBC' && p.give !== 'BTC') throw new UserError('invalidAmount');
      return s.swaps.start({ give: p.give, lbc: units(p.lbc, 'lbc'), btc: units(p.btc, 'btc'), btcAddress: text(p.btcAddress, 'btcAddress', 100) });
    },
    'swap:inspect': (code: unknown) => s.swaps.inspect(text(code, 'code', 2000)),
    'swap:join': (params: unknown) => {
      const p = (params ?? {}) as Record<string, unknown>;
      return s.swaps.join({ code: text(p.code, 'code', 2000), btcAddress: text(p.btcAddress, 'btcAddress', 100) });
    },
    'swap:accept': (params: unknown) => s.swaps.accept({ code: text(((params ?? {}) as Record<string, unknown>).code, 'code', 2000) }),
    'swap:lock': (params: unknown) => {
      const p = (params ?? {}) as Record<string, unknown>;
      return s.swaps.lock({ id: swapId(p.id), password: p.password === undefined ? undefined : text(p.password, 'password', 1000) });
    },
    'swap:cancel': (id: unknown) => s.swaps.cancel(swapId(id)),
    'swap:remove': (id: unknown) => s.swaps.remove(swapId(id)),
    'swap:btcFee': () => s.swaps.btcFee(),

    // ---------------------------------------------------------------- order board
    'market:view': () => s.market.view(),
    'market:post': (params: unknown) => {
      const p = (params ?? {}) as Record<string, unknown>;
      return s.market.post({ give: coin(p.give), lbc: units(p.lbc, 'lbc'), btc: units(p.btc, 'btc'), min: units(p.min, 'min'), btcAddress: text(p.btcAddress, 'btcAddress', 100) });
    },
    'market:withdraw': (id: unknown) => s.market.withdraw(marketId(id, 'marketOfferGone')),
    'market:take': (params: unknown) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const key = text(p.key, 'key', 81);
      if (!/^[0-9a-f]{64}:[0-9a-f]{16}$/.test(key)) throw new UserError('marketOfferGone');
      return s.market.take({ key, lbc: units(p.lbc, 'lbc'), btcAddress: text(p.btcAddress, 'btcAddress', 100) });
    },
    'market:dismiss': (id: unknown) => s.market.dismiss(marketId(id, 'marketUnknownTrade')),
  };
}

/**
 * Runs a handler and packs the outcome for the UI: values as they are, errors
 * as safe messages with translatable codes. Unexpected errors are logged.
 */
export async function invokeHandler(handlers: Handlers, channel: string, args: unknown[], log: (message: string) => void): Promise<ApiResult<unknown>> {
  const fn = handlers[channel];
  if (!fn) return { ok: false, error: `Unknown request ${channel}` };
  try {
    return { ok: true, value: await fn(...args) };
  } catch (err) {
    if (!(err instanceof UserError) && !(err instanceof WrongPasswordError)) log(`${channel}: ${(err as Error)?.stack ?? String(err)}`);
    const info = describeError(err);
    return { ok: false, error: info.message, code: info.code, params: info.params };
  }
}
