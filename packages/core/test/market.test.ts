import { describe, expect, it } from 'vitest';
import {
  MARKET_KIND,
  OFFER_POW,
  OFFER_TTL,
  TAKE_POW,
  btcForLbc,
  leadingZeroBits,
  matchesFilter,
  messageEvent,
  messageFilter,
  newNostrSecret,
  nostrPublicKey,
  offerEvent,
  offerFilter,
  parseMessage,
  parseOffer,
  satsPerLbc,
  signEvent,
  signEventWithWork,
  takeFits,
  type NostrEvent,
  type OfferTerms,
} from '../src/index';

const NOW = 1_800_000_000;
const LBC = 100_000_000n;
const terms: OfferTerms = { network: 'mainnet', give: 'LBC', lbc: 50_000n * LBC, btc: 100_000n, min: 10_000n * LBC, left: 50_000n * LBC, status: 'open' };
const OFFER_ID = '0123456789abcdef';

/** Re-signs an event after changing it, as a dishonest client could. */
function resign(e: NostrEvent, secret: Uint8Array, change: Partial<NostrEvent>): NostrEvent {
  return signEvent({ kind: change.kind ?? e.kind, tags: change.tags ?? e.tags, content: change.content ?? e.content, created_at: change.created_at ?? e.created_at }, secret);
}

describe('order board prices', () => {
  it('rounds in the favour of the maker, who set the price', () => {
    const sells = { lbc: 3n * LBC, btc: 10n, give: 'LBC' as const };
    const buys = { ...sells, give: 'BTC' as const };
    expect(btcForLbc(sells, LBC)).toBe(4n); // 3.33… sats: the taker pays 4
    expect(btcForLbc(buys, LBC)).toBe(3n); // the maker pays 3
    expect(btcForLbc(sells, 3n * LBC)).toBe(10n);
    expect(btcForLbc(buys, 3n * LBC)).toBe(10n);
  });

  it('shows the price in satoshis per LBC', () => {
    expect(satsPerLbc(terms)).toBeCloseTo(2, 10);
  });

  it('allows takes between the minimum and what is left', () => {
    expect(takeFits(terms, 10_000n * LBC)).toBe(true);
    expect(takeFits(terms, 50_000n * LBC)).toBe(true);
    expect(takeFits(terms, 9_999n * LBC)).toBe(false);
    expect(takeFits(terms, 50_001n * LBC)).toBe(false);
    expect(takeFits({ ...terms, status: 'closed' }, 20_000n * LBC)).toBe(false);
  });
});

describe('order board offers', () => {
  it('publishes an offer that reads back the same, with proof of work', async () => {
    const secret = newNostrSecret();
    const e = await offerEvent(OFFER_ID, terms, secret, NOW);
    expect(e.kind).toBe(MARKET_KIND);
    expect(leadingZeroBits(e.id)).toBeGreaterThanOrEqual(OFFER_POW);
    expect(matchesFilter(e, offerFilter('mainnet', NOW + 60))).toBe(true);
    expect(matchesFilter(e, offerFilter('testnet', NOW + 60))).toBe(false);
    expect(parseOffer(e, NOW + 60)).toEqual({ ...terms, id: OFFER_ID, pubkey: nostrPublicKey(secret), createdAt: NOW, expiresAt: NOW + OFFER_TTL });
  });

  it('stops showing an offer when it expires, or once it is closed', async () => {
    const secret = newNostrSecret();
    const e = await offerEvent(OFFER_ID, terms, secret, NOW);
    expect(parseOffer(e, NOW + OFFER_TTL)).toBeNull();
    const closed = parseOffer(await offerEvent(OFFER_ID, { ...terms, status: 'closed' }, secret, NOW + 1), NOW + 60);
    expect(closed?.status).toBe('closed');
    expect(closed!.expiresAt - closed!.createdAt).toBeLessThan(OFFER_TTL);
    const sold = parseOffer(await offerEvent(OFFER_ID, { ...terms, left: 1n, min: 1n, status: 'closed' }, secret, NOW + 2), NOW + 60);
    expect(sold?.left).toBe(1n);
  });

  it('ignores offers without the proof of work, with an expiry too far away, or dated in the future', async () => {
    const secret = newNostrSecret();
    const e = await offerEvent(OFFER_ID, terms, secret, NOW);
    let lazy = resign(e, secret, { tags: e.tags.filter((t) => t[0] !== 'nonce') });
    while (leadingZeroBits(lazy.id) >= OFFER_POW) lazy = resign(lazy, secret, { created_at: lazy.created_at + 1 });
    expect(parseOffer(lazy, NOW + 60)).toBeNull();
    const forever = e.tags.map((t) => (t[0] === 'expiration' ? ['expiration', String(NOW + 10 * OFFER_TTL)] : t));
    expect(parseOffer(await offerEvent(OFFER_ID, terms, secret, NOW).then((x) => ({ ...x, tags: forever })), NOW + 60)).toBeNull();
    expect(parseOffer(await offerEvent(OFFER_ID, terms, secret, NOW + 3600), NOW)).toBeNull();
  });

  it('ignores offers whose terms do not add up', async () => {
    const secret = newNostrSecret();
    await expect(offerEvent(OFFER_ID, { ...terms, min: terms.left + 1n }, secret, NOW)).rejects.toThrow(/invalid offer/);
    await expect(offerEvent('not-an-id', terms, secret, NOW)).rejects.toThrow(/invalid offer/);
    const e = await offerEvent(OFFER_ID, terms, secret, NOW);
    const content = JSON.parse(e.content);
    for (const bad of [{ left: '60000' + '00000000' }, { lbc: '0' }, { btc: '-5' }, { give: 'XMR' }, { network: 'testnet' }, { v: 2 }, { status: 'maybe' }, { min: '1.5' }]) {
      // Valid proof of work and signature: only the terms are wrong.
      const forged = await signEventWithWork({ kind: e.kind, tags: e.tags, content: JSON.stringify({ ...content, ...bad }), created_at: NOW }, secret, OFFER_POW);
      expect(parseOffer(forged, NOW + 60), JSON.stringify(bad)).toBeNull();
    }
  }, 30_000);
});

describe('order board messages', () => {
  const maker = newNostrSecret();
  const taker = newNostrSecret();
  const TRADE = 'fedcba9876543210';

  it('carries a take, with proof of work, readable only by the maker', async () => {
    const e = await messageEvent({ type: 'take', offer: OFFER_ID, trade: TRADE, lbc: 20_000n * LBC, btc: 40_000n }, taker, nostrPublicKey(maker), NOW);
    expect(leadingZeroBits(e.id)).toBeGreaterThanOrEqual(TAKE_POW);
    expect(e.content).not.toContain(OFFER_ID);
    expect(matchesFilter(e, messageFilter([nostrPublicKey(maker)], NOW))).toBe(true);
    expect(parseMessage(e, maker, NOW)).toEqual({ type: 'take', offer: OFFER_ID, trade: TRADE, lbc: 20_000n * LBC, btc: 40_000n });
    expect(parseMessage(e, taker, NOW)).toBeNull();
    expect(parseMessage(e, newNostrSecret(), NOW)).toBeNull();
  }, 30_000);

  it('carries invites, lock codes and declines', async () => {
    const code = 'lbcswap:eyJ0IjoiaW52aXRlIn0.00000000';
    for (const m of [
      { type: 'invite' as const, trade: TRADE, code },
      { type: 'lock' as const, trade: TRADE, code },
      { type: 'decline' as const, trade: TRADE, reason: 'taken' as const },
    ]) {
      const e = await messageEvent(m, maker, nostrPublicKey(taker), NOW);
      expect(parseMessage(e, taker, NOW)).toEqual(m);
    }
  });

  it('ignores a take without its proof of work, and messages filed under another trade', async () => {
    const e = await messageEvent({ type: 'invite', trade: TRADE, code: 'lbcswap:x.0' }, maker, nostrPublicKey(taker), NOW);
    expect(parseMessage(resign(e, maker, { tags: e.tags.map((t) => (t[0] === 'd' ? ['d', 'lbc-wallet:msg:0000000000000000'] : t)) }), taker, NOW)).toBeNull();
    const take = await messageEvent({ type: 'take', offer: OFFER_ID, trade: TRADE, lbc: LBC, btc: 2n }, taker, nostrPublicKey(maker), NOW);
    let cheap = resign(take, taker, { tags: take.tags.filter((t) => t[0] !== 'nonce') });
    while (leadingZeroBits(cheap.id) >= TAKE_POW) cheap = resign(cheap, taker, { created_at: cheap.created_at + 1 });
    expect(parseMessage(cheap, maker, NOW)).toBeNull();
    expect(parseMessage(e, taker, NOW + 4 * 24 * 3600)).toBeNull();
  }, 30_000);
});
