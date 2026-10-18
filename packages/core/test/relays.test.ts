import { afterEach, describe, expect, it } from 'vitest';
import { RelayPool, createWebSocket, newNostrSecret, signEvent, type NostrEvent } from '../src/index';
import { nodeByteTransport } from '../src/node/index';
import { startTestRelay, type TestRelay } from '../e2e/nostr-relay';

const connect = (url: string) => createWebSocket(url, (endpoint) => nodeByteTransport(endpoint, { connectTimeoutMs: 5000 }), { handshakeTimeoutMs: 5000 });

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

async function relays(n: number): Promise<TestRelay[]> {
  const list = await Promise.all(Array.from({ length: n }, () => startTestRelay()));
  for (const r of list) cleanup.push(() => r.close());
  return list;
}

function pool(urls: string[]): RelayPool {
  const p = new RelayPool(connect, urls, { minBackoffMs: 50, maxBackoffMs: 200, publishTimeoutMs: 2000 });
  cleanup.push(() => p.close());
  return p;
}

async function until(check: () => boolean, ms = 5000): Promise<void> {
  for (const end = Date.now() + ms; !check(); ) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const note = (content: string, secret = newNostrSecret(), tags: string[][] = [['t', 'lbc-wallet-test']]) =>
  signEvent({ kind: 30078, tags: [['d', 'x'], ...tags], content }, secret);

describe('relay pool', () => {
  it('publishes to every relay and hands each event on once', async () => {
    const [a, b] = await relays(2);
    const alice = pool([a!.url, b!.url]);
    const bob = pool([a!.url, b!.url]);
    const got: NostrEvent[] = [];
    const eose = new Set<string>();
    bob.subscribe([{ kinds: [30078], '#t': ['lbc-wallet-test'] }], (e) => got.push(e), (relay) => eose.add(relay));
    await until(() => bob.connected === 2 && eose.size === 2);
    const e = note('hello');
    const results = await alice.publish(e);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    await until(() => got.length === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(got.map((x) => x.id)).toEqual([e.id]);
    expect(a!.events()).toHaveLength(1);
    expect(b!.events()).toHaveLength(1);
  });

  it('still delivers when one relay censors', async () => {
    const [a, b] = await relays(2);
    a!.censor = true;
    const alice = pool([a!.url, b!.url]);
    const bob = pool([a!.url]);
    const carol = pool([a!.url, b!.url]);
    const bobGot: NostrEvent[] = [];
    const carolGot: NostrEvent[] = [];
    bob.subscribe([{ '#t': ['lbc-wallet-test'] }], (e) => bobGot.push(e));
    carol.subscribe([{ '#t': ['lbc-wallet-test'] }], (e) => carolGot.push(e));
    await until(() => bob.connected === 1 && carol.connected === 2);
    await alice.publish(note('can you hear me'));
    await until(() => carolGot.length === 1);
    expect(bobGot).toHaveLength(0);
  });

  it('passes on only signed events that match what was asked for', async () => {
    const [a] = await relays(1);
    const bob = pool([a!.url]);
    const got: NostrEvent[] = [];
    bob.subscribe([{ kinds: [30078], '#t': ['lbc-wallet-test'] }], (e) => got.push(e));
    await until(() => bob.connected === 1);
    const good = note('real');
    a!.inject({ ...good, content: 'forged' });
    a!.inject({ ...good, sig: good.sig.slice(0, -2) + '00' });
    a!.inject(note('another topic', newNostrSecret(), [['t', 'something-else']]));
    a!.inject('not even an event');
    a!.inject(good);
    a!.inject(good);
    await until(() => got.length === 1);
    await new Promise((r) => setTimeout(r, 200));
    expect(got.map((x) => x.content)).toEqual(['real']);
  });

  it('reconnects and asks again after a relay drops the connection', async () => {
    const [a] = await relays(1);
    const alice = pool([a!.url]);
    const bob = pool([a!.url]);
    const got: string[] = [];
    bob.subscribe([{ '#t': ['lbc-wallet-test'] }], (e) => got.push(e.content));
    await until(() => bob.connected === 1 && alice.connected === 1);
    a!.dropConnections();
    await until(() => bob.connected === 0);
    await until(() => bob.connected === 1 && alice.connected === 1);
    await alice.publish(note('after the drop'));
    await until(() => got.length === 1);
    expect(got).toEqual(['after the drop']);
    expect(bob.status()[0]).toMatchObject({ url: a!.url, state: 'open', events: 1 });
  });

  it('reports a relay that is down, and publishes through the others', async () => {
    const [a] = await relays(1);
    const alice = pool([a!.url, 'ws://127.0.0.1:1']);
    await until(() => alice.connected === 1);
    const results = await alice.publish(note('one relay is enough'));
    expect(results.find((r) => r.url === a!.url)?.ok).toBe(true);
    expect(results.find((r) => r.url === 'ws://127.0.0.1:1')?.ok).toBe(false);
    expect(alice.status().find((s) => s.url === 'ws://127.0.0.1:1')?.state).not.toBe('open');
  });

  it('keeps only the newest version of a replaceable event', async () => {
    const [a] = await relays(1);
    const alice = pool([a!.url]);
    const secret = newNostrSecret();
    const tags = [['d', 'offer-1'], ['t', 'lbc-wallet-test']];
    await alice.publish(signEvent({ kind: 30078, tags, content: 'v1', created_at: 1000 }, secret));
    await alice.publish(signEvent({ kind: 30078, tags, content: 'v2', created_at: 1001 }, secret));
    const stale = await alice.publish(signEvent({ kind: 30078, tags, content: 'v0', created_at: 999 }, secret));
    expect(stale[0]!.ok).toBe(true);
    expect(a!.events().map((e) => e.content)).toEqual(['v2']);
  });

  it('follows changes to the relay list', async () => {
    const [a, b] = await relays(2);
    const alice = pool([a!.url]);
    await until(() => alice.connected === 1);
    alice.setRelays([b!.url]);
    await until(() => alice.connected === 1 && a!.connections() === 0 && b!.connections() === 1);
    expect(alice.status().map((s) => s.url)).toEqual([b!.url]);
  });
});
