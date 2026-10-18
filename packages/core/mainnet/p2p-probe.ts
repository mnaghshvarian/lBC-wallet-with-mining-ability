/**
 * Which LBRY full nodes accept peer-to-peer connections right now? Resolves
 * lbcd's DNS seeds and a list of candidate hosts, connects to port 9246 and
 * exchanges `version` messages (the first step of the LBRY P2P handshake), then
 * disconnects. Nothing is downloaded, mined or relayed.
 *
 *   npx tsx packages/core/mainnet/p2p-probe.ts [host[:port] ...]
 *
 * Prints one line per address and a summary; exits with 1 when no node answers,
 * or when none of the wallet's bootstrap peers (MAINNET.bootstrapPeers) does.
 */
import { connect } from 'node:net';
import { resolve4 } from 'node:dns/promises';
import { ByteReader, ByteWriter } from '../src/encoding/bytes.js';
import { randomBytes, sha256d } from '../src/crypto/hash.js';
import { MAINNET } from '../src/networks.js';

/** lbcd's mainnet DNS seeds (chaincfg/params.go). */
const DNS_SEEDS = ['dnsseed1.lbry.com', 'dnsseed2.lbry.com', 'dnsseed3.lbry.com', 'seed.lbry.grin.io', 'seed.allaboutlbc.com'];
/** Hosts known to run LBRY infrastructure; their full nodes may accept peers too. */
const CANDIDATES = [...(MAINNET.bootstrapPeers ?? []), ...MAINNET.defaultHubs.map((h) => h.host), 'lbrypool.net', 'explorer.lbry.com'];

const MAGIC = 0xf1aae4fa; // wire.MainNet
const PROTOCOL_VERSION = 70013;

function message(command: string, payload: Uint8Array): Uint8Array {
  const name = new Uint8Array(12);
  name.set(new TextEncoder().encode(command));
  return new ByteWriter(24 + payload.length).u32LE(MAGIC).bytes(name).u32LE(payload.length).bytes(sha256d(payload).slice(0, 4)).bytes(payload).toBytes();
}

function netAddress(): Uint8Array {
  // services, IPv6-mapped 0.0.0.0, port 0
  return new ByteWriter(26).u64LE(0n).bytes(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 0, 0])).u16LE(0).toBytes();
}

function versionPayload(): Uint8Array {
  const agent = new TextEncoder().encode('/lbc-wallet-probe:1.0/');
  return new ByteWriter(128)
    .i32LE(PROTOCOL_VERSION)
    .u64LE(0n)
    .u64LE(BigInt(Math.floor(Date.now() / 1000)))
    .bytes(netAddress())
    .bytes(netAddress())
    .bytes(randomBytes(8))
    .varBytes(agent)
    .i32LE(0)
    .u8(0)
    .toBytes();
}

interface PeerVersion {
  version: number;
  userAgent: string;
  height: number;
  /** Addresses the node shared after `getaddr`: "ip:port" with the time it last saw them. */
  known: { address: string; seen: number }[];
}

function parseVersion(payload: Uint8Array): PeerVersion {
  const r = new ByteReader(payload);
  const version = r.u32LE();
  r.bytes(8 + 8 + 26 + 26 + 8); // services, timestamp, addresses, nonce
  const agentLength = r.u8(); // user agents are short: one-byte length
  const userAgent = new TextDecoder().decode(r.bytes(agentLength));
  const height = r.u32LE();
  return { version, userAgent, height, known: [] };
}

function varint(r: ByteReader): number {
  const n = r.u8();
  if (n < 0xfd) return n;
  if (n === 0xfd) return r.u16LE();
  if (n === 0xfe) return r.u32LE();
  return Number(r.u64LE());
}

/** An `addr` message: (time, services, IPv6-mapped address, big-endian port) entries. */
function parseAddr(payload: Uint8Array): { address: string; seen: number }[] {
  const r = new ByteReader(payload);
  const out: { address: string; seen: number }[] = [];
  for (let i = varint(r); i > 0 && r.remaining >= 30; i--) {
    const seen = r.u32LE();
    r.bytes(8);
    const ip = r.bytes(16);
    const port = (r.u8() << 8) | r.u8();
    const v4 = ip.slice(0, 12).every((b, j) => b === (j < 10 ? 0 : 0xff));
    const host = v4 ? [...ip.slice(12)].join('.') : `[${[...Array(8)].map((_, j) => ((ip[2 * j]! << 8) | ip[2 * j + 1]!).toString(16)).join(':')}]`;
    out.push({ address: `${host}:${port}`, seen });
  }
  return out;
}

/**
 * Handshakes with a node and asks it for the addresses it knows. Resolves with
 * its version once it has answered `getaddr` (or after a short wait).
 */
function probe(host: string, port: number, timeoutMs = 10_000): Promise<PeerVersion> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let buffer = Buffer.alloc(0);
    let peer: PeerVersion | null = null;
    let finished = false;
    const done = (err: Error | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      if (peer) resolve(peer);
      else reject(err ?? new Error('no version message'));
    };
    const timer = setTimeout(() => done(new Error(buffer.length ? 'no version message' : 'timeout')), timeoutMs);
    socket.once('connect', () => socket.write(message('version', versionPayload())));
    socket.on('error', (err) => done(err));
    socket.on('close', () => done(new Error('closed by peer')));
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 24) {
        if (buffer.readUInt32LE(0) !== MAGIC) return done(new Error('not an LBRY node (wrong network magic)'));
        const command = buffer.subarray(4, 16).toString('ascii').replace(/\0+$/, '');
        const length = buffer.readUInt32LE(16);
        if (buffer.length < 24 + length) return;
        const payload = new Uint8Array(buffer.subarray(24, 24 + length));
        buffer = buffer.subarray(24 + length);
        if (command === 'version') {
          peer = parseVersion(payload);
          socket.write(message('verack', new Uint8Array(0)));
          socket.write(message('getaddr', new Uint8Array(0)));
          // A node that knows no addresses may not answer at all.
          setTimeout(() => done(null), 5_000);
        } else if (command === 'ping') {
          socket.write(message('pong', payload));
        } else if (command === 'addr' && peer) {
          peer.known.push(...parseAddr(payload));
          if (peer.known.length > 1) return done(null);
        }
      }
    });
  });
}

async function addressesOf(host: string): Promise<string[]> {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return [host];
  try {
    return await resolve4(host);
  } catch (err) {
    console.log(`${host}: does not resolve (${(err as NodeJS.ErrnoException).code ?? (err as Error).message})`);
    return [];
  }
}

async function main() {
  const extra = process.argv.slice(2);
  const targets = new Map<string, { port: number; via: string }>();
  for (const name of [...DNS_SEEDS, ...CANDIDATES, ...extra]) {
    const [host, port] = name.includes(':') ? [name.slice(0, name.lastIndexOf(':')), Number(name.slice(name.lastIndexOf(':') + 1))] : [name, MAINNET.p2pPort];
    const addresses = await addressesOf(host);
    if (DNS_SEEDS.includes(host)) console.log(`${host} → ${addresses.join(', ') || '(none)'}`);
    for (const a of addresses) if (!targets.has(`${a}:${port}`)) targets.set(`${a}:${port}`, { port, via: host });
  }
  const known = new Map<string, number>();
  const answered = new Set<string>();
  const results = await Promise.all(
    [...targets.entries()].map(async ([key, { port, via }]) => {
      const ip = key.slice(0, key.lastIndexOf(':'));
      try {
        const v = await probe(ip, port);
        console.log(`✓ ${key} (${via}): ${v.userAgent}, protocol ${v.version}, height ${v.height}, shared ${v.known.length} addresses`);
        for (const k of v.known) known.set(k.address, Math.max(known.get(k.address) ?? 0, k.seen));
        answered.add(via);
        return true;
      } catch (err) {
        console.log(`✗ ${key} (${via}): ${(err as Error).message}`);
        return false;
      }
    }),
  );
  const ok = results.filter(Boolean).length;
  console.log(`${ok} of ${results.length} addresses answered as LBRY nodes`);

  // Nodes the reachable ones have heard from recently: try those too (one round).
  const dayAgo = Date.now() / 1000 - 24 * 3600;
  const fresh = [...known.entries()].filter(([a, seen]) => seen > dayAgo && !targets.has(a)).sort((a, b) => b[1] - a[1]).slice(0, 60);
  if (fresh.length > 0) {
    console.log(`trying ${fresh.length} of ${known.size} shared addresses seen in the last 24 hours`);
    const second = await Promise.all(
      fresh.map(async ([address]) => {
        const i = address.lastIndexOf(':');
        try {
          const v = await probe(address.slice(0, i).replace(/^\[|\]$/g, ''), Number(address.slice(i + 1)), 8_000);
          console.log(`✓ ${address}: ${v.userAgent}, height ${v.height}`);
          return true;
        } catch (err) {
          console.log(`✗ ${address}: ${(err as Error).message}`);
          return false;
        }
      }),
    );
    console.log(`${second.filter(Boolean).length} of ${second.length} shared addresses answered`);
  }
  const bootstrap = (MAINNET.bootstrapPeers ?? []).map((p) => p.slice(0, p.lastIndexOf(':')));
  if (bootstrap.length > 0) {
    const working = bootstrap.filter((h) => answered.has(h));
    console.log(`bootstrap peers answering: ${working.length} of ${bootstrap.length}${working.length ? ` (${working.join(', ')})` : ''}`);
    if (working.length === 0) process.exit(1);
  }
  if (ok === 0) process.exit(1);
}

void main();
