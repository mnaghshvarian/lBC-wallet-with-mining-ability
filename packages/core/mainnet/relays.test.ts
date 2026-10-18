/**
 * The Market's default Nostr relays, read-only: each one accepts a WebSocket
 * connection from the wallet's own client, answers the order board's query
 * and says when it has sent what it stores. Nothing is published.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RELAYS } from '../../services/src/api';
import { RelayPool, createWebSocket, offerFilter, parseOffer, type NostrEvent } from '../src/index';
import { nodeByteTransport } from '../src/node/index';

describe('the default order board relays', () => {
  it('answer the board query, and every event they send verifies', async () => {
    const pool = new RelayPool((url) => createWebSocket(url, (endpoint) => nodeByteTransport(endpoint, { connectTimeoutMs: 15_000 })), DEFAULT_RELAYS, {
      log: (level, message) => console.log(`[relays] ${level}: ${message}`),
    });
    const answered = new Set<string>();
    const offers: NostrEvent[] = [];
    try {
      const now = Math.floor(Date.now() / 1000);
      // A second filter that matches recent public notes, so the event checks run on real data.
      pool.subscribe([offerFilter('mainnet', now), { kinds: [1], limit: 5 }], (e) => offers.push(e), (relay) => answered.add(relay));
      for (const end = Date.now() + 30_000; answered.size < DEFAULT_RELAYS.length && Date.now() < end; ) await new Promise((r) => setTimeout(r, 250));
      for (const s of pool.status()) console.log(`[relays] ${s.url}: ${s.state}${s.error ? ` (${s.error})` : ''}${answered.has(s.url) ? ', answered' : ''}`);
      const board = offers.map((e) => parseOffer(e, now)).filter((o) => o !== null);
      console.log(`[relays] ${offers.length} verified events, ${board.length} offers on the mainnet board`);
      // Relays come and go; most of the default list must work.
      expect(answered.size).toBeGreaterThanOrEqual(Math.ceil(DEFAULT_RELAYS.length / 2));
      expect(offers.length).toBeGreaterThan(0);
    } finally {
      pool.close();
    }
  }, 60_000);
});
