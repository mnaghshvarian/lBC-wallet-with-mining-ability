import {
  OFFER_RENEW,
  RelayPool,
  TaskQueue,
  btcForLbc,
  createWebSocket,
  fromHex,
  messageEvent,
  messageFilter,
  newNostrSecret,
  nostrPublicKey,
  offerEvent,
  offerFilter,
  otherCoin,
  parseMessage,
  parseOffer,
  randomBytes,
  satsPerLbc,
  tagValue,
  takeFits,
  toHex,
  type DeclineReason,
  type MarketMessage,
  type MarketOffer,
  type MarketOfferRecord,
  type MarketState,
  type MarketTradeRecord,
  type NetworkName,
  type NostrEvent,
  type OfferTerms,
  type SwapCoin,
  type WebSocketFactory,
} from '@lbcwallet/core';
import { DEFAULT_RELAYS, MARKET_TERMS_VERSION, type MarketOfferView, type MarketPriceView, type MarketTradeView, type MarketView, type MyOfferView, type NoticeView, type SwapView } from './api.js';
import { UserError } from './errors.js';
import { fetchMarketPrice } from './market-price.js';
import type { SettingsStore } from './settings.js';
import { scopedLogger, type Logger, type Platform } from './platform.js';
import { MAX_SWAP_BTC, MIN_SWAP_BTC, MIN_SWAP_LBC, checkBtcAddress, checkSwapAmounts, type SwapService } from './swap-service.js';

/** How long each side waits for the other, in seconds. Tests shorten them. */
export interface MarketTiming {
  /** The taker waits this long for the maker's wallet to answer a take. */
  inviteWait: number;
  /** The taker must lock within this long of the answer. */
  lockWithin: number;
  /** The maker gives up on a taker who has not locked after this long. */
  makerWait: number;
  /** Older takes are ignored (their takers have given up). */
  takeMaxAge: number;
}

export const MARKET_TIMING: MarketTiming = { inviteWait: 10 * 60, lockWithin: 20 * 60, makerWait: 40 * 60, takeMaxAge: 10 * 60 };

/** What the market needs from the open wallet. */
export interface MarketWallet {
  network: NetworkName;
  watchOnly: boolean;
  state(): MarketState;
  save(state: MarketState): void;
  /** LBC the wallet can spend now (dewies). */
  spendable(): bigint;
}

export interface MarketServiceDeps {
  wallet: () => MarketWallet | null;
  swaps: SwapService;
  changed: (view: MarketView) => void;
  notice: (n: NoticeView) => void;
  /** Relay connections; tests pass their own. Default: WebSockets over the platform's sockets. */
  webSocket?: WebSocketFactory;
  /** Reference prices; tests pass their own. */
  price?: () => Promise<MarketPriceView>;
  now?: () => number;
  timing?: MarketTiming;
}

const TICK_MS = 15_000;
/** The board stays connected this long after the Market screen last asked for it. */
const BOARD_KEEP_MS = 5 * 60_000;
const PRICE_REFRESH_MS = 5 * 60_000;
const MAX_OPEN_OFFERS = 5;
/** Takes of one offer waiting for their takers to lock. */
const MAX_INVITED = 3;
const MAX_BOARD = 300;
/** Finished trades and closed offers are forgotten after 30 days. */
const KEEP_MS = 30 * 24 * 3600_000;
/** LBC kept aside for the network fee of each lock. */
const LOCK_FEE_MARGIN = 1_000_000n;

const ACTIVE: MarketTradeRecord['status'][] = ['waiting', 'invited', 'swapping'];
const SWAP_ENDED = ['completed', 'refunded', 'cancelled', 'failed'];
const LOCK_SENT_STAGES = ['send-lock', 'checking', 'claiming'];
/** A taker's lock may show up this long after its deadline (a payment sent just in time). */
const LOCK_GRACE = 5 * 60;

function termsOf(o: MarketOfferRecord): OfferTerms {
  const left = BigInt(o.left);
  const min = BigInt(o.min);
  // An offer with less left than its smallest part cannot be taken: it is shown as closed.
  if (o.status === 'closed' || left < min) return { network: o.network, give: o.give, lbc: BigInt(o.lbc), btc: BigInt(o.btc), min: 1n, left: left > 0n ? left : 0n, status: 'closed' };
  return { network: o.network, give: o.give, lbc: BigInt(o.lbc), btc: BigInt(o.btc), min, left, status: 'open' };
}

/**
 * The order board (core/market/protocol.ts): this wallet's offers are
 * published to Nostr relays, other people's are read from them, and a taken
 * offer becomes an atomic swap run by the swap service — the trade messages
 * carry the swap codes, so nobody copies codes by hand. Offers are answered
 * only while the wallet that posted them is open.
 */
export class MarketService {
  private readonly log: Logger;
  private readonly queue = new TaskQueue();
  private pool: RelayPool | null = null;
  private boardUntil = 0;
  private boardSub: { network: NetworkName; close: () => void } | null = null;
  private messageSub: { keys: string; close: () => void } | null = null;
  private readonly board = new Map<string, MarketOffer>();
  private loaded = false;
  private price: MarketPriceView | null = null;
  private priceAt = 0;
  private priceFailed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private changedTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly offerRelays = new Map<string, number>();
  private readonly publishing = new Set<string>();
  private readonly pubkeys = new Map<string, string>();
  /** Takes answered with a decline (they leave no record). */
  private readonly declined = new Set<string>();
  /** Open offers of the wallet last seen open, to take them down when it locks or another opens. */
  private lastOpen: { state: MarketState; offers: MarketOfferRecord[] } | null = null;

  constructor(
    private readonly platform: Platform,
    private readonly settings: SettingsStore,
    private readonly deps: MarketServiceDeps,
  ) {
    this.log = scopedLogger(platform, 'market');
    settings.onChange((next, prev) => {
      const moved = next.network !== prev.network || JSON.stringify(next.market) !== JSON.stringify(prev.market) || JSON.stringify(next.socks5) !== JSON.stringify(prev.socks5);
      if (moved) void this.queue.run(async () => this.closePool());
    });
  }

  private get timing(): MarketTiming {
    return this.deps.timing ?? MARKET_TIMING;
  }

  private nowMs(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private nowSec(): number {
    return Math.floor(this.nowMs() / 1000);
  }

  private pubkey(secretHex: string): string {
    let p = this.pubkeys.get(secretHex);
    if (!p) {
      p = nostrPublicKey(fromHex(secretHex));
      this.pubkeys.set(secretHex, p);
    }
    return p;
  }

  private relayList(): string[] {
    const custom = this.settings.get().market.relays;
    return custom.length ? custom : DEFAULT_RELAYS;
  }

  private webSocket(): WebSocketFactory {
    if (this.deps.webSocket) return this.deps.webSocket;
    const open = this.platform.byteTransport?.bind(this.platform);
    if (!open) throw new UserError('marketUnsupported');
    const s = this.settings.get();
    const socks5 = s.socks5.enabled ? { host: s.socks5.host, port: s.socks5.port } : undefined;
    const timeout = socks5 ? 30_000 : 10_000;
    return (url) => createWebSocket(url, (endpoint) => open(endpoint, { socks5, connectTimeoutMs: timeout }), { handshakeTimeoutMs: timeout + 5_000 });
  }

  // ---------------------------------------------------------------- lifecycle

  /** Runs the market every 15 seconds while it has something to do. */
  watch(): void {
    this.timer ??= setInterval(() => void this.tick(), TICK_MS);
  }

  unwatch(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.queue.run(async () => this.closePool());
  }

  /** One round: connect or disconnect, renew offers, move trades along. */
  tick(): Promise<void> {
    return this.queue.run(() => this.round()).catch((err: Error) => this.log('warn', `round failed: ${err.message}`));
  }

  /** A swap moved: forward lock codes and finish trades without waiting for the next round. */
  swapChanged(view: SwapView): void {
    const w = this.deps.wallet();
    if (w && w.state().trades.some((t) => t.swapId === view.id)) void this.tick();
  }

  private closePool(): void {
    this.boardSub?.close();
    this.boardSub = null;
    this.messageSub?.close();
    this.messageSub = null;
    this.pool?.close();
    this.pool = null;
    this.board.clear();
    this.loaded = false;
    this.offerRelays.clear();
    this.scheduleChanged();
  }

  private ensurePool(): RelayPool {
    if (!this.pool) {
      this.pool = new RelayPool(this.webSocket(), this.relayList(), { log: (level, message) => this.log(level, message) });
      this.pool.on('status', () => this.scheduleChanged());
    }
    return this.pool;
  }

  private async round(): Promise<void> {
    const w = this.deps.wallet();
    const watching = this.nowMs() < this.boardUntil;
    if (!w) {
      await this.walletGone();
      if (!watching) this.closePool();
      return;
    }
    const state = w.state();
    if (this.lastOpen && this.lastOpen.state !== state) await this.walletGone();
    const before = JSON.stringify(state);
    const busy = state.offers.some((o) => o.status === 'open') || state.trades.some((t) => ACTIVE.includes(t.status) || !!t.outbox);
    if (!watching && !busy) {
      this.lastOpen = null;
      if (this.pool) this.closePool();
      return;
    }
    let pool: RelayPool;
    try {
      pool = this.ensurePool();
    } catch (err) {
      this.log('warn', (err as Error).message);
      return;
    }
    if (watching) this.subscribeBoard(pool, w.network);
    else if (this.boardSub) {
      this.boardSub.close();
      this.boardSub = null;
      this.board.clear();
      this.loaded = false;
    }
    if (watching && this.nowMs() - this.priceAt > PRICE_REFRESH_MS) this.refreshPrice();

    await this.advanceTrades(state);
    this.prune(state);
    if (JSON.stringify(state) !== before) w.save(state);
    this.subscribeMessages(pool, state);
    this.renewOffers(state);
    this.resend(state);
    this.lastOpen = { state, offers: state.offers.filter((o) => o.status === 'open').map((o) => ({ ...o })) };
    this.pruneBoard();
    this.scheduleChanged();
  }

  /** The wallet locked: take its open offers down (they could not be answered). */
  private async walletGone(): Promise<void> {
    const last = this.lastOpen;
    this.lastOpen = null;
    if (!last || !this.pool || last.offers.length === 0) return;
    const pool = this.pool;
    for (const o of last.offers) this.offerRelays.delete(o.id);
    await Promise.all(
      last.offers.map(async (o) => {
        const closed = { ...o, status: 'closed' as const };
        const e = await offerEvent(o.id, termsOf(closed), fromHex(o.secret), Math.max(this.nowSec(), o.publishedAt + 1));
        await pool.publish(e);
      }),
    ).catch((err: Error) => this.log('warn', `could not take offers down: ${err.message}`));
    this.messageSub?.close();
    this.messageSub = null;
  }

  private refreshPrice(): void {
    this.priceAt = this.nowMs();
    (this.deps.price ?? (() => fetchMarketPrice(this.platform)))().then(
      (p) => {
        this.price = p;
        this.priceFailed = false;
        this.scheduleChanged();
      },
      (err: Error) => {
        this.log('warn', `reference price: ${err.message}`);
        this.priceFailed = true;
        this.scheduleChanged();
      },
    );
  }

  // ---------------------------------------------------------------- subscriptions

  private subscribeBoard(pool: RelayPool, network: NetworkName): void {
    if (this.boardSub?.network === network) return;
    this.boardSub?.close();
    this.board.clear();
    this.loaded = false;
    const close = pool.subscribe(
      [offerFilter(network, this.nowSec())],
      (e) => this.onOfferEvent(e, network),
      () => {
        this.loaded = true;
        this.scheduleChanged();
      },
    );
    this.boardSub = { network, close };
  }

  private onOfferEvent(e: NostrEvent, network: NetworkName): void {
    const offer = parseOffer(e, this.nowSec());
    if (!offer || offer.network !== network) return;
    const key = `${offer.pubkey}:${offer.id}`;
    const known = this.board.get(key);
    // Relays may send older versions after newer ones: the newest wins (a closed one too).
    if (known && known.createdAt >= offer.createdAt) return;
    this.board.set(key, offer);
    if (this.board.size > MAX_BOARD) this.pruneBoard();
    this.scheduleChanged();
  }

  private pruneBoard(): void {
    const now = this.nowSec();
    for (const [key, o] of this.board) if (o.expiresAt <= now) this.board.delete(key);
    if (this.board.size <= MAX_BOARD) return;
    const oldest = [...this.board.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [key] of oldest.slice(0, this.board.size - MAX_BOARD)) this.board.delete(key);
  }

  private subscribeMessages(pool: RelayPool, state: MarketState): void {
    const keys = new Set<string>();
    for (const o of state.offers) if (o.status === 'open') keys.add(this.pubkey(o.secret));
    for (const t of state.trades) if (ACTIVE.includes(t.status)) keys.add(this.pubkey(t.secret));
    const list = [...keys].sort();
    const id = list.join(',');
    if (this.messageSub?.keys === id) return;
    this.messageSub?.close();
    this.messageSub = null;
    if (list.length === 0) return;
    const close = pool.subscribe([messageFilter(list, this.nowSec())], (e) => void this.queue.run(() => this.onMessage(e)).catch((err: Error) => this.log('warn', `message: ${err.message}`)));
    this.messageSub = { keys: id, close };
  }

  // ---------------------------------------------------------------- sending

  /** Signs a message of a trade and sends it until a relay takes it. */
  private async send(state: MarketState, trade: MarketTradeRecord, m: MarketMessage): Promise<void> {
    const createdAt = Math.max(this.nowSec(), trade.sentAt + 1);
    trade.outbox = await messageEvent(m, fromHex(trade.secret), trade.peer, createdAt);
    trade.sentAt = createdAt;
    trade.updatedAt = Date.now();
    this.deliver(trade.id, trade.outbox);
  }

  private resend(state: MarketState): void {
    for (const t of state.trades) if (t.outbox) this.deliver(t.id, t.outbox);
  }

  private deliver(tradeId: string, event: NostrEvent): void {
    const pool = this.pool;
    if (!pool || this.publishing.has(event.id)) return;
    this.publishing.add(event.id);
    pool
      .publish(event)
      .then((results) => {
        if (!results.some((r) => r.ok)) {
          this.log('warn', `trade ${tradeId}: no relay took the message (${results.map((r) => r.message ?? '').join('; ')})`);
          return;
        }
        return this.queue.run(async () => {
          const w = this.deps.wallet();
          if (!w) return;
          const state = w.state();
          const t = state.trades.find((x) => x.id === tradeId);
          if (t?.outbox?.id !== event.id) return;
          delete t.outbox;
          w.save(state);
          this.scheduleChanged();
        });
      })
      .catch((err: Error) => this.log('warn', `trade ${tradeId}: ${err.message}`))
      .finally(() => this.publishing.delete(event.id));
  }

  private renewOffers(state: MarketState): void {
    const now = this.nowSec();
    for (const o of state.offers) {
      if (o.status === 'open' && (now - o.publishedAt >= OFFER_RENEW || !this.offerRelays.has(o.id))) this.publishOffer(o);
    }
  }

  /** Publishes the current version of an offer (signed with fresh proof of work). */
  private publishOffer(o: MarketOfferRecord): void {
    const pool = this.pool;
    if (!pool) return;
    const createdAt = Math.max(this.nowSec(), o.publishedAt + 1);
    o.publishedAt = createdAt;
    const terms = termsOf(o);
    this.offerRelays.set(o.id, this.offerRelays.get(o.id) ?? 0);
    void offerEvent(o.id, terms, fromHex(o.secret), createdAt)
      .then((e) => {
        if (this.boardSub?.network === terms.network) this.onOfferEvent(e, terms.network);
        return pool.publish(e);
      })
      .then((results) => {
        const ok = results.filter((r) => r.ok).length;
        this.offerRelays.set(o.id, ok);
        if (!ok) this.log('warn', `offer ${o.id}: no relay took it (${results.map((r) => r.message ?? '').join('; ')})`);
        this.scheduleChanged();
      })
      .catch((err: Error) => this.log('warn', `offer ${o.id}: ${err.message}`));
  }

  // ---------------------------------------------------------------- incoming messages

  private async onMessage(e: NostrEvent): Promise<void> {
    const w = this.deps.wallet();
    if (!w) return;
    const state = w.state();
    const to = tagValue(e, 'p');
    const now = this.nowSec();
    const offer = state.offers.find((o) => this.pubkey(o.secret) === to);
    if (offer) {
      const m = parseMessage(e, fromHex(offer.secret), now);
      if (!m) return;
      if (m.type === 'take') await this.onTake(w, state, offer, e, m);
      else if (m.type === 'lock') {
        const trade = state.trades.find((t) => t.role === 'maker' && t.id === m.trade && t.peer === e.pubkey);
        if (trade) this.onLock(trade, m.code);
      }
      w.save(state);
      this.scheduleChanged();
      return;
    }
    const trade = state.trades.find((t) => t.role === 'taker' && this.pubkey(t.secret) === to);
    // Only the key of the offer that was taken can answer a take.
    if (!trade || e.pubkey !== trade.peer) return;
    const m = parseMessage(e, fromHex(trade.secret), now);
    if (!m || m.trade !== trade.id) return;
    if (m.type === 'invite') this.onInvite(trade, m.code);
    else if (m.type === 'decline') this.onDecline(trade, m.reason);
    else if (m.type === 'lock') this.onLock(trade, m.code);
    w.save(state);
    this.scheduleChanged();
  }

  /** Someone took one of our offers: start the swap and send them its invite. */
  private async onTake(w: MarketWallet, state: MarketState, offer: MarketOfferRecord, e: NostrEvent, m: Extract<MarketMessage, { type: 'take' }>): Promise<void> {
    if (m.offer !== offer.id || state.trades.some((t) => t.id === m.trade) || this.declined.has(m.trade)) return;
    if (this.nowSec() - e.created_at > this.timing.takeMaxAge) return;
    const decline = async (reason: DeclineReason) => {
      this.declined.add(m.trade);
      const answer: MarketTradeRecord = this.newTrade({ id: m.trade, role: 'maker', offerId: offer.id, secret: offer.secret, peer: e.pubkey, network: w.network, give: offer.give, lbc: m.lbc, btc: m.btc });
      await this.send(state, answer, { type: 'decline', trade: m.trade, reason });
      this.log('info', `offer ${offer.id}: declined a take (${reason})`);
    };
    const terms = termsOf(offer);
    if (terms.status !== 'open') return decline('closed');
    const waiting = state.trades.filter((t) => t.offerId === offer.id && t.role === 'maker' && t.status === 'invited').length;
    if (waiting >= MAX_INVITED) return decline('taken');
    if (!takeFits(terms, m.lbc)) return decline('amount');
    if (m.btc !== btcForLbc(terms, m.lbc)) return decline('price');
    try {
      checkSwapAmounts(w.network, m.lbc, m.btc);
    } catch {
      return decline('amount');
    }
    if (offer.give === 'LBC' && w.spendable() < m.lbc + this.lbcReserved(state) + LOCK_FEE_MARGIN) {
      offer.status = 'closed';
      this.publishOffer(offer);
      return decline('closed');
    }
    const swap = this.deps.swaps.start({ give: offer.give, lbc: m.lbc.toString(), btc: m.btc.toString(), btcAddress: offer.btcAddress });
    const trade = this.newTrade({ id: m.trade, role: 'maker', offerId: offer.id, secret: offer.secret, peer: e.pubkey, network: w.network, give: offer.give, lbc: m.lbc, btc: m.btc });
    trade.swapId = swap.id;
    trade.status = 'invited';
    state.trades.push(trade);
    offer.left = (BigInt(offer.left) - m.lbc).toString();
    await this.send(state, trade, { type: 'invite', trade: trade.id, code: swap.code! });
    this.publishOffer(offer);
    this.log('info', `offer ${offer.id}: taken (${m.lbc} dewies), swap ${swap.id}`);
    this.deps.notice({ kind: 'swap', code: 'marketTaken', params: { lbc: m.lbc.toString() } });
  }

  /** LBC promised to running trades whose LBC is not locked yet. */
  private lbcReserved(state: MarketState): bigint {
    const swaps = new Map(this.deps.swaps.list().map((v) => [v.id, v]));
    let sum = 0n;
    for (const t of state.trades) {
      if (t.give !== 'LBC' || !ACTIVE.includes(t.status)) continue;
      const v = t.swapId ? swaps.get(t.swapId) : undefined;
      if (!v?.ours?.txid) sum += BigInt(t.lbc);
    }
    return sum;
  }

  /** The maker's answer: join the swap if it is exactly what we took. */
  private onInvite(trade: MarketTradeRecord, code: string): void {
    if (trade.status !== 'waiting') return;
    try {
      const info = this.deps.swaps.inspect(code);
      if (info.type !== 'invite' || info.youGive !== trade.give || info.lbc !== trade.lbc || info.btc !== trade.btc) {
        trade.status = 'declined';
        trade.reason = 'price';
        this.log('warn', `trade ${trade.id}: the answer does not match the take`);
        return;
      }
      const swap = this.deps.swaps.join({ code, btcAddress: trade.btcAddress!, lockBy: this.nowSec() + this.timing.lockWithin });
      trade.swapId = swap.id;
      trade.status = 'swapping';
      trade.updatedAt = Date.now();
      this.log('info', `trade ${trade.id}: accepted, swap ${swap.id}`);
      this.deps.notice({ kind: 'swap', code: 'marketAccepted', params: { coin: trade.give } });
    } catch (err) {
      trade.status = 'cancelled';
      trade.updatedAt = Date.now();
      this.log('warn', `trade ${trade.id}: could not join the swap: ${(err as Error).message}`);
    }
  }

  private onDecline(trade: MarketTradeRecord, reason: DeclineReason): void {
    if (trade.status === 'waiting') {
      trade.status = 'declined';
      trade.reason = reason;
      trade.updatedAt = Date.now();
      this.deps.notice({ kind: 'swap', code: 'marketDeclined', params: { reason } });
      return;
    }
    // The maker gave up before we locked: stop, so nothing is locked for nothing.
    if (trade.status === 'swapping' && trade.swapId) {
      const view = this.deps.swaps.list().find((v) => v.id === trade.swapId);
      if (view && !view.ours?.txid && view.cancellable) {
        this.deps.swaps.cancel(view.id);
        trade.status = 'declined';
        trade.reason = reason;
        trade.updatedAt = Date.now();
      }
    }
  }

  /** The other side's lock code: hand it to the swap, which checks the contract on its chain. */
  private onLock(trade: MarketTradeRecord, code: string): void {
    if (trade.gotLock === code || !trade.swapId || (trade.status !== 'invited' && trade.status !== 'swapping')) return;
    try {
      // Only for this trade's own swap: a peer may not hand codes to any other swap of this wallet.
      const info = this.deps.swaps.inspect(code);
      if (info.type !== 'lock' || info.id !== trade.swapId) {
        this.log('warn', `trade ${trade.id}: ignoring a lock code for another swap`);
        return;
      }
      this.deps.swaps.accept({ code });
      trade.gotLock = code;
      trade.status = 'swapping';
      trade.updatedAt = Date.now();
      this.log('info', `trade ${trade.id}: lock code received`);
    } catch (err) {
      this.log('warn', `trade ${trade.id}: lock code refused: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- trades over time

  private async advanceTrades(state: MarketState): Promise<void> {
    const swaps = new Map(this.deps.swaps.list().map((v) => [v.id, v]));
    for (const t of state.trades) {
      if (!ACTIVE.includes(t.status)) continue;
      try {
        await this.advance(state, t, t.swapId ? swaps.get(t.swapId) : undefined);
      } catch (err) {
        this.log('warn', `trade ${t.id}: ${(err as Error).message}`);
      }
    }
  }

  private async advance(state: MarketState, t: MarketTradeRecord, view: SwapView | undefined): Promise<void> {
    const now = this.nowSec();
    const age = now - Math.floor(t.createdAt / 1000);
    if (t.status === 'waiting') {
      if (age > this.timing.inviteWait) this.end(state, t, 'expired');
      return;
    }
    if (t.swapId && !view) return this.end(state, t, 'cancelled');
    if (!view) return;
    if (SWAP_ENDED.includes(view.stage)) return this.end(state, t, view.stage === 'completed' ? 'done' : 'cancelled');
    // Our coins are locked: send our lock code (once per code).
    if (view.code && view.ours?.txid && LOCK_SENT_STAGES.includes(view.stage) && view.code !== t.sentLock) {
      t.sentLock = view.code;
      await this.send(state, t, { type: 'lock', trade: t.id, code: view.code });
    }
    if (t.role === 'maker' && t.status === 'invited' && view.stage === 'send-invite' && age > this.timing.makerWait) {
      // The taker never locked: give up (nothing of ours is locked yet).
      this.deps.swaps.cancel(view.id);
      await this.send(state, t, { type: 'decline', trade: t.id, reason: 'expired' });
      this.end(state, t, 'expired');
    } else if (t.role === 'taker' && view.lockBy && now > view.lockBy + LOCK_GRACE && !view.ours?.txid && view.cancellable) {
      // Too late to lock (a payment made just in time has had a few minutes to show up): the
      // maker gives up soon. A Bitcoin contract is still watched, and refunded, if paid late.
      this.deps.swaps.cancel(view.id);
      this.end(state, t, 'expired');
    }
  }

  private end(state: MarketState, t: MarketTradeRecord, status: MarketTradeRecord['status']): void {
    t.status = status;
    t.updatedAt = Date.now();
    // A last message (a decline) has had its delivery attempt; an ended trade sends nothing more.
    delete t.outbox;
    this.log('info', `trade ${t.id}: ${status}`);
    if (t.role !== 'maker' || status === 'done' || t.returned) return;
    // The amount was taken off the offer for this trade: it is available again.
    const offer = state.offers.find((o) => o.id === t.offerId);
    t.returned = true;
    if (!offer) return;
    offer.left = (BigInt(offer.left) + BigInt(t.lbc)).toString();
    if (BigInt(offer.left) > BigInt(offer.lbc)) offer.left = offer.lbc;
    if (offer.status === 'open') this.publishOffer(offer);
  }

  private prune(state: MarketState): void {
    const cutoff = Date.now() - KEEP_MS;
    state.trades = state.trades.filter((t) => ACTIVE.includes(t.status) || !!t.outbox || t.updatedAt > cutoff);
    state.offers = state.offers.filter((o) => o.status === 'open' || o.createdAt > cutoff || state.trades.some((t) => t.offerId === o.id && ACTIVE.includes(t.status)));
  }

  private newTrade(p: { id: string; role: 'maker' | 'taker'; offerId: string; secret: string; peer: string; network: NetworkName; give: SwapCoin; lbc: bigint; btc: bigint; btcAddress?: string }): MarketTradeRecord {
    return {
      id: p.id,
      role: p.role,
      offerId: p.offerId,
      secret: p.secret,
      peer: p.peer,
      network: p.network,
      give: p.give,
      lbc: p.lbc.toString(),
      btc: p.btc.toString(),
      ...(p.btcAddress ? { btcAddress: p.btcAddress } : {}),
      status: 'waiting',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sentAt: 0,
    };
  }

  // ---------------------------------------------------------------- user actions

  private wallet(): MarketWallet {
    const w = this.deps.wallet();
    if (!w) throw new UserError('noWalletOpen');
    return w;
  }

  private writable(w: MarketWallet): void {
    if (w.watchOnly) throw new UserError('watchOnly');
  }

  /** The board, your offers and trades; keeps the board connected for a few minutes. */
  view(): MarketView {
    const first = this.nowMs() >= this.boardUntil;
    this.boardUntil = this.nowMs() + BOARD_KEEP_MS;
    if (first) void this.tick();
    return this.buildView();
  }

  /** Posting and taking need the order board's warning accepted (the UI shows it first). */
  private accepted(): void {
    if (this.settings.get().acceptedMarketTerms !== MARKET_TERMS_VERSION) throw new UserError('marketTermsNotAccepted');
  }

  post(params: { give: SwapCoin; lbc: string; btc: string; min: string; btcAddress: string }): Promise<MarketView> {
    return this.queue.run(async () => {
      this.accepted();
      const w = this.wallet();
      this.writable(w);
      const state = w.state();
      if (state.offers.filter((o) => o.status === 'open').length >= MAX_OPEN_OFFERS) throw new UserError('marketTooMany', { count: MAX_OPEN_OFFERS });
      let lbc: bigint, btc: bigint, min: bigint;
      try {
        lbc = BigInt(params.lbc);
        btc = BigInt(params.btc);
        min = BigInt(params.min);
      } catch {
        throw new UserError('invalidAmount');
      }
      if (lbc <= 0n || btc <= 0n || min <= 0n || min > lbc) throw new UserError('invalidAmount');
      const give = params.give;
      // The smallest part must be a swap worth doing, and the whole offer one swap at most.
      const terms = { lbc, btc, give };
      if (min < MIN_SWAP_LBC || btcForLbc(terms, min) < MIN_SWAP_BTC) {
        const lbcForMin = (MIN_SWAP_BTC * lbc + btc - 1n) / btc;
        throw new UserError('marketMinTooSmall', { btc: Number(MIN_SWAP_BTC) / 1e8, lbc: Math.ceil(Number(lbcForMin > MIN_SWAP_LBC ? lbcForMin : MIN_SWAP_LBC) / 1e8) });
      }
      checkSwapAmounts(w.network, lbc, btc);
      if (w.network === 'mainnet' && btc > MAX_SWAP_BTC) throw new UserError('swapAmountTooLarge', { btc: Number(MAX_SWAP_BTC) / 1e8 });
      if (give === 'LBC') {
        const needed = lbc + this.lbcReserved(state) + LOCK_FEE_MARGIN;
        if (w.spendable() < needed) throw new UserError('marketNotEnoughLbc', { needed: formatLbcPlain(needed), available: formatLbcPlain(w.spendable()) });
      }
      const btcAddress = checkBtcAddress(w.network, params.btcAddress);
      const offer: MarketOfferRecord = {
        id: toHex(randomBytes(8)),
        secret: toHex(newNostrSecret()),
        network: w.network,
        give,
        lbc: lbc.toString(),
        btc: btc.toString(),
        min: min.toString(),
        left: lbc.toString(),
        btcAddress,
        status: 'open',
        createdAt: Date.now(),
        publishedAt: 0,
      };
      state.offers.push(offer);
      w.save(state);
      this.boardUntil = Math.max(this.boardUntil, this.nowMs() + BOARD_KEEP_MS);
      await this.round();
      this.log('info', `offer ${offer.id} posted`);
      return this.buildView();
    });
  }

  withdraw(id: string): Promise<MarketView> {
    return this.queue.run(async () => {
      const w = this.wallet();
      const state = w.state();
      const offer = state.offers.find((o) => o.id === id);
      if (!offer) throw new UserError('marketOfferGone');
      if (offer.status === 'open') {
        offer.status = 'closed';
        w.save(state);
        if (this.pool) this.publishOffer(offer);
        else {
          // Not connected: connect just to take it down.
          await this.round();
          this.publishOffer(offer);
        }
      }
      this.scheduleChanged();
      return this.buildView();
    });
  }

  take(params: { key: string; lbc: string; btcAddress: string }): Promise<MarketTradeView> {
    return this.queue.run(async () => {
      this.accepted();
      const w = this.wallet();
      this.writable(w);
      const state = w.state();
      const offer = this.board.get(params.key);
      if (!offer || offer.status !== 'open' || offer.expiresAt <= this.nowSec() || offer.network !== w.network) throw new UserError('marketOfferGone');
      if (state.offers.some((o) => this.pubkey(o.secret) === offer.pubkey)) throw new UserError('marketOwnOffer');
      let lbc: bigint;
      try {
        lbc = BigInt(params.lbc);
      } catch {
        throw new UserError('invalidAmount');
      }
      if (!takeFits(offer, lbc)) throw new UserError('marketOutOfRange', { min: formatLbcPlain(offer.min), max: formatLbcPlain(offer.left) });
      const btc = btcForLbc(offer, lbc);
      checkSwapAmounts(w.network, lbc, btc);
      const give = otherCoin(offer.give);
      if (give === 'LBC') {
        const needed = lbc + this.lbcReserved(state) + LOCK_FEE_MARGIN;
        if (w.spendable() < needed) throw new UserError('marketNotEnoughLbc', { needed: formatLbcPlain(needed), available: formatLbcPlain(w.spendable()) });
      }
      const btcAddress = checkBtcAddress(w.network, params.btcAddress);
      const pool = this.ensurePool();
      if (pool.connected === 0) await waitForRelay(pool, 15_000);
      if (pool.connected === 0) throw new UserError('marketNoRelay');
      const trade = this.newTrade({ id: toHex(randomBytes(8)), role: 'taker', offerId: offer.id, secret: toHex(newNostrSecret()), peer: offer.pubkey, network: w.network, give, lbc, btc, btcAddress });
      state.trades.push(trade);
      await this.send(state, trade, { type: 'take', offer: offer.id, trade: trade.id, lbc, btc });
      w.save(state);
      this.subscribeMessages(pool, state);
      this.log('info', `took offer ${offer.id} (${lbc} dewies) as trade ${trade.id}`);
      this.scheduleChanged();
      return this.tradeView(trade);
    });
  }

  dismiss(id: string): Promise<MarketView> {
    return this.queue.run(async () => {
      const w = this.wallet();
      const state = w.state();
      const t = state.trades.find((x) => x.id === id);
      if (!t) throw new UserError('marketUnknownTrade');
      if (ACTIVE.includes(t.status)) throw new UserError('marketTradeRunning');
      state.trades = state.trades.filter((x) => x !== t);
      w.save(state);
      return this.buildView();
    });
  }

  // ---------------------------------------------------------------- views

  private scheduleChanged(): void {
    if (this.changedTimer) return;
    this.changedTimer = setTimeout(() => {
      this.changedTimer = null;
      this.deps.changed(this.buildView());
    }, 300);
  }

  private offerView(o: MarketOffer, mine: boolean): MarketOfferView {
    const price = satsPerLbc(o);
    return {
      key: `${o.pubkey}:${o.id}`,
      give: o.give,
      lbc: o.lbc.toString(),
      btc: o.btc.toString(),
      min: o.min.toString(),
      left: o.left.toString(),
      price,
      premium: this.price ? (price / this.price.sats - 1) * 100 : null,
      createdAt: o.createdAt,
      mine,
    };
  }

  private tradeView(t: MarketTradeRecord): MarketTradeView {
    return {
      id: t.id,
      role: t.role,
      give: t.give,
      get: otherCoin(t.give),
      lbc: t.lbc,
      btc: t.btc,
      status: t.status,
      reason: t.reason,
      swapId: t.swapId,
      unsent: !!t.outbox,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  private buildView(): MarketView {
    const w = this.deps.wallet();
    const network = w?.network ?? this.settings.get().network;
    const state = w?.state() ?? { offers: [], trades: [] };
    const now = this.nowSec();
    const myKeys = new Set(state.offers.map((o) => this.pubkey(o.secret)));
    const live = [...this.board.values()].filter((o) => o.status === 'open' && o.expiresAt > now && o.network === network);
    const sells = live.filter((o) => o.give === 'LBC').sort((a, b) => satsPerLbc(a) - satsPerLbc(b));
    const buys = live.filter((o) => o.give === 'BTC').sort((a, b) => satsPerLbc(b) - satsPerLbc(a));
    const mine: MyOfferView[] = state.offers
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((o) => {
        const terms = termsOf(o);
        return {
          ...this.offerView({ ...terms, id: o.id, pubkey: this.pubkey(o.secret), createdAt: o.publishedAt, expiresAt: o.publishedAt + 3600 }, true),
          id: o.id,
          status: o.status,
          btcAddress: o.btcAddress,
          running: state.trades.filter((t) => t.offerId === o.id && t.role === 'maker' && ACTIVE.includes(t.status)).length,
          relays: this.offerRelays.get(o.id) ?? 0,
          publishedAt: o.publishedAt,
        };
      });
    return {
      network,
      offers: [...sells, ...buys].map((o) => this.offerView(o, myKeys.has(o.pubkey))),
      mine,
      trades: state.trades
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((t) => this.tradeView(t)),
      relays: this.pool ? this.pool.status().map((r) => ({ url: r.url, state: r.state, error: r.error })) : this.relayList().map((url) => ({ url, state: 'closed' as const })),
      price: this.price,
      priceUnavailable: !this.price && this.priceFailed,
      loaded: this.loaded,
    };
  }
}

function formatLbcPlain(dewies: bigint): string {
  const whole = dewies / 100_000_000n;
  const frac = (dewies % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

function waitForRelay(pool: RelayPool, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const end = Date.now() + ms;
    const check = () => {
      if (pool.connected > 0 || Date.now() > end) return resolve();
      setTimeout(check, 200);
    };
    check();
  });
}
