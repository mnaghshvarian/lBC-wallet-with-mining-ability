/**
 * Which LBRY full nodes accept peer-to-peer connections right now? Resolves
 * lbcd's DNS seeds and a list of candidate hosts, connects to port 9246 and
 * exchanges `version` messages (the first step of the LBRY P2P handshake), then
 * disconnects. Nothing is downloaded, mined or relayed.
 *
 *   npx tsx packages/core/mainnet/p2p-probe.ts [host[:port] ...]
 *
 * Prints one line per address and a summary; exits with 1 when no node answers.
 */
import { connect } from 'node:net';
import { resolve4 } from 'node:dns/promises';
import { ByteReader, ByteWriter } from '../src/encoding/bytes.js';
import { randomBytes, sha256d } from '../src/crypto/hash.js';
import { MAINNET } from '../src/networks.js';

/** lbcd's mainnet DNS seeds (chaincfg/params.go). */
const DNS_SEEDS = ['dnsseed1.lbry.com', 'dnsseed2.lbry.com', 'dnsseed3.lbry.com', 'seed.lbry.grin.io', 'seed.allaboutlbc.com'];
/** Hosts known to run LBRY infrastructure; their full nodes may accept peers too. */
const CANDIDATES = [...MAINNET.defaultHubs.map((h) => h.host), 'lbrypool.net', 'explorer.lbry.com'];

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
}

function parseVersion(payload: Uint8Array): PeerVersion {
  const r = new ByteReader(payload);
  const version = r.u32LE();
  r.bytes(8 + 8 + 26 + 26 + 8); // services, timestamp, addresses, nonce
  const agentLength = r.u8(); // user agents are short: one-byte length
  const userAgent = new TextDecoder().decode(r.bytes(agentLength));
  const height = r.u32LE();
  return { version, userAgent, height };
}

function probe(host: string, port: number, timeoutMs = 10_000): Promise<PeerVersion> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let buffer = Buffer.alloc(0);
    const done = (err: Error | null, v?: PeerVersion) => {
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(v!);
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
        const payload = buffer.subarray(24, 24 + length);
        buffer = buffer.subarray(24 + length);
        if (command === 'version') return done(null, parseVersion(new Uint8Array(payload)));
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
  const results = await Promise.all(
    [...targets.entries()].map(async ([key, { port, via }]) => {
      const ip = key.slice(0, key.lastIndexOf(':'));
      try {
        const v = await probe(ip, port);
        console.log(`✓ ${key} (${via}): ${v.userAgent}, protocol ${v.version}, height ${v.height}`);
        return true;
      } catch (err) {
        console.log(`✗ ${key} (${via}): ${(err as Error).message}`);
        return false;
      }
    }),
  );
  const ok = results.filter(Boolean).length;
  console.log(`${ok} of ${results.length} addresses answered as LBRY nodes`);
  if (ok === 0) process.exit(1);
}

void main();
