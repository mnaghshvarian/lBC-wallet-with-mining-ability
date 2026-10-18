/**
 * Shared by the swap and order board tests: paying from the regtest miners
 * (a stand-in for someone's other wallet) and reading what an address got.
 */
import {
  BITCOIN_NETWORKS,
  SEQUENCE_FINAL,
  Transaction,
  addressFromPublicKey,
  addressToScript,
  encodeSegwitAddress,
  hash160,
  p2pkhScript,
  publicKeyOf,
  signP2pkhInput,
  type AddressParams,
} from '@lbcwallet/core';
import type { RegtestNode } from '../../core/e2e/harness';

export const PASSWORD = 'correct horse battery staple';
export const LBC_MINER_KEY = new Uint8Array(32).fill(7);
export const BTC_MINER_KEY = new Uint8Array(32).fill(9);
export const BTC = BITCOIN_NETWORKS.regtest;

interface VerboseTx {
  txid: string;
  vin: { coinbase?: string }[];
  vout: { value: number; n: number; scriptPubKey: { hex: string } }[];
  confirmations?: number;
}

/** Pays from the miner's mature coinbase outputs (a stand-in for someone's other wallet). */
export async function payFromMiner(node: RegtestNode, key: Uint8Array, network: AddressParams, to: Uint8Array, amount: bigint, feePerByte: number, used: Set<string>): Promise<string> {
  const pub = publicKeyOf(key);
  const from = addressFromPublicKey(pub, network);
  const txs = await node.rpc.call<VerboseTx[]>('searchrawtransactions', [from, 1, 0, 2000]);
  const tx = new Transaction();
  let total = 0n;
  for (const t of txs) {
    if (t.vin[0]?.coinbase === undefined || (t.confirmations ?? 0) <= 100 || used.has(t.txid)) continue;
    used.add(t.txid);
    tx.inputs.push({ txid: t.txid, vout: 0, scriptSig: new Uint8Array(0), sequence: SEQUENCE_FINAL, witness: [] });
    total += BigInt(Math.round(t.vout[0]!.value * 1e8));
    if (total >= amount + BigInt((tx.inputs.length * 148 + 100) * feePerByte) + 100_000n) break;
  }
  const fee = BigInt((tx.inputs.length * 148 + 100) * feePerByte);
  if (total < amount + fee) throw new Error('the test miner has too few mature coins');
  tx.outputs.push({ value: amount, script: to });
  if (total - amount - fee > 100_000n) tx.outputs.push({ value: total - amount - fee, script: p2pkhScript(hash160(pub)) });
  for (let i = 0; i < tx.inputs.length; i++) signP2pkhInput(tx, i, p2pkhScript(hash160(pub)), key);
  return node.rpc.call<string>('sendrawtransaction', [tx.toHex()]);
}

/** Satoshis paid to an address on the Bitcoin node. */
export async function receivedBtc(node: RegtestNode, address: string): Promise<bigint> {
  const script = Buffer.from(addressToScript(address, BTC)).toString('hex');
  let txs: VerboseTx[] = [];
  try {
    txs = await node.rpc.call<VerboseTx[]>('searchrawtransactions', [address, 1, 0, 100]);
  } catch {
    return 0n;
  }
  let total = 0n;
  for (const t of txs) for (const o of t.vout) if (o.scriptPubKey.hex === script && (t.confirmations ?? 0) > 0) total += BigInt(Math.round(o.value * 1e8));
  return total;
}

export const btcAddress = (seed: number) => encodeSegwitAddress(0, hash160(publicKeyOf(new Uint8Array(32).fill(seed))), BTC);
