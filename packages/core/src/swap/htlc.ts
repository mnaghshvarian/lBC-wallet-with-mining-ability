/**
 * Hash time-locked contracts (HTLCs) for cross-chain atomic swaps, in exactly
 * the form Decred's atomicswap tools use, so contracts are interchangeable
 * with them:
 *
 *   OP_IF
 *     OP_SIZE 32 OP_EQUALVERIFY OP_SHA256 <secret hash> OP_EQUALVERIFY
 *     OP_DUP OP_HASH160 <recipient pubkey hash>
 *   OP_ELSE
 *     <locktime> OP_CHECKLOCKTIMEVERIFY OP_DROP
 *     OP_DUP OP_HASH160 <refund pubkey hash>
 *   OP_ENDIF
 *   OP_EQUALVERIFY OP_CHECKSIG
 *
 * The recipient claims the coins by revealing the 32-byte secret; once the
 * locktime (a Unix time) has passed, the sender can take them back. Contracts
 * are paid to as P2SH, which LBC and Bitcoin share, so the same code builds
 * and spends them on both chains.
 */
import { concatBytes, equalBytes } from '../encoding/bytes.js';
import { hash160, sha256 } from '../crypto/hash.js';
import { OP, decompile, p2shScript, pushData, pushNumber, type ScriptChunk } from '../script/script.js';
import { Transaction, SEQUENCE_FINAL } from '../tx/transaction.js';
import { SIGHASH_ALL, legacySighash, publicKeyOf, signDigest } from '../tx/sign.js';
import { encodeBase58Address, type AddressParams } from '../address.js';

const OP_IF = 0x63;
const OP_ELSE = 0x67;
const OP_ENDIF = 0x68;
const OP_SIZE = 0x82;
const OP_SHA256 = 0xa8;
const OP_CHECKLOCKTIMEVERIFY = 0xb1;

export const SECRET_SIZE = 32;
/** nLockTime values from here on are Unix times; below it they are block heights. */
export const LOCKTIME_THRESHOLD = 500_000_000;

export interface HtlcTerms {
  /** SHA-256 of the secret. */
  secretHash: Uint8Array;
  /** Who can claim with the secret. */
  recipientPkh: Uint8Array;
  /** Who can take the coins back after `locktime`. */
  refundPkh: Uint8Array;
  /** Unix time (seconds) after which the refund path opens. */
  locktime: number;
}

const op = (code: number) => new Uint8Array([code]);

export function htlcScript(terms: HtlcTerms): Uint8Array {
  if (terms.secretHash.length !== 32) throw new Error('the secret hash must be 32 bytes');
  if (terms.recipientPkh.length !== 20 || terms.refundPkh.length !== 20) throw new Error('public key hashes must be 20 bytes');
  if (!Number.isInteger(terms.locktime) || terms.locktime < LOCKTIME_THRESHOLD || terms.locktime > 0xffffffff) throw new Error('the locktime must be a Unix time');
  return concatBytes(
    op(OP_IF),
    op(OP_SIZE),
    pushNumber(SECRET_SIZE),
    op(OP.OP_EQUALVERIFY),
    op(OP_SHA256),
    pushData(terms.secretHash),
    op(OP.OP_EQUALVERIFY),
    op(OP.OP_DUP),
    op(OP.OP_HASH160),
    pushData(terms.recipientPkh),
    op(OP_ELSE),
    pushNumber(terms.locktime),
    op(OP_CHECKLOCKTIMEVERIFY),
    op(OP.OP_DROP),
    op(OP.OP_DUP),
    op(OP.OP_HASH160),
    pushData(terms.refundPkh),
    op(OP_ENDIF),
    op(OP.OP_EQUALVERIFY),
    op(OP.OP_CHECKSIG),
  );
}

/** A minimally encoded, non-negative script number of up to 5 bytes. */
function readScriptNumber(chunk: ScriptChunk): number {
  if (chunk.opcode >= OP.OP_1 && chunk.opcode <= OP.OP_16) return chunk.opcode - OP.OP_1 + 1;
  const data = chunk.data;
  if (!data || data.length === 0 || data.length > 5) throw new Error('not a contract: bad locktime');
  if (data[data.length - 1]! & 0x80) throw new Error('not a contract: negative locktime');
  let n = 0;
  for (let i = data.length - 1; i >= 0; i--) n = n * 256 + data[i]!;
  return n;
}

/**
 * Reads the terms of a contract. Throws unless the script is exactly the
 * template above (re-encoding the terms must give the same bytes), so nothing
 * unexpected can hide in a counterparty's contract.
 */
export function parseHtlc(script: Uint8Array): HtlcTerms {
  const c = decompile(script);
  const expected = [OP_IF, OP_SIZE, -1, OP.OP_EQUALVERIFY, OP_SHA256, -1, OP.OP_EQUALVERIFY, OP.OP_DUP, OP.OP_HASH160, -1, OP_ELSE, -1, OP_CHECKLOCKTIMEVERIFY, OP.OP_DROP, OP.OP_DUP, OP.OP_HASH160, -1, OP_ENDIF, OP.OP_EQUALVERIFY, OP.OP_CHECKSIG];
  if (!c || c.length !== expected.length || expected.some((code, i) => code !== -1 && c[i]!.opcode !== code)) throw new Error('not a swap contract');
  if (readScriptNumber(c[2]!) !== SECRET_SIZE) throw new Error('not a swap contract: unexpected secret size');
  const terms: HtlcTerms = {
    secretHash: c[5]!.data ?? new Uint8Array(0),
    recipientPkh: c[9]!.data ?? new Uint8Array(0),
    refundPkh: c[16]!.data ?? new Uint8Array(0),
    locktime: readScriptNumber(c[11]!),
  };
  let canonical: Uint8Array;
  try {
    canonical = htlcScript(terms);
  } catch (err) {
    throw new Error(`not a swap contract: ${(err as Error).message}`);
  }
  if (!equalBytes(canonical, script)) throw new Error('not a swap contract: non-standard encoding');
  return terms;
}

/** The P2SH output script that pays to a contract. */
export function htlcOutputScript(contract: Uint8Array): Uint8Array {
  return p2shScript(hash160(contract));
}

/** The P2SH address of a contract on a chain. */
export function htlcAddress(contract: Uint8Array, network: AddressParams): string {
  return encodeBase58Address(network.scriptHashPrefix, hash160(contract));
}

export function secretHashOf(secret: Uint8Array): Uint8Array {
  if (secret.length !== SECRET_SIZE) throw new Error('the secret must be 32 bytes');
  return sha256(secret);
}

/**
 * The secret revealed by a scriptSig that claims a contract with this secret
 * hash, or null. Any 32-byte push that hashes to it counts, so claims made by
 * other software with a different scriptSig layout are recognised too.
 */
export function extractSecret(scriptSig: Uint8Array, secretHash: Uint8Array, witness: Uint8Array[] = []): Uint8Array | null {
  const pushes = [...(decompile(scriptSig) ?? []).map((ch) => ch.data), ...witness];
  for (const data of pushes) {
    if (data && data.length === SECRET_SIZE && equalBytes(sha256(data), secretHash)) return data.slice();
  }
  return null;
}

export interface HtlcOutpoint {
  txid: string;
  vout: number;
  value: bigint;
}

export interface HtlcSpendParams {
  contract: Uint8Array;
  output: HtlcOutpoint;
  privateKey: Uint8Array;
  /** Output script the coins go to. */
  destination: Uint8Array;
  /** Fee rate in the chain's smallest unit per byte (sat/vB or dewies/byte). */
  feeRate: number;
  /** Smallest output the chain relays. */
  dust: bigint;
  path: { kind: 'redeem'; secret: Uint8Array } | { kind: 'refund' };
}

/** Upper bound of a DER signature plus the sighash byte. */
const MAX_SIG = 73;

function spendScriptSig(sig: Uint8Array, publicKey: Uint8Array, contract: Uint8Array, path: HtlcSpendParams['path']): Uint8Array {
  return path.kind === 'redeem'
    ? concatBytes(pushData(sig), pushData(publicKey), pushData(path.secret), op(OP.OP_1), pushData(contract))
    : concatBytes(pushData(sig), pushData(publicKey), op(OP.OP_0), pushData(contract));
}

/**
 * Builds and signs the transaction that claims (redeem) or takes back (refund)
 * a contract output, paying everything but the fee to `destination`.
 */
export function buildHtlcSpend(params: HtlcSpendParams): { tx: Transaction; fee: bigint } {
  const terms = parseHtlc(params.contract);
  const publicKey = publicKeyOf(params.privateKey);
  const pkh = hash160(publicKey);
  if (params.path.kind === 'redeem') {
    if (!equalBytes(pkh, terms.recipientPkh)) throw new Error('this key cannot claim the contract');
    if (!equalBytes(secretHashOf(params.path.secret), terms.secretHash)) throw new Error('the secret does not match the contract');
  } else if (!equalBytes(pkh, terms.refundPkh)) {
    throw new Error('this key cannot refund the contract');
  }
  // Version 1: standard on both chains, and CHECKLOCKTIMEVERIFY needs nothing newer.
  const tx = new Transaction();
  if (params.path.kind === 'refund') tx.locktime = terms.locktime;
  // A refund needs a non-final input for its locktime to count.
  tx.inputs.push({ txid: params.output.txid, vout: params.output.vout, scriptSig: new Uint8Array(0), sequence: params.path.kind === 'refund' ? SEQUENCE_FINAL - 1 : SEQUENCE_FINAL, witness: [] });
  tx.outputs.push({ value: 0n, script: params.destination });
  // Size with the largest possible signature, then the fee.
  tx.inputs[0]!.scriptSig = spendScriptSig(new Uint8Array(MAX_SIG), publicKey, params.contract, params.path);
  const fee = BigInt(Math.ceil(tx.size * params.feeRate));
  const value = params.output.value - fee;
  if (value < params.dust) throw new Error('the amount is too small to pay the network fee');
  tx.outputs[0]!.value = value;
  const digest = legacySighash(tx, 0, params.contract, SIGHASH_ALL);
  const sig = concatBytes(signDigest(digest, params.privateKey), op(SIGHASH_ALL));
  tx.inputs[0]!.scriptSig = spendScriptSig(sig, publicKey, params.contract, params.path);
  return { tx, fee };
}
