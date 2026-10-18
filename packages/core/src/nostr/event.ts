/**
 * Nostr events (NIP-01): the signed messages relays store and forward. The
 * market uses them for public offers and for the private messages of a
 * trade. Every event is checked here before anything trusts it: its id must
 * be the hash of its content, and its signature (BIP-340 Schnorr) must match
 * its public key.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 as sha256Hasher } from '@noble/hashes/sha2.js';
import { randomBytes, sha256 } from '../crypto/hash.js';
import { fromHex, toHex, utf8Encode } from '../encoding/bytes.js';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface EventTemplate {
  kind: number;
  tags: string[][];
  content: string;
  created_at?: number;
}

/** A relay query (NIP-01); `#x` keys filter on single-letter tags. */
export interface NostrFilter {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [tag: `#${string}`]: string[] | undefined;
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

export function nostrPublicKey(secret: Uint8Array): string {
  return toHex(schnorr.getPublicKey(secret));
}

/** A new random secret key (32 bytes, valid on the curve). */
export function newNostrSecret(): Uint8Array {
  return schnorr.utils.randomSecretKey();
}

export function eventId(e: { pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }): string {
  return toHex(sha256(utf8Encode(JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]))));
}

/** Signs a template with a secret key. */
export function signEvent(template: EventTemplate, secret: Uint8Array): NostrEvent {
  const unsigned = {
    pubkey: nostrPublicKey(secret),
    created_at: template.created_at ?? Math.floor(Date.now() / 1000),
    kind: template.kind,
    tags: template.tags,
    content: template.content,
  };
  const id = eventId(unsigned);
  return { ...unsigned, id, sig: toHex(schnorr.sign(fromHex(id), secret)) };
}

/** Shape, id and signature; false for anything malformed. */
export function verifyEvent(e: unknown): e is NostrEvent {
  const v = e as NostrEvent;
  if (!v || typeof v !== 'object') return false;
  if (typeof v.id !== 'string' || !HEX64.test(v.id) || typeof v.pubkey !== 'string' || !HEX64.test(v.pubkey) || typeof v.sig !== 'string' || !HEX128.test(v.sig)) return false;
  if (!Number.isInteger(v.created_at) || v.created_at < 0 || !Number.isInteger(v.kind) || v.kind < 0 || v.kind > 65535) return false;
  if (typeof v.content !== 'string' || !Array.isArray(v.tags) || !v.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))) return false;
  if (eventId(v) !== v.id) return false;
  try {
    return schnorr.verify(fromHex(v.sig), fromHex(v.id), fromHex(v.pubkey));
  } catch {
    return false;
  }
}

/** The value of the first tag with this name. */
export function tagValue(e: { tags: string[][] }, name: string): string | undefined {
  return e.tags.find((t) => t[0] === name)?.[1];
}

/** Leading zero bits of an event id (NIP-13 proof of work). */
export function leadingZeroBits(idHex: string): number {
  let bits = 0;
  for (const ch of idHex) {
    const nibble = parseInt(ch, 16);
    if (nibble === 0) {
      bits += 4;
      continue;
    }
    bits += Math.clz32(nibble) - 28;
    break;
  }
  return bits;
}

/** Leading zero bits of a hash. */
function zeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

/**
 * Signs a template with NIP-13 proof of work: a nonce tag is changed until the
 * id starts with `difficulty` zero bits (cheap for one message, costly for
 * spam). Only the part of the event after the nonce is hashed again on each
 * try, and the work pauses now and then so the app stays responsive (the
 * services share the UI's thread on Android).
 */
export async function signEventWithWork(template: EventTemplate, secret: Uint8Array, difficulty: number, triesPerPause = 20_000): Promise<NostrEvent> {
  const pubkey = nostrPublicKey(secret);
  const created_at = template.created_at ?? Math.floor(Date.now() / 1000);
  const base = template.tags.filter((t) => t[0] !== 'nonce');
  const marker = toHex(randomBytes(16));
  const json = JSON.stringify([0, pubkey, created_at, template.kind, [...base, ['nonce', marker, String(difficulty)]], template.content]);
  const at = json.indexOf(marker);
  const head = sha256Hasher.create().update(utf8Encode(json.slice(0, at)));
  const tail = utf8Encode(json.slice(at + marker.length));
  for (let n = 0; ; n++) {
    if (n > 0 && n % triesPerPause === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    const hash = head.clone().update(utf8Encode(String(n))).update(tail).digest();
    if (zeroBits(hash) < difficulty) continue;
    const tags = [...base, ['nonce', String(n), String(difficulty)]];
    return { pubkey, created_at, kind: template.kind, tags, content: template.content, id: toHex(hash), sig: toHex(schnorr.sign(hash, secret)) };
  }
}

/** Whether an event matches a filter (used by the test relay and to double-check relays). */
export function matchesFilter(e: NostrEvent, f: NostrFilter): boolean {
  if (f.ids && !f.ids.includes(e.id)) return false;
  if (f.authors && !f.authors.includes(e.pubkey)) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  if (f.since !== undefined && e.created_at < f.since) return false;
  if (f.until !== undefined && e.created_at > f.until) return false;
  for (const key of Object.keys(f)) {
    if (!key.startsWith('#')) continue;
    const values = f[key as `#${string}`];
    if (!values) continue;
    const name = key.slice(1);
    if (!e.tags.some((t) => t[0] === name && t[1] !== undefined && values.includes(t[1]))) return false;
  }
  return true;
}
