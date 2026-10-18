import { ByteWriter, concatBytes, fromHex, hashFromHex, isHex, toHex, utf8Encode } from '../encoding/bytes.js';
import { sha256d } from '../crypto/hash.js';
import { bitsToTarget } from '../crypto/pow.js';
import { pushData, pushNumber } from '../script/script.js';
import { Transaction } from '../tx/transaction.js';
import { coinbaseMerkleBranch } from '../wallet/verify.js';
import { assembleHeader, merkleRootFromCoinbase, type WorkUnit } from './work.js';
import type { LbcdRpc } from '../net/lbcd.js';

/** Subset of BIP22 getblocktemplate fields returned by lbcd (with the LBRY `claimtrie` field). */
export interface BlockTemplate {
  version: number;
  previousblockhash: string;
  claimtrie: string;
  bits: string;
  curtime: number;
  mintime?: number;
  maxtime?: number;
  height: number;
  coinbasevalue: number;
  target?: string;
  longpollid?: string;
  default_witness_commitment?: string;
  transactions: { data: string; txid?: string; hash: string }[];
}

export function validateTemplate(t: BlockTemplate): BlockTemplate {
  if (!t || typeof t.height !== 'number' || !isHex(t.previousblockhash, 32)) throw new Error('invalid block template');
  if (!isHex(t.claimtrie ?? '', 32)) throw new Error('block template has no claimtrie root — is this an LBRY node?');
  if (typeof t.coinbasevalue !== 'number') throw new Error('node did not provide coinbasevalue');
  return t;
}

const COINBASE_TAG = '/LBC Wallet/';

/**
 * Solo mining work built from a node's block template: our own coinbase pays
 * the full reward to the wallet address. Extranonce space lives in the coinbase
 * scriptSig so every worker thread mines a distinct header.
 */
export class SoloTemplateWork {
  readonly template: BlockTemplate;
  readonly blockTarget: bigint;
  private readonly branch: Uint8Array[];
  private readonly txids: string[];

  constructor(
    template: BlockTemplate,
    private readonly payoutScript: Uint8Array,
    private readonly tag = COINBASE_TAG,
  ) {
    this.template = validateTemplate(template);
    this.blockTarget = bitsToTarget(parseInt(template.bits, 16));
    this.txids = template.transactions.map((t) => t.txid ?? Transaction.fromHex(t.data).txid);
    this.branch = coinbaseMerkleBranch(this.txids);
  }

  get height(): number {
    return this.template.height;
  }

  get jobId(): string {
    return `${this.template.height}:${this.template.previousblockhash.slice(0, 16)}:${this.template.longpollid ?? this.template.curtime}`;
  }

  /** Coinbase transaction for an 8-byte extranonce. */
  coinbase(extranonce: Uint8Array): Transaction {
    const tx = new Transaction();
    tx.version = 1;
    const scriptSig = concatBytes(pushNumber(this.template.height), pushData(extranonce), pushData(utf8Encode(this.tag)));
    if (scriptSig.length > 100) throw new Error('coinbase script too long');
    tx.inputs.push({ txid: '0'.repeat(64), vout: 0xffffffff, scriptSig, sequence: 0xffffffff, witness: [] });
    tx.outputs.push({ value: BigInt(this.template.coinbasevalue), script: this.payoutScript });
    if (this.template.default_witness_commitment) {
      tx.outputs.push({ value: 0n, script: fromHex(this.template.default_witness_commitment) });
      tx.inputs[0]!.witness = [new Uint8Array(32)];
    }
    return tx;
  }

  work(extranonce: Uint8Array, time = this.template.curtime): WorkUnit & { coinbaseHex: string } {
    const cb = this.coinbase(extranonce);
    const merkleRoot = merkleRootFromCoinbase(sha256d(cb.toBytes({ witness: false })), this.branch);
    const header = assembleHeader({
      version: this.template.version,
      prevHash: hashFromHex(this.template.previousblockhash),
      merkleRoot,
      claimTrie: hashFromHex(this.template.claimtrie),
      time,
      bits: parseInt(this.template.bits, 16),
    });
    return { jobId: this.jobId, header, target: this.blockTarget, blockTarget: this.blockTarget, extranonce2: toHex(extranonce), ntime: time, coinbaseHex: cb.toHex(), stopOnHit: true };
  }

  /** Full serialized block for `submitblock`. */
  serializeBlock(headerWithNonce: Uint8Array, coinbaseHex: string): string {
    const w = new ByteWriter(1024).bytes(headerWithNonce).varint(this.template.transactions.length + 1).bytes(fromHex(coinbaseHex));
    for (const t of this.template.transactions) w.bytes(fromHex(t.data));
    return toHex(w.toBytes());
  }
}

/** Fetches a block template from lbcd/lbrycrd. */
export async function getBlockTemplate(rpc: LbcdRpc, longpollId?: string): Promise<BlockTemplate> {
  const request: Record<string, unknown> = { capabilities: ['coinbasevalue', 'longpoll'], rules: ['segwit'] };
  if (longpollId) request.longpollid = longpollId;
  return validateTemplate(await rpc.call<BlockTemplate>('getblocktemplate', [request], longpollId ? 120_000 : 30_000));
}

/** Submits a solved block. Returns null on acceptance or the node's rejection reason. */
export async function submitBlock(rpc: LbcdRpc, blockHex: string): Promise<string | null> {
  const result = await rpc.call<string | null>('submitblock', [blockHex], 60_000);
  return result === null || result === undefined || result === '' ? null : String(result);
}
