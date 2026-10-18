/**
 * The order board: public offers to swap LBC and Bitcoin, published on Nostr
 * relays, and the private messages that turn a taken offer into an atomic
 * swap (core/swap). Nobody holds anyone's coins: an offer is only an
 * announcement, and the coins move through the same contracts as a swap set
 * up by hand.
 *
 * Offers and messages are Nostr events of kind 30078 (application data,
 * NIP-78), replaceable per key and `d` tag, and expire (NIP-40):
 *
 *   offer    d = lbc-wallet:offer:<id>   t = lbc-wallet-offer, lbc-wallet-offer:<network>
 *            content: {"v":1,"network","give","lbc","btc","min","left","status"}
 *   message  d = lbc-wallet:msg:<trade>  t = lbc-wallet-msg   p = recipient
 *            content: NIP-44 encrypted {"v":1,"type":"take"|"invite"|"lock"|"decline",…}
 *
 * The maker (who posted the offer) starts the swap and locks second; the taker
 * joins it and locks first:
 *
 *   taker → maker  take    {offer, trade, lbc, btc}     (with proof of work)
 *   maker → taker  invite  {trade, code}                (the swap invite) — or decline
 *   taker → maker  lock    {trade, code}                (after the taker's coins are locked)
 *   maker → taker  lock    {trade, code}                (after the maker's coins are locked)
 *
 * Each offer has its own Nostr key, and each take another, so trades cannot
 * be linked to each other or to a wallet through the relays.
 */
import { isHex } from '../encoding/bytes.js';
import type { NetworkName } from '../networks.js';
import type { SwapCoin } from '../swap/protocol.js';
import { leadingZeroBits, nostrPublicKey, signEvent, signEventWithWork, tagValue, type NostrEvent, type NostrFilter } from '../nostr/event.js';
import { conversationKey, nip44Decrypt, nip44Encrypt } from '../nostr/nip44.js';

export const MARKET_KIND = 30078;
export const OFFER_TAG = 'lbc-wallet-offer';
export const MESSAGE_TAG = 'lbc-wallet-msg';
const OFFER_D = 'lbc-wallet:offer:';
const MESSAGE_D = 'lbc-wallet:msg:';

/** An offer is shown for an hour after it was last renewed; its wallet renews it every 20 minutes. */
export const OFFER_TTL = 3600;
export const OFFER_RENEW = 20 * 60;
/** Messages of a trade are kept by relays for three days. */
export const MESSAGE_TTL = 3 * 24 * 3600;
/** Proof of work (leading zero bits of the event id) on offers and on takes. */
export const OFFER_POW = 12;
export const TAKE_POW = 16;
/** Events dated further ahead than this are ignored (a wrong clock, or a trick to stay on top). */
const MAX_CLOCK_AHEAD = 15 * 60;

const NETWORKS: NetworkName[] = ['mainnet', 'testnet', 'regtest'];
const COINS: SwapCoin[] = ['LBC', 'BTC'];
/** Upper bounds for amounts: all LBC that will ever exist, and all Bitcoin. */
const MAX_LBC = 1_083_202_000n * 100_000_000n;
const MAX_BTC = 21_000_000n * 100_000_000n;

/** What an offer says (amounts in dewies and satoshis). */
export interface OfferTerms {
  network: NetworkName;
  /** What the maker gives; the taker gives the other coin. */
  give: SwapCoin;
  /** The price, as the amounts of the whole offer: `btc` satoshis for `lbc` dewies. */
  lbc: bigint;
  btc: bigint;
  /** Smallest part that can be taken, in dewies. */
  min: bigint;
  /** What is still available, in dewies. */
  left: bigint;
  status: 'open' | 'closed';
}

/** An offer as read from a relay. */
export interface MarketOffer extends OfferTerms {
  /** The offer's id (from its d tag). */
  id: string;
  /** The key that signed it; takes are written to it. */
  pubkey: string;
  /** When this version was published, and when it stops being shown (Unix seconds). */
  createdAt: number;
  expiresAt: number;
}

export type DeclineReason = 'taken' | 'closed' | 'amount' | 'price' | 'expired';
const DECLINE_REASONS: DeclineReason[] = ['taken', 'closed', 'amount', 'price', 'expired'];

export type MarketMessage =
  | { type: 'take'; offer: string; trade: string; lbc: bigint; btc: bigint }
  | { type: 'invite'; trade: string; code: string }
  | { type: 'lock'; trade: string; code: string }
  | { type: 'decline'; trade: string; reason: DeclineReason };

const isId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);

function amount(v: unknown, max: bigint): bigint | null {
  if (typeof v !== 'string' || !/^[1-9]\d{0,18}$/.test(v)) return null;
  const n = BigInt(v);
  return n <= max ? n : null;
}

// ---------------------------------------------------------------- prices

/**
 * The Bitcoin for `lbc` dewies of an offer, at the offer's price, rounded in
 * the maker's favour (the maker set the price).
 */
export function btcForLbc(offer: Pick<OfferTerms, 'lbc' | 'btc' | 'give'>, lbc: bigint): bigint {
  const product = lbc * offer.btc;
  if (offer.give === 'BTC') return product / offer.lbc;
  return (product + offer.lbc - 1n) / offer.lbc;
}

/** Satoshis per LBC (for display and sorting; not used for amounts). */
export function satsPerLbc(offer: Pick<OfferTerms, 'lbc' | 'btc'>): number {
  return (Number(offer.btc) / Number(offer.lbc)) * 1e8;
}

/** Whether a take of `lbc` dewies fits the offer. */
export function takeFits(offer: OfferTerms, lbc: bigint): boolean {
  return offer.status === 'open' && lbc >= offer.min && lbc <= offer.left;
}

// ---------------------------------------------------------------- offers

/** The relay query for a network's offers that may still be shown. */
export function offerFilter(network: NetworkName, now: number): NostrFilter {
  return { kinds: [MARKET_KIND], '#t': [`${OFFER_TAG}:${network}`], since: now - OFFER_TTL, limit: 500 };
}

function checkTerms(t: OfferTerms): boolean {
  return (
    NETWORKS.includes(t.network) &&
    COINS.includes(t.give) &&
    t.lbc > 0n &&
    t.btc > 0n &&
    t.lbc <= MAX_LBC &&
    t.btc <= MAX_BTC &&
    t.min > 0n &&
    t.min <= t.left &&
    t.left <= t.lbc &&
    (t.status === 'open' || t.status === 'closed')
  );
}

/**
 * Signs an offer (with its proof of work). `createdAt` must grow with every
 * new version, so relays keep the newest.
 */
export async function offerEvent(id: string, terms: OfferTerms, secret: Uint8Array, createdAt: number): Promise<NostrEvent> {
  if (!isId(id) || !checkTerms(terms)) throw new Error('invalid offer');
  const ttl = terms.status === 'open' ? OFFER_TTL : 10 * 60;
  return signEventWithWork(
    {
      kind: MARKET_KIND,
      created_at: createdAt,
      tags: [
        ['d', OFFER_D + id],
        ['t', OFFER_TAG],
        ['t', `${OFFER_TAG}:${terms.network}`],
        ['expiration', String(createdAt + ttl)],
      ],
      content: JSON.stringify({
        v: 1,
        network: terms.network,
        give: terms.give,
        lbc: terms.lbc.toString(),
        btc: terms.btc.toString(),
        min: terms.min.toString(),
        left: terms.left.toString(),
        status: terms.status,
      }),
    },
    secret,
    OFFER_POW,
  );
}

/** Reads an offer from a verified event; null for anything that is not a valid, current offer. */
export function parseOffer(e: NostrEvent, now: number): MarketOffer | null {
  if (e.kind !== MARKET_KIND || leadingZeroBits(e.id) < OFFER_POW) return null;
  const d = tagValue(e, 'd');
  if (!d?.startsWith(OFFER_D) || !isId(d.slice(OFFER_D.length))) return null;
  const expiresAt = Number(tagValue(e, 'expiration'));
  if (!Number.isInteger(expiresAt) || expiresAt <= now || expiresAt > e.created_at + OFFER_TTL || e.created_at > now + MAX_CLOCK_AHEAD) return null;
  if (e.content.length > 1000) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(e.content) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || j.v !== 1) return null;
  const lbc = amount(j.lbc, MAX_LBC);
  const btc = amount(j.btc, MAX_BTC);
  const min = amount(j.min, MAX_LBC);
  const left = j.left === '0' ? 0n : amount(j.left, MAX_LBC);
  if (lbc === null || btc === null || min === null || left === null) return null;
  const terms = { network: j.network as NetworkName, give: j.give as SwapCoin, lbc, btc, min, left, status: j.status as OfferTerms['status'] };
  // A fully taken offer may carry left = 0 with status closed.
  const valid = terms.status === 'closed' && left === 0n ? checkTerms({ ...terms, min: 1n, left: 1n }) : checkTerms(terms);
  if (!valid || !e.tags.some((t) => t[0] === 't' && t[1] === `${OFFER_TAG}:${terms.network}`)) return null;
  return { ...terms, id: d.slice(OFFER_D.length), pubkey: e.pubkey, createdAt: e.created_at, expiresAt };
}

// ---------------------------------------------------------------- messages

/** The relay query for messages written to any of `pubkeys`. */
export function messageFilter(pubkeys: string[], now: number): NostrFilter {
  return { kinds: [MARKET_KIND], '#p': pubkeys, '#t': [MESSAGE_TAG], since: now - MESSAGE_TTL, limit: 500 };
}

function messageJson(m: MarketMessage): Record<string, unknown> {
  switch (m.type) {
    case 'take':
      return { v: 1, type: 'take', offer: m.offer, trade: m.trade, lbc: m.lbc.toString(), btc: m.btc.toString() };
    case 'invite':
    case 'lock':
      return { v: 1, type: m.type, trade: m.trade, code: m.code };
    case 'decline':
      return { v: 1, type: 'decline', trade: m.trade, reason: m.reason };
  }
}

/**
 * Encrypts a message to `recipient` and signs it. A take carries proof of
 * work, so flooding a maker with takes costs something. `createdAt` must
 * grow with each message of a trade (each replaces the one before).
 */
export async function messageEvent(m: MarketMessage, secret: Uint8Array, recipient: string, createdAt: number): Promise<NostrEvent> {
  if (!isId(m.trade) || !isHex(recipient, 32)) throw new Error('invalid message');
  const content = nip44Encrypt(JSON.stringify(messageJson(m)), conversationKey(secret, recipient));
  const template = {
    kind: MARKET_KIND,
    created_at: createdAt,
    tags: [
      ['d', MESSAGE_D + m.trade],
      ['t', MESSAGE_TAG],
      ['p', recipient],
      ['expiration', String(createdAt + MESSAGE_TTL)],
    ],
    content,
  };
  return m.type === 'take' ? signEventWithWork(template, secret, TAKE_POW) : signEvent(template, secret);
}

/**
 * Decrypts and checks a message written to the key `secret`; null when it is
 * not one, cannot be read, or is malformed. The sender is `e.pubkey`.
 */
export function parseMessage(e: NostrEvent, secret: Uint8Array, now: number): MarketMessage | null {
  if (e.kind !== MARKET_KIND || tagValue(e, 'p') !== nostrPublicKey(secret)) return null;
  const d = tagValue(e, 'd');
  if (!d?.startsWith(MESSAGE_D)) return null;
  const expiresAt = Number(tagValue(e, 'expiration'));
  if (!Number.isInteger(expiresAt) || expiresAt <= now || e.created_at > now + MAX_CLOCK_AHEAD) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(nip44Decrypt(e.content, conversationKey(secret, e.pubkey))) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || j.v !== 1 || !isId(j.trade) || d !== MESSAGE_D + j.trade) return null;
  const trade = j.trade;
  switch (j.type) {
    case 'take': {
      const lbc = amount(j.lbc, MAX_LBC);
      const btc = amount(j.btc, MAX_BTC);
      if (!isId(j.offer) || lbc === null || btc === null || leadingZeroBits(e.id) < TAKE_POW) return null;
      return { type: 'take', offer: j.offer, trade, lbc, btc };
    }
    case 'invite':
    case 'lock':
      if (typeof j.code !== 'string' || j.code.length > 2000 || !j.code.startsWith('lbcswap:')) return null;
      return { type: j.type, trade, code: j.code };
    case 'decline':
      if (!DECLINE_REASONS.includes(j.reason as DeclineReason)) return null;
      return { type: 'decline', trade, reason: j.reason as DeclineReason };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- what a wallet keeps

/** One of this wallet's offers. Stored in the encrypted wallet state (it holds the offer's key). */
export interface MarketOfferRecord {
  id: string;
  /** The offer's Nostr secret key (hex). */
  secret: string;
  network: NetworkName;
  give: SwapCoin;
  /** Amounts of the whole offer, and the smallest part, as decimal strings (dewies, satoshis). */
  lbc: string;
  btc: string;
  min: string;
  /** Dewies not yet taken by a finished or running trade. */
  left: string;
  /** Where Bitcoin is paid to this wallet's owner (or refunded, when they give Bitcoin). */
  btcAddress: string;
  status: 'open' | 'closed';
  createdAt: number;
  /** created_at of the last version published (Unix seconds). */
  publishedAt: number;
}

/** A trade that came from the board: a take, the swap it became, and the messages that set it up. */
export interface MarketTradeRecord {
  id: string;
  role: 'maker' | 'taker';
  offerId: string;
  /** Our Nostr secret key for the trade (the maker's is the offer's). */
  secret: string;
  /** The other side's Nostr public key. */
  peer: string;
  network: NetworkName;
  /** What this wallet gives. */
  give: SwapCoin;
  lbc: string;
  btc: string;
  /** The taker's Bitcoin address: where it gets Bitcoin, or its Bitcoin refund. */
  btcAddress?: string;
  /** The swap this trade became (core/swap). */
  swapId?: string;
  /** Lock codes sent and received, so each is handled once. */
  sentLock?: string;
  gotLock?: string;
  /**
   * waiting: the taker waits for the maker's invite; invited: the maker waits
   * for the taker's lock; swapping: both sides follow the swap; then
   * done, declined (with `reason`), expired or cancelled.
   */
  status: 'waiting' | 'invited' | 'swapping' | 'done' | 'declined' | 'expired' | 'cancelled';
  reason?: DeclineReason;
  createdAt: number;
  updatedAt: number;
  /** created_at of the last message sent (Unix seconds). */
  sentAt: number;
}

export interface MarketState {
  offers: MarketOfferRecord[];
  trades: MarketTradeRecord[];
}
