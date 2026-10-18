/**
 * Swap codes: the short texts the two people copy into their chat to set up a
 * swap. They hold only public data (amounts, key hashes, contracts and
 * transaction ids), so a code read by someone else reveals nothing that could
 * be used to take the coins; each wallet checks everything on-chain anyway.
 *
 *   lbcswap:<base64url JSON>.<checksum>
 */
import { base64urlnopad } from '@scure/base';
import { fromHex, isHex, toHex, utf8Decode, utf8Encode } from '../encoding/bytes.js';
import { sha256 } from '../crypto/hash.js';
import type { NetworkName } from '../networks.js';
import type { SwapCoin } from './protocol.js';

const PREFIX = 'lbcswap:';

/** The starter's offer: the agreed amounts and the key hash the starter is paid to. */
export interface SwapInvite {
  type: 'invite';
  network: NetworkName;
  /** Random id both wallets file the swap under. */
  id: string;
  /** What the starter gives (the joiner gives the other coin). */
  starterGives: SwapCoin;
  /** Agreed amounts in dewies and satoshis. */
  lbc: bigint;
  btc: bigint;
  /** Key hash the starter claims the joiner's coins with. */
  starterPkh: Uint8Array;
}

/** A side's locked contract. The joiner's also carries the key hash the joiner is paid to. */
export interface SwapLock {
  type: 'lock';
  network: NetworkName;
  id: string;
  /** Chain of the contract. */
  coin: SwapCoin;
  contract: Uint8Array;
  txid: string;
  vout: number;
  joinerPkh?: Uint8Array;
}

export type SwapCode = SwapInvite | SwapLock;

function checksum(body: string): string {
  return toHex(sha256(utf8Encode(body)).slice(0, 4));
}

export function encodeSwapCode(code: SwapCode): string {
  const json =
    code.type === 'invite'
      ? { t: 'invite', v: 1, n: code.network, id: code.id, g: code.starterGives, l: code.lbc.toString(), b: code.btc.toString(), p: toHex(code.starterPkh) }
      : { t: 'lock', v: 1, n: code.network, id: code.id, c: code.coin, s: toHex(code.contract), x: code.txid, o: code.vout, ...(code.joinerPkh ? { p: toHex(code.joinerPkh) } : {}) };
  const body = base64urlnopad.encode(utf8Encode(JSON.stringify(json)));
  return `${PREFIX}${body}.${checksum(body)}`;
}

const NETWORKS: NetworkName[] = ['mainnet', 'testnet', 'regtest'];
const COINS: SwapCoin[] = ['LBC', 'BTC'];

function fail(): never {
  throw new Error('This is not a valid swap code. Copy the whole code, from "lbcswap:" to the end.');
}

function amount(v: unknown): bigint {
  if (typeof v !== 'string' || !/^[1-9]\d{0,17}$/.test(v)) fail();
  return BigInt(v);
}

function hex(v: unknown, bytes?: number): Uint8Array {
  if (typeof v !== 'string' || !isHex(v, bytes)) fail();
  return fromHex(v);
}

/** Reads a swap code; throws a user-readable error when it is damaged or incomplete. */
export function decodeSwapCode(text: string): SwapCode {
  const trimmed = text.replace(/\s+/g, '');
  if (!trimmed.startsWith(PREFIX)) fail();
  const [body, sum] = trimmed.slice(PREFIX.length).split('.');
  if (!body || !sum || checksum(body) !== sum.toLowerCase()) fail();
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(utf8Decode(base64urlnopad.decode(body))) as Record<string, unknown>;
  } catch {
    fail();
  }
  if (j.v !== 1) throw new Error('This swap code comes from a newer version of LBC Wallet. Update the app.');
  const network = j.n as NetworkName;
  if (!NETWORKS.includes(network) || typeof j.id !== 'string' || !/^[0-9a-f]{16}$/.test(j.id)) fail();
  if (j.t === 'invite') {
    const starterGives = j.g as SwapCoin;
    if (!COINS.includes(starterGives)) fail();
    return { type: 'invite', network, id: j.id, starterGives, lbc: amount(j.l), btc: amount(j.b), starterPkh: hex(j.p, 20) };
  }
  if (j.t === 'lock') {
    const coin = j.c as SwapCoin;
    if (!COINS.includes(coin) || typeof j.x !== 'string' || !isHex(j.x, 32) || typeof j.o !== 'number' || !Number.isInteger(j.o) || j.o < 0 || j.o > 10_000) fail();
    const contract = hex(j.s);
    if (contract.length > 200) fail();
    return { type: 'lock', network, id: j.id, coin, contract, txid: j.x, vout: j.o, ...(j.p !== undefined ? { joinerPkh: hex(j.p, 20) } : {}) };
  }
  fail();
}
