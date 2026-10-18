/**
 * A pool of Nostr relays (NIP-01). The market publishes to every relay in the
 * list and reads from all of them, so no single relay decides what people
 * see: one that is down, slow or censoring changes nothing while another
 * works. Every event that comes in is verified (its id and signature) and
 * checked against the subscription's own filters before it is passed on, so a
 * relay can withhold events but cannot forge or alter them.
 */
import { Emitter } from '../util/emitter.js';
import { toHex } from '../encoding/bytes.js';
import { randomBytes } from '../crypto/hash.js';
import type { WebSocketFactory, WebSocketLike } from '../net/websocket.js';
import { matchesFilter, verifyEvent, type NostrEvent, type NostrFilter } from './event.js';

export interface RelayStatus {
  url: string;
  state: 'connecting' | 'open' | 'closed';
  /** Why the last connection failed or closed. */
  error?: string;
  /** When the current connection opened (ms). */
  connectedAt?: number;
  /** Events received from this relay that passed every check. */
  events: number;
}

export interface PublishResult {
  url: string;
  ok: boolean;
  message?: string;
}

export interface RelayPoolOptions {
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** How often an idle connection is pinged; one silent for 2.5× this long is reopened. */
  pingMs?: number;
  /** First and longest wait between reconnection attempts. */
  minBackoffMs?: number;
  maxBackoffMs?: number;
  /** Longest wait for a relay to accept a published event. */
  publishTimeoutMs?: number;
}

interface Subscription {
  id: string;
  filters: NostrFilter[];
  onEvent: (event: NostrEvent, relay: string) => void;
  onEose?: (relay: string) => void;
  /** Event ids already passed on (relays send the same events). */
  seen: Set<string>;
}

interface Relay {
  url: string;
  ws: WebSocketLike | null;
  state: RelayStatus['state'];
  error?: string;
  connectedAt?: number;
  events: number;
  attempt: number;
  retryTimer?: ReturnType<typeof setTimeout>;
  /** Waiting for the connection to open. */
  whenOpen: (() => void)[];
  /** Published events waiting for the relay's OK. */
  acks: Map<string, (r: { ok: boolean; message?: string }) => void>;
}

const MAX_SEEN = 5_000;
/** Relays answer with these prefixes when they refuse (NIP-01). */
const REFUSAL = /^(blocked|rate-limited|invalid|pow|duplicate|restricted|error|auth-required|mute):/;

export class RelayPool extends Emitter<{ status: RelayStatus[] }> {
  private readonly relays = new Map<string, Relay>();
  private readonly subs = new Map<string, Subscription>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private readonly connect: WebSocketFactory,
    urls: string[],
    private readonly options: RelayPoolOptions = {},
  ) {
    super();
    this.setRelays(urls);
    this.pingTimer = setInterval(() => this.keepAlive(), this.options.pingMs ?? 30_000);
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.options.log?.(level, message);
  }

  /** Connects to new relays in the list and closes those no longer in it. */
  setRelays(urls: string[]): void {
    if (this.closed) return;
    const wanted = new Set(urls);
    for (const [url, relay] of this.relays) {
      if (wanted.has(url)) continue;
      this.relays.delete(url);
      this.shut(relay);
    }
    for (const url of wanted) {
      if (this.relays.has(url)) continue;
      const relay: Relay = { url, ws: null, state: 'closed', events: 0, attempt: 0, whenOpen: [], acks: new Map() };
      this.relays.set(url, relay);
      this.open(relay);
    }
    this.statusChanged();
  }

  status(): RelayStatus[] {
    return [...this.relays.values()].map((r) => ({ url: r.url, state: r.state, error: r.error, connectedAt: r.connectedAt, events: r.events }));
  }

  /** Relays with an open connection. */
  get connected(): number {
    let n = 0;
    for (const r of this.relays.values()) if (r.state === 'open') n++;
    return n;
  }

  /**
   * Asks every relay for events matching any of `filters`, now and as they
   * arrive. `onEose` is called once per relay when it has sent what it stored.
   * Returns a function that ends the subscription.
   */
  subscribe(filters: NostrFilter[], onEvent: (event: NostrEvent, relay: string) => void, onEose?: (relay: string) => void): () => void {
    const sub: Subscription = { id: toHex(randomBytes(8)), filters, onEvent, onEose, seen: new Set() };
    this.subs.set(sub.id, sub);
    for (const relay of this.relays.values()) if (relay.state === 'open') this.request(relay, sub);
    return () => {
      if (!this.subs.delete(sub.id)) return;
      for (const relay of this.relays.values()) if (relay.state === 'open') this.sendTo(relay, ['CLOSE', sub.id]);
    };
  }

  /**
   * Sends an event to every relay and waits (up to the publish timeout) for
   * each to accept or refuse it. The event reached the network if any relay
   * accepted it.
   */
  publish(event: NostrEvent): Promise<PublishResult[]> {
    const timeoutMs = this.options.publishTimeoutMs ?? 10_000;
    return Promise.all(
      [...this.relays.values()].map(
        (relay) =>
          new Promise<PublishResult>((resolve) => {
            let done = false;
            const finish = (r: { ok: boolean; message?: string }) => {
              if (done) return;
              done = true;
              clearTimeout(timer);
              relay.acks.delete(event.id);
              resolve({ url: relay.url, ...r });
            };
            const timer = setTimeout(() => finish({ ok: false, message: relay.state === 'open' ? 'no answer' : (relay.error ?? 'not connected') }), timeoutMs);
            const send = () => {
              if (done) return;
              relay.acks.set(event.id, finish);
              if (!this.sendTo(relay, ['EVENT', event])) finish({ ok: false, message: 'not connected' });
            };
            if (relay.state === 'open') send();
            else relay.whenOpen.push(send);
          }),
      ),
    );
  }

  /** Closes every connection; the pool cannot be used afterwards. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    for (const relay of this.relays.values()) this.shut(relay);
    this.relays.clear();
    this.subs.clear();
    this.removeAllListeners();
  }

  // ---------------------------------------------------------------- connections

  private open(relay: Relay): void {
    if (this.closed || this.relays.get(relay.url) !== relay) return;
    let ws: WebSocketLike;
    try {
      ws = this.connect(relay.url);
    } catch (err) {
      relay.state = 'closed';
      relay.error = (err as Error).message;
      this.statusChanged();
      return; // a malformed address: never retried
    }
    relay.ws = ws;
    relay.state = 'connecting';
    ws.onMessage((text) => this.onMessage(relay, ws, text));
    ws.onClose((err) => this.onClosed(relay, ws, err));
    ws.connect().then(
      () => {
        if (relay.ws !== ws) return ws.close();
        relay.state = 'open';
        relay.connectedAt = Date.now();
        delete relay.error;
        this.log('info', `connected to ${relay.url}`);
        for (const sub of this.subs.values()) this.request(relay, sub);
        const waiting = relay.whenOpen.splice(0);
        for (const send of waiting) send();
        this.statusChanged();
      },
      (err: Error) => this.onClosed(relay, ws, err),
    );
    this.statusChanged();
  }

  private onClosed(relay: Relay, ws: WebSocketLike, err?: Error): void {
    if (relay.ws !== ws) return;
    relay.ws = null;
    const wasOpenFor = relay.connectedAt ? Date.now() - relay.connectedAt : 0;
    relay.state = 'closed';
    delete relay.connectedAt;
    relay.error = err?.message ?? 'connection closed';
    for (const ack of [...relay.acks.values()]) ack({ ok: false, message: relay.error });
    relay.acks.clear();
    // A connection that lasted a while starts the backoff again; one that keeps failing waits longer each time.
    relay.attempt = wasOpenFor > 60_000 ? 1 : relay.attempt + 1;
    if (this.closed || this.relays.get(relay.url) !== relay) return;
    const base = Math.min(this.options.maxBackoffMs ?? 300_000, (this.options.minBackoffMs ?? 2_000) * 2 ** Math.min(relay.attempt - 1, 10));
    const delay = Math.round(base * (0.75 + Math.random() * 0.5));
    this.log('info', `${relay.url}: ${relay.error}; retrying in ${Math.round(delay / 1000)} s`);
    relay.retryTimer = setTimeout(() => this.open(relay), delay);
    this.statusChanged();
  }

  private shut(relay: Relay): void {
    if (relay.retryTimer) clearTimeout(relay.retryTimer);
    const ws = relay.ws;
    relay.ws = null;
    relay.state = 'closed';
    for (const ack of [...relay.acks.values()]) ack({ ok: false, message: 'relay removed' });
    relay.acks.clear();
    relay.whenOpen = [];
    ws?.close();
  }

  private keepAlive(): void {
    const silentMs = (this.options.pingMs ?? 30_000) * 2.5;
    for (const relay of this.relays.values()) {
      const ws = relay.ws;
      if (!ws || relay.state !== 'open') continue;
      if (Date.now() - ws.lastActivity() > silentMs) {
        this.log('warn', `${relay.url} stopped answering; reconnecting`);
        this.onClosed(relay, ws, new Error('stopped answering'));
        ws.close();
      } else ws.ping();
    }
  }

  private sendTo(relay: Relay, message: unknown[]): boolean {
    if (relay.state !== 'open' || !relay.ws) return false;
    try {
      relay.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      this.log('warn', `${relay.url}: ${(err as Error).message}`);
      return false;
    }
  }

  private request(relay: Relay, sub: Subscription): void {
    this.sendTo(relay, ['REQ', sub.id, ...sub.filters]);
  }

  private statusChanged(): void {
    if (!this.closed) this.emit('status', this.status());
  }

  // ---------------------------------------------------------------- messages

  private onMessage(relay: Relay, ws: WebSocketLike, text: string): void {
    if (relay.ws !== ws) return;
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!Array.isArray(msg) || typeof msg[0] !== 'string') return;
    switch (msg[0]) {
      case 'EVENT': {
        const sub = typeof msg[1] === 'string' ? this.subs.get(msg[1]) : undefined;
        const event = msg[2] as NostrEvent;
        if (!sub || !event || typeof event !== 'object' || typeof event.id !== 'string') return;
        if (sub.seen.has(event.id)) return;
        // A relay may send anything: only signed events that match what was asked for count.
        if (!verifyEvent(event) || !sub.filters.some((f) => matchesFilter(event, f))) {
          this.log('warn', `${relay.url} sent an event that fails its checks; ignored`);
          return;
        }
        if (sub.seen.size >= MAX_SEEN) sub.seen.clear();
        sub.seen.add(event.id);
        relay.events++;
        sub.onEvent(event, relay.url);
        return;
      }
      case 'EOSE': {
        const sub = typeof msg[1] === 'string' ? this.subs.get(msg[1]) : undefined;
        sub?.onEose?.(relay.url);
        return;
      }
      case 'OK': {
        if (typeof msg[1] !== 'string') return;
        const ack = relay.acks.get(msg[1]);
        const message = typeof msg[3] === 'string' ? msg[3].slice(0, 200) : undefined;
        // "duplicate:" means the relay already has it, which is what publishing wants.
        ack?.({ ok: msg[2] === true || (!!message && message.startsWith('duplicate:')), message });
        return;
      }
      case 'CLOSED': {
        const reason = typeof msg[2] === 'string' ? msg[2].slice(0, 200) : '';
        this.log('warn', `${relay.url} ended a subscription${reason ? `: ${reason}` : ''}`);
        if (REFUSAL.test(reason)) relay.error = reason;
        this.statusChanged();
        return;
      }
      case 'NOTICE':
        this.log('info', `${relay.url} says: ${String(msg[1]).slice(0, 200)}`);
        return;
      default:
        // AUTH (NIP-42) and anything newer: this client does not log in to relays.
        return;
    }
  }
}
