import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FrameDecoder,
  MessageAssembler,
  OPCODE,
  acceptKey,
  conversationKey,
  createWebSocket,
  encodeFrame,
  eventId,
  fromHex,
  leadingZeroBits,
  matchesFilter,
  messageKeys,
  newNostrSecret,
  nip44Decrypt,
  nip44Encrypt,
  nostrPublicKey,
  paddedLength,
  parseWebSocketUrl,
  signEvent,
  signEventWithWork,
  toHex,
  utf8Decode,
  utf8Encode,
  verifyEvent,
  type ByteTransport,
} from '../src/index';

// The official NIP-44 test vectors (nip44.vectors.json from the NIP-44 reference
// implementation; sha256 269ed0f69e4c192512cc779e78c555090cebc7c785b609e338a62afc3ce25040).
const vectors = JSON.parse(readFileSync(new URL('./vectors/nip44.vectors.json', import.meta.url), 'utf8')).v2;

describe('WebSocket frames (RFC 6455)', () => {
  it('computes the accept key of the RFC example', () => {
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('round-trips frames of every length class, masked and not, fed one byte at a time', () => {
    for (const len of [0, 1, 125, 126, 1000, 65535, 65536, 200_000]) {
      const payload = new Uint8Array(len).map((_, i) => (i * 7) & 0xff);
      for (const masked of [true, false]) {
        const wire = encodeFrame(OPCODE.binary, payload, masked);
        const decoder = new FrameDecoder(masked);
        const frames = [];
        if (len < 2000) for (let i = 0; i < wire.length; i++) frames.push(...decoder.push(wire.subarray(i, i + 1)));
        else frames.push(...decoder.push(wire.subarray(0, 5)), ...decoder.push(wire.subarray(5)));
        expect(frames).toHaveLength(1);
        expect(frames[0]!.fin).toBe(true);
        expect(frames[0]!.opcode).toBe(OPCODE.binary);
        expect(toHex(frames[0]!.payload)).toBe(toHex(payload));
      }
    }
  });

  it('decodes several frames from one chunk', () => {
    const wire = new Uint8Array([...encodeFrame(OPCODE.text, utf8Encode('one'), false), ...encodeFrame(OPCODE.ping, new Uint8Array(0), false), ...encodeFrame(OPCODE.text, utf8Encode('two'), false)]);
    const frames = new FrameDecoder(false).push(wire);
    expect(frames.map((f) => [f.opcode, utf8Decode(f.payload)])).toEqual([
      [OPCODE.text, 'one'],
      [OPCODE.ping, ''],
      [OPCODE.text, 'two'],
    ]);
  });

  it('refuses frames a peer must not send', () => {
    expect(() => new FrameDecoder(false).push(encodeFrame(OPCODE.text, utf8Encode('x'), true))).toThrow(/masked server frame/);
    expect(() => new FrameDecoder(true).push(encodeFrame(OPCODE.text, utf8Encode('x'), false))).toThrow(/unmasked client frame/);
    expect(() => new FrameDecoder(false).push(new Uint8Array([0xc1, 0x00]))).toThrow(/extension/);
    expect(() => new FrameDecoder(false).push(encodeFrame(OPCODE.ping, new Uint8Array(126), false))).toThrow(/control frame/);
    expect(() => new FrameDecoder(false).push(new Uint8Array([0x81, 127, 0, 0, 0, 1, 0, 0, 0, 0]))).toThrow(/too large/);
  });

  it('joins fragmented text and drops binary messages', () => {
    const a = new MessageAssembler();
    expect(a.frame({ fin: false, opcode: OPCODE.text, payload: utf8Encode('hel') })).toBeNull();
    expect(a.frame({ fin: false, opcode: OPCODE.continuation, payload: utf8Encode('lo ') })).toBeNull();
    expect(a.frame({ fin: true, opcode: OPCODE.continuation, payload: utf8Encode('world') })).toBe('hello world');
    expect(a.frame({ fin: true, opcode: OPCODE.binary, payload: new Uint8Array([1, 2]) })).toBeNull();
    expect(() => a.frame({ fin: true, opcode: OPCODE.continuation, payload: new Uint8Array(0) })).toThrow(/continuation/);
  });

  it('accepts only wss:// addresses, and ws:// on this computer', () => {
    expect(parseWebSocketUrl('wss://relay.example.org')).toEqual({ endpoint: { host: 'relay.example.org', port: 443, tls: true }, path: '/', hostHeader: 'relay.example.org' });
    expect(parseWebSocketUrl('wss://relay.example.org:7777/nostr?x=1')).toEqual({
      endpoint: { host: 'relay.example.org', port: 7777, tls: true },
      path: '/nostr?x=1',
      hostHeader: 'relay.example.org:7777',
    });
    expect(parseWebSocketUrl('ws://127.0.0.1:7000').endpoint).toEqual({ host: '127.0.0.1', port: 7000, tls: false });
    expect(() => parseWebSocketUrl('ws://relay.example.org')).toThrow(/wss/);
    expect(() => parseWebSocketUrl('https://relay.example.org')).toThrow(/not a WebSocket/);
    expect(() => parseWebSocketUrl('wss://user:pw@relay.example.org')).toThrow(/user name/);
  });
});

/** A byte transport wired to a tiny in-memory WebSocket server. */
function fakeServer(answer: (key: string) => string) {
  const sent: string[] = [];
  let toClient: (data: Uint8Array) => void = () => {};
  let closeClient: (err?: Error) => void = () => {};
  const decoder = new FrameDecoder(true);
  let handshaken = false;
  const transport: ByteTransport = {
    connect: async () => undefined,
    send: (data) => {
      if (!handshaken) {
        handshaken = true;
        const key = /Sec-WebSocket-Key: (\S+)/.exec(utf8Decode(data))![1]!;
        // The answer and a first message in the same chunk.
        toClient(new Uint8Array([...utf8Encode(answer(key)), ...encodeFrame(OPCODE.text, utf8Encode('["NOTICE","hi"]'), false)]));
        return;
      }
      for (const f of decoder.push(data)) {
        if (f.opcode === OPCODE.text) {
          sent.push(utf8Decode(f.payload));
          toClient(encodeFrame(OPCODE.text, f.payload, false));
        } else if (f.opcode === OPCODE.ping) toClient(encodeFrame(OPCODE.pong, f.payload, false));
        else if (f.opcode === OPCODE.close) closeClient();
      }
    },
    close: () => closeClient(),
    onData: (h) => (toClient = h),
    onClose: (h) => (closeClient = h),
  };
  return { transport, sent, serverPing: () => toClient(encodeFrame(OPCODE.ping, utf8Encode('p'), false)) };
}

const goodAnswer = (key: string) => `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`;

describe('WebSocket client', () => {
  it('opens, receives the first message in the handshake chunk, and echoes', async () => {
    const server = fakeServer(goodAnswer);
    const ws = createWebSocket('wss://relay.example.org', () => server.transport);
    const got: string[] = [];
    ws.onMessage((m) => got.push(m));
    await ws.connect();
    ws.send('["REQ","x",{}]');
    expect(server.sent).toEqual(['["REQ","x",{}]']);
    expect(got).toEqual(['["NOTICE","hi"]', '["REQ","x",{}]']);
    expect(ws.lastActivity()).toBeGreaterThan(0);
    ws.close();
    expect(() => ws.send('late')).toThrow(/not open/);
  });

  it('refuses a server that does not prove it read the key', async () => {
    const server = fakeServer(() => 'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: AAAA\r\n\r\n');
    await expect(createWebSocket('wss://relay.example.org', () => server.transport).connect()).rejects.toThrow(/accept key/);
  });

  it('refuses an answer that is not an upgrade', async () => {
    const server = fakeServer(() => 'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
    await expect(createWebSocket('wss://relay.example.org', () => server.transport).connect()).rejects.toThrow(/refused the WebSocket \(HTTP\/1.1 403/);
  });
});

describe('NIP-44 v2 encryption (official vectors)', () => {
  it('derives conversation keys', () => {
    for (const v of vectors.valid.get_conversation_key) expect(toHex(conversationKey(fromHex(v.sec1), v.pub2))).toBe(v.conversation_key);
  });

  it('refuses invalid keys', () => {
    for (const v of vectors.invalid.get_conversation_key) expect(() => conversationKey(fromHex(v.sec1), v.pub2), v.note).toThrow();
  });

  it('derives message keys', () => {
    const { conversation_key, keys } = vectors.valid.get_message_keys;
    for (const k of keys) {
      const m = messageKeys(fromHex(conversation_key), fromHex(k.nonce));
      expect([toHex(m.chachaKey), toHex(m.chachaNonce), toHex(m.hmacKey)]).toEqual([k.chacha_key, k.chacha_nonce, k.hmac_key]);
    }
  });

  it('pads lengths', () => {
    for (const [len, padded] of vectors.valid.calc_padded_len) expect(paddedLength(len)).toBe(padded);
  });

  it('encrypts and decrypts', () => {
    for (const v of vectors.valid.encrypt_decrypt) {
      const key = conversationKey(fromHex(v.sec1), nostrPublicKey(fromHex(v.sec2)));
      expect(toHex(key)).toBe(v.conversation_key);
      expect(nip44Encrypt(v.plaintext, key, fromHex(v.nonce))).toBe(v.payload);
      expect(nip44Decrypt(v.payload, key)).toBe(v.plaintext);
    }
  });

  it('refuses plaintexts of invalid lengths', () => {
    const key = new Uint8Array(32).fill(1);
    for (const len of vectors.invalid.encrypt_msg_lengths) expect(() => nip44Encrypt('x'.repeat(len), key)).toThrow();
  });

  it('refuses damaged or forged payloads', () => {
    for (const v of vectors.invalid.decrypt) expect(() => nip44Decrypt(v.payload, fromHex(v.conversation_key)), v.note).toThrow();
  });
});

describe('Nostr events', () => {
  it('signs events that verify, and detects any change', () => {
    const secret = newNostrSecret();
    const e = signEvent({ kind: 30078, tags: [['d', 'x'], ['t', 'y']], content: 'hello', created_at: 1_700_000_000 }, secret);
    expect(e.pubkey).toBe(nostrPublicKey(secret));
    expect(e.id).toBe(eventId(e));
    expect(verifyEvent(e)).toBe(true);
    expect(verifyEvent({ ...e, content: 'hellO' })).toBe(false);
    expect(verifyEvent({ ...e, tags: [['d', 'x']] })).toBe(false);
    expect(verifyEvent({ ...e, sig: e.sig.replace(/^./, e.sig[0] === 'a' ? 'b' : 'a') })).toBe(false);
    const other = signEvent({ kind: 30078, tags: [], content: 'hello', created_at: 1_700_000_000 }, newNostrSecret());
    expect(verifyEvent({ ...e, pubkey: other.pubkey })).toBe(false);
    expect(verifyEvent(null)).toBe(false);
    expect(verifyEvent({ ...e, created_at: 1.5 })).toBe(false);
  });

  it('computes ids the way every Nostr client does', () => {
    // NIP-01 serialisation: [0, pubkey, created_at, kind, tags, content] as compact JSON, UTF-8.
    const e = { pubkey: 'a'.repeat(64), created_at: 1, kind: 1, tags: [['e', 'b']], content: 'é\n"' };
    expect(eventId(e)).toBe(createHash('sha256').update(`[0,"${'a'.repeat(64)}",1,1,[["e","b"]],"é\\n\\""]`).digest('hex'));
  });

  it('adds proof of work', async () => {
    expect(leadingZeroBits('0'.repeat(64))).toBe(256);
    expect(leadingZeroBits('00f' + '0'.repeat(61))).toBe(8);
    expect(leadingZeroBits('1' + '0'.repeat(63))).toBe(3);
    const e = await signEventWithWork({ kind: 1, tags: [['t', 'x'], ['nonce', '9', '1']], content: 'work' }, newNostrSecret(), 10, 100);
    expect(leadingZeroBits(e.id)).toBeGreaterThanOrEqual(10);
    expect(e.tags.filter((t) => t[0] === 'nonce')).toHaveLength(1);
    expect(e.tags.find((t) => t[0] === 'nonce')![2]).toBe('10');
    expect(verifyEvent(e)).toBe(true);
  });

  it('matches filters', () => {
    const e = signEvent({ kind: 30078, tags: [['t', 'a'], ['t', 'b'], ['p', 'c'.repeat(64)]], content: '', created_at: 100 }, newNostrSecret());
    expect(matchesFilter(e, { kinds: [30078], '#t': ['b'] })).toBe(true);
    expect(matchesFilter(e, { kinds: [1] })).toBe(false);
    expect(matchesFilter(e, { '#t': ['z'] })).toBe(false);
    expect(matchesFilter(e, { '#t': ['a'], '#p': ['c'.repeat(64)] })).toBe(true);
    expect(matchesFilter(e, { since: 101 })).toBe(false);
    expect(matchesFilter(e, { until: 99 })).toBe(false);
    expect(matchesFilter(e, { authors: [e.pubkey], ids: [e.id] })).toBe(true);
  });
});
