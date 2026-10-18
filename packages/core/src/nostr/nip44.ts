/**
 * NIP-44 version 2: encryption between two Nostr keys (ECDH on secp256k1,
 * HKDF, ChaCha20, HMAC-SHA256, padded lengths). The market encrypts the
 * messages of a trade with it, so relays and onlookers see only that two keys
 * talk, not what they say. Checked against the official test vectors.
 */
import { base64 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { chacha20 } from '@noble/ciphers/chacha.js';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, fromHex, utf8Decode, utf8Encode } from '../encoding/bytes.js';
import { randomBytes } from '../crypto/hash.js';

const SALT = utf8Encode('nip44-v2');
const MIN_PLAINTEXT = 1;
const MAX_PLAINTEXT = 65535;

/** The shared key of two parties: the same from either side. */
export function conversationKey(secret: Uint8Array, publicKeyHex: string): Uint8Array {
  const shared = secp256k1.getSharedSecret(secret, fromHex('02' + publicKeyHex));
  return extract(sha256, shared.subarray(1, 33), SALT);
}

export function messageKeys(convKey: Uint8Array, nonce: Uint8Array): { chachaKey: Uint8Array; chachaNonce: Uint8Array; hmacKey: Uint8Array } {
  if (convKey.length !== 32) throw new Error('invalid conversation key');
  if (nonce.length !== 32) throw new Error('invalid nonce');
  const keys = expand(sha256, convKey, nonce, 76);
  return { chachaKey: keys.subarray(0, 32), chachaNonce: keys.subarray(32, 44), hmacKey: keys.subarray(44, 76) };
}

export function paddedLength(len: number): number {
  if (!Number.isInteger(len) || len < 1) throw new Error('expected a positive length');
  if (len <= 32) return 32;
  const nextPower = 1 << (Math.floor(Math.log2(len - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((len - 1) / chunk) + 1);
}

function pad(plaintext: string): Uint8Array {
  const unpadded = utf8Encode(plaintext);
  const len = unpadded.length;
  if (len < MIN_PLAINTEXT || len > MAX_PLAINTEXT) throw new Error('invalid plaintext length');
  const out = new Uint8Array(2 + paddedLength(len));
  out[0] = len >> 8;
  out[1] = len & 0xff;
  out.set(unpadded, 2);
  return out;
}

function unpad(padded: Uint8Array): string {
  const len = (padded[0]! << 8) | padded[1]!;
  const unpadded = padded.subarray(2, 2 + len);
  if (len < MIN_PLAINTEXT || len > MAX_PLAINTEXT || unpadded.length !== len || padded.length !== 2 + paddedLength(len)) throw new Error('invalid padding');
  return utf8Decode(unpadded);
}

function mac(key: Uint8Array, message: Uint8Array, aad: Uint8Array): Uint8Array {
  if (aad.length !== 32) throw new Error('invalid associated data');
  return hmac(sha256, key, concatBytes(aad, message));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function nip44Encrypt(plaintext: string, convKey: Uint8Array, nonce: Uint8Array = randomBytes(32)): string {
  const { chachaKey, chachaNonce, hmacKey } = messageKeys(convKey, nonce);
  const ciphertext = chacha20(chachaKey, chachaNonce, pad(plaintext));
  return base64.encode(concatBytes(new Uint8Array([2]), nonce, ciphertext, mac(hmacKey, ciphertext, nonce)));
}

export function nip44Decrypt(payload: string, convKey: Uint8Array): string {
  if (payload.length === 0 || payload[0] === '#') throw new Error('unknown encryption version');
  if (payload.length < 132 || payload.length > 87472) throw new Error('invalid payload length');
  let data: Uint8Array;
  try {
    data = base64.decode(payload);
  } catch {
    throw new Error('invalid base64');
  }
  if (data.length < 99 || data.length > 65603) throw new Error('invalid data length');
  if (data[0] !== 2) throw new Error('unknown encryption version');
  const nonce = data.subarray(1, 33);
  const ciphertext = data.subarray(33, data.length - 32);
  const tag = data.subarray(data.length - 32);
  const { chachaKey, chachaNonce, hmacKey } = messageKeys(convKey, nonce);
  if (!sameBytes(mac(hmacKey, ciphertext, nonce), tag)) throw new Error('invalid MAC');
  return unpad(chacha20(chachaKey, chachaNonce, ciphertext));
}
