/**
 * A small Nostr relay (NIP-01, with replaceable events and NIP-40 expiry) on a
 * local port, speaking WebSocket over plain TCP. The order board tests run the
 * wallet's real relay client against it, and the development network offers it
 * at ws://127.0.0.1:<port>.
 */
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { FrameDecoder, MessageAssembler, OPCODE, acceptKey, encodeFrame } from '../src/net/websocket.js';
import { matchesFilter, tagValue, verifyEvent, type NostrEvent, type NostrFilter } from '../src/nostr/event.js';
import { concatBytes, utf8Decode, utf8Encode } from '../src/encoding/bytes.js';

export interface TestRelay {
  url: string;
  port: number;
  /** Events stored now. */
  events(): NostrEvent[];
  /** Open connections. */
  connections(): number;
  /** Drops every connection (clients should reconnect). */
  dropConnections(): void;
  /** While true, events are accepted with OK but neither stored nor forwarded (a censoring relay). */
  censor: boolean;
  /** Sends anything as an event to every subscription, unchecked (a dishonest relay). */
  inject(event: unknown): void;
  close(): Promise<void>;
}

interface Client {
  socket: net.Socket;
  subs: Map<string, NostrFilter[]>;
  send(message: unknown[]): void;
}

const isReplaceable = (kind: number) => kind === 0 || kind === 3 || (kind >= 10_000 && kind < 20_000);
const isAddressable = (kind: number) => kind >= 30_000 && kind < 40_000;
const isEphemeral = (kind: number) => kind >= 20_000 && kind < 30_000;

export async function startTestRelay(port = 0): Promise<TestRelay> {
  let stored: NostrEvent[] = [];
  const clients = new Set<Client>();
  const now = () => Math.floor(Date.now() / 1000);
  const expired = (e: NostrEvent) => {
    const exp = Number(tagValue(e, 'expiration'));
    return Number.isFinite(exp) && exp > 0 && exp <= now();
  };
  const sameSlot = (a: NostrEvent, b: NostrEvent) =>
    a.pubkey === b.pubkey && a.kind === b.kind && (isReplaceable(a.kind) || (isAddressable(a.kind) && (tagValue(a, 'd') ?? '') === (tagValue(b, 'd') ?? '')));
  const newer = (a: NostrEvent, b: NostrEvent) => a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);

  const relay: TestRelay = {
    url: '',
    port: 0,
    censor: false,
    events: () => stored.filter((e) => !expired(e)),
    connections: () => clients.size,
    dropConnections: () => {
      for (const c of clients) c.socket.destroy();
    },
    inject: (event) => {
      for (const c of clients) for (const subId of c.subs.keys()) c.send(['EVENT', subId, event]);
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of clients) c.socket.destroy();
        server.close(() => resolve());
      }),
  };

  function onEvent(client: Client, e: unknown): void {
    const id = (e as NostrEvent)?.id;
    if (!verifyEvent(e)) return client.send(['OK', typeof id === 'string' ? id : '', false, 'invalid: bad id or signature']);
    if (expired(e)) return client.send(['OK', e.id, false, 'invalid: event has expired']);
    if (relay.censor) return client.send(['OK', e.id, true, '']);
    if (stored.some((x) => x.id === e.id)) return client.send(['OK', e.id, true, 'duplicate: already have this event']);
    if (!isEphemeral(e.kind)) {
      if (isReplaceable(e.kind) || isAddressable(e.kind)) {
        const current = stored.find((x) => sameSlot(x, e));
        if (current && !newer(e, current)) return client.send(['OK', e.id, true, 'duplicate: have a newer version']);
        stored = stored.filter((x) => !sameSlot(x, e));
      }
      stored.push(e);
    }
    client.send(['OK', e.id, true, '']);
    for (const c of clients) {
      for (const [subId, filters] of c.subs) if (filters.some((f) => matchesFilter(e, f))) c.send(['EVENT', subId, e]);
    }
  }

  function onReq(client: Client, subId: unknown, filters: unknown[]): void {
    if (typeof subId !== 'string' || subId.length > 64) return client.send(['NOTICE', 'invalid subscription id']);
    const fs = filters.filter((f): f is NostrFilter => !!f && typeof f === 'object');
    client.subs.set(subId, fs);
    const seen = new Set<string>();
    for (const f of fs) {
      const matches = relay
        .events()
        .filter((e) => matchesFilter(e, f))
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, typeof f.limit === 'number' ? f.limit : 500);
      for (const e of matches) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        client.send(['EVENT', subId, e]);
      }
    }
    client.send(['EOSE', subId]);
  }

  const server = net.createServer((socket) => {
    let head: Uint8Array = new Uint8Array(0);
    let open = false;
    const decoder = new FrameDecoder(true);
    const assembler = new MessageAssembler();
    const client: Client = {
      socket,
      subs: new Map(),
      send: (message) => {
        if (open && !socket.destroyed) socket.write(encodeFrame(OPCODE.text, utf8Encode(JSON.stringify(message)), false));
      },
    };
    socket.on('error', () => undefined);
    socket.on('close', () => clients.delete(client));
    socket.on('data', (chunk: Buffer) => {
      let data: Uint8Array = new Uint8Array(chunk);
      if (!open) {
        head = concatBytes(head, data);
        const text = utf8Decode(head);
        const end = text.indexOf('\r\n\r\n');
        if (end < 0) return;
        const key = /\r\nSec-WebSocket-Key:\s*(\S+)/i.exec(text)?.[1];
        if (!key || !/^GET /.test(text)) {
          socket.end('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n');
          return;
        }
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
        open = true;
        clients.add(client);
        data = head.subarray(utf8Encode(text.slice(0, end + 4)).length);
        head = new Uint8Array(0);
        if (!data.length) return;
      }
      try {
        for (const f of decoder.push(data)) {
          if (f.opcode === OPCODE.ping) socket.write(encodeFrame(OPCODE.pong, f.payload, false));
          else if (f.opcode === OPCODE.close) {
            socket.write(encodeFrame(OPCODE.close, f.payload.slice(0, 2), false));
            socket.end();
          } else if (f.opcode !== OPCODE.pong) {
            const text = assembler.frame(f);
            if (text === null) continue;
            let msg: unknown;
            try {
              msg = JSON.parse(text);
            } catch {
              client.send(['NOTICE', 'could not parse message']);
              continue;
            }
            if (!Array.isArray(msg)) continue;
            if (msg[0] === 'EVENT') onEvent(client, msg[1]);
            else if (msg[0] === 'REQ') onReq(client, msg[1], msg.slice(2));
            else if (msg[0] === 'CLOSE' && typeof msg[1] === 'string') client.subs.delete(msg[1]);
          }
        }
      } catch {
        socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  relay.port = (server.address() as AddressInfo).port;
  relay.url = `ws://127.0.0.1:${relay.port}`;
  return relay;
}
