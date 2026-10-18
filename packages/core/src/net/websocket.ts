/**
 * A small WebSocket client (RFC 6455) over a raw byte stream: enough for Nostr
 * relays (text messages, ping/pong, close). It runs on anything that can open
 * a TCP/TLS socket — Node in the desktop app, the Android plugin — so relay
 * connections follow the app's proxy settings like every other connection.
 * The frame codec is shared with the test relay, which plays the server side.
 */
import { base64 } from '@scure/base';
import { sha1 } from '@noble/hashes/legacy.js';
import { concatBytes, utf8Decode, utf8Encode } from '../encoding/bytes.js';
import { randomBytes } from '../crypto/hash.js';
import type { ByteTransport, ByteTransportFactory, SocketEndpoint } from './transport.js';

const ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** Larger messages close the connection (relays allow up to about 1 MB). */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_HANDSHAKE_BYTES = 16 * 1024;

export const OPCODE = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

/** The value a server must answer in Sec-WebSocket-Accept for a client key. */
export function acceptKey(key: string): string {
  return base64.encode(sha1(utf8Encode(key + ACCEPT_GUID)));
}

/** One frame; clients must mask what they send, servers must not. */
export function encodeFrame(opcode: number, payload: Uint8Array, mask: boolean, fin = true): Uint8Array {
  const len = payload.length;
  const head: number[] = [(fin ? 0x80 : 0) | opcode];
  const maskBit = mask ? 0x80 : 0;
  if (len < 126) head.push(maskBit | len);
  else if (len < 0x10000) head.push(maskBit | 126, len >> 8, len & 0xff);
  else {
    head.push(maskBit | 127, 0, 0, 0, 0);
    head.push((len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff);
  }
  if (!mask) return concatBytes(new Uint8Array(head), payload);
  const key = randomBytes(4);
  const body = new Uint8Array(len);
  for (let i = 0; i < len; i++) body[i] = payload[i]! ^ key[i & 3]!;
  return concatBytes(new Uint8Array(head), key, body);
}

export interface Frame {
  fin: boolean;
  opcode: number;
  payload: Uint8Array;
}

/** Splits a byte stream into frames; `masked` is what the peer must send (true on a server). */
export class FrameDecoder {
  private buffer: Uint8Array = new Uint8Array(0);

  constructor(private readonly masked: boolean) {}

  push(chunk: Uint8Array): Frame[] {
    this.buffer = this.buffer.length ? concatBytes(this.buffer, chunk) : chunk;
    const frames: Frame[] = [];
    for (;;) {
      const b = this.buffer;
      if (b.length < 2) break;
      const fin = (b[0]! & 0x80) !== 0;
      if ((b[0]! & 0x70) !== 0) throw new Error('unsupported WebSocket extension bits');
      const opcode = b[0]! & 0x0f;
      const isMasked = (b[1]! & 0x80) !== 0;
      if (isMasked !== this.masked) throw new Error(this.masked ? 'unmasked client frame' : 'masked server frame');
      let len = b[1]! & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (b.length < 4) break;
        len = (b[2]! << 8) | b[3]!;
        offset = 4;
      } else if (len === 127) {
        if (b.length < 10) break;
        if (b[2] || b[3] || b[4] || b[5]) throw new Error('WebSocket frame too large');
        len = ((b[6]! << 24) >>> 0) + (b[7]! << 16) + (b[8]! << 8) + b[9]!;
        offset = 10;
      }
      if (len > MAX_MESSAGE_BYTES) throw new Error('WebSocket frame too large');
      if (opcode >= 0x8 && (len > 125 || !fin)) throw new Error('invalid WebSocket control frame');
      const keyLen = isMasked ? 4 : 0;
      if (b.length < offset + keyLen + len) break;
      let payload = b.slice(offset + keyLen, offset + keyLen + len);
      if (isMasked) {
        const key = b.subarray(offset, offset + 4);
        for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ key[i & 3]!;
      }
      frames.push({ fin, opcode, payload });
      this.buffer = b.subarray(offset + keyLen + len);
      payload = new Uint8Array(0);
    }
    return frames;
  }
}

/** Joins fragmented text messages and answers control frames. */
export class MessageAssembler {
  private parts: Uint8Array[] = [];
  private size = 0;

  /** Returns a complete text message, or null; throws on a protocol error. */
  frame(f: Frame): string | null {
    if (f.opcode === OPCODE.text || f.opcode === OPCODE.binary) {
      if (this.parts.length) throw new Error('new message inside a fragmented one');
      this.parts = [f.payload];
      this.size = f.payload.length;
      this.binary = f.opcode === OPCODE.binary;
    } else if (f.opcode === OPCODE.continuation) {
      if (!this.parts.length) throw new Error('continuation without a message');
      this.parts.push(f.payload);
      this.size += f.payload.length;
      if (this.size > MAX_MESSAGE_BYTES) throw new Error('WebSocket message too large');
    } else return null;
    if (!f.fin) return null;
    const whole = this.parts.length === 1 ? this.parts[0]! : concatBytes(...this.parts);
    const binary = this.binary;
    this.parts = [];
    this.size = 0;
    // Nostr speaks text; binary messages are not used and are dropped.
    return binary ? null : utf8Decode(whole);
  }

  private binary = false;
}

export interface WebSocketLike {
  connect(): Promise<void>;
  send(text: string): void;
  /** Closes politely (close frame), then the socket. */
  close(): void;
  ping(): void;
  /** When anything (a message, a pong) last arrived (ms); to find dead connections. */
  lastActivity(): number;
  onMessage(handler: (text: string) => void): void;
  onClose(handler: (error?: Error) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

/** Where to connect for a ws:// or wss:// URL. Plain ws:// only for a server on this computer. */
export function parseWebSocketUrl(url: string): { endpoint: SocketEndpoint; path: string; hostHeader: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`not a WebSocket address: ${url}`);
  }
  const tls = u.protocol === 'wss:';
  if (!tls && u.protocol !== 'ws:') throw new Error(`not a WebSocket address: ${url}`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!tls && host !== '127.0.0.1' && host !== 'localhost' && host !== '10.0.2.2') throw new Error('relay addresses must start with wss://');
  if (u.username || u.password) throw new Error('relay addresses cannot contain a user name');
  const port = u.port ? Number(u.port) : tls ? 443 : 80;
  const defaultPort = (tls && port === 443) || (!tls && port === 80);
  return {
    endpoint: { host, port, tls },
    path: (u.pathname || '/') + u.search,
    hostHeader: defaultPort ? u.hostname : `${u.hostname}:${port}`,
  };
}

/** A WebSocket client on a byte transport from `transports`. */
export function createWebSocket(url: string, transports: ByteTransportFactory, options: { handshakeTimeoutMs?: number } = {}): WebSocketLike {
  const { endpoint, path, hostHeader } = parseWebSocketUrl(url);
  let transport: ByteTransport | null = null;
  let messageHandler: (text: string) => void = () => {};
  let closeHandler: (error?: Error) => void = () => {};
  let open = false;
  let closed = false;
  let lastData = 0;
  const decoder = new FrameDecoder(false);
  const assembler = new MessageAssembler();

  const finish = (error?: Error) => {
    if (closed) return;
    closed = true;
    open = false;
    transport?.close();
    closeHandler(error);
  };

  const onFrames = (bytes: Uint8Array) => {
    lastData = Date.now();
    try {
      for (const f of decoder.push(bytes)) {
        if (f.opcode === OPCODE.ping) transport?.send(encodeFrame(OPCODE.pong, f.payload, true));
        else if (f.opcode === OPCODE.close) {
          transport?.send(encodeFrame(OPCODE.close, f.payload.slice(0, 2), true));
          return finish();
        } else if (f.opcode !== OPCODE.pong) {
          const text = assembler.frame(f);
          if (text !== null) messageHandler(text);
        }
      }
    } catch (err) {
      finish(err as Error);
    }
  };

  return {
    connect: () =>
      new Promise<void>((resolve, reject) => {
        const t = transports(endpoint);
        transport = t;
        const key = base64.encode(randomBytes(16));
        let head: Uint8Array = new Uint8Array(0);
        let settled = false;
        const timer = setTimeout(() => fail(new Error('WebSocket handshake timeout')), options.handshakeTimeoutMs ?? 15_000);
        function fail(err: Error) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          closed = true;
          t.close();
          reject(err);
        }
        t.onClose((err) => {
          if (!settled) fail(err ?? new Error('connection closed during the WebSocket handshake'));
          else finish(err);
        });
        t.onData((chunk) => {
          if (open) return onFrames(chunk);
          head = head.length ? concatBytes(head, chunk) : chunk;
          const end = indexOfHeaderEnd(head);
          if (end < 0) {
            if (head.length > MAX_HANDSHAKE_BYTES) fail(new Error('WebSocket handshake too large'));
            return;
          }
          const lines = utf8Decode(head.subarray(0, end)).split('\r\n');
          const status = /^HTTP\/1\.1 (\d{3})/.exec(lines[0] ?? '');
          if (!status || status[1] !== '101') return fail(new Error(`relay refused the WebSocket (${lines[0]?.slice(0, 80) ?? 'no answer'})`));
          const headers = new Map<string, string>();
          for (const line of lines.slice(1)) {
            const i = line.indexOf(':');
            if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
          }
          if (headers.get('upgrade')?.toLowerCase() !== 'websocket' || !/\bupgrade\b/i.test(headers.get('connection') ?? '')) return fail(new Error('not a WebSocket answer'));
          if (headers.get('sec-websocket-accept') !== acceptKey(key)) return fail(new Error('wrong WebSocket accept key'));
          settled = true;
          clearTimeout(timer);
          open = true;
          lastData = Date.now();
          resolve();
          const rest = head.subarray(end + 4);
          head = new Uint8Array(0);
          if (rest.length) onFrames(rest);
        });
        t.connect().then(
          () => {
            const request =
              `GET ${path} HTTP/1.1\r\n` +
              `Host: ${hostHeader}\r\n` +
              'Upgrade: websocket\r\n' +
              'Connection: Upgrade\r\n' +
              `Sec-WebSocket-Key: ${key}\r\n` +
              'Sec-WebSocket-Version: 13\r\n\r\n';
            t.send(utf8Encode(request));
          },
          (err: Error) => fail(err),
        );
      }),
    send: (text) => {
      if (!open || closed) throw new Error('WebSocket is not open');
      transport!.send(encodeFrame(OPCODE.text, utf8Encode(text), true));
    },
    close: () => {
      if (closed) return;
      if (open) {
        try {
          transport?.send(encodeFrame(OPCODE.close, new Uint8Array([0x03, 0xe8]), true));
        } catch {
          // closing anyway
        }
      }
      finish();
    },
    ping: () => {
      if (open && !closed) transport?.send(encodeFrame(OPCODE.ping, new Uint8Array(0), true));
    },
    lastActivity: () => lastData,
    onMessage: (h) => {
      messageHandler = h;
    },
    onClose: (h) => {
      closeHandler = h;
    },
  };
}

function indexOfHeaderEnd(b: Uint8Array): number {
  for (let i = 0; i + 3 < b.length; i++) {
    if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i;
  }
  return -1;
}
