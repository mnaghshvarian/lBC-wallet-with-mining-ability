import { describe, expect, it } from 'vitest';
import { Emitter } from '../src/util/emitter.js';
import type { BackendEvents, BackendStatus, ChainBackend, ChainTip, FetchedTransaction, HistoryItem } from '../src/net/backend.js';
import { REGTEST, DEWIES_PER_LBC } from '../src/networks.js';
import { AddressDeriver, deriveAccountKey, publicOnly } from '../src/keys/hd.js';
import { addressToScript } from '../src/address.js';
import { Transaction } from '../src/tx/transaction.js';
import { ByteWriter, hashFromHex, toHex } from '../src/encoding/bytes.js';
import { checkProofOfWork } from '../src/crypto/pow.js';
import { merkleRoot } from '../src/wallet/verify.js';
import { WalletEngine } from '../src/wallet/engine.js';
import { emptyWalletState } from '../src/wallet/types.js';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** A regtest block header over `txids` that satisfies the regtest proof of work. */
function mineHeader(txids: string[], time: number): string {
  for (let nonce = 0; ; nonce++) {
    const header = new ByteWriter(112)
      .i32LE(1)
      .bytes(new Uint8Array(32))
      .bytes(hashFromHex(merkleRoot(txids)))
      .bytes(new Uint8Array(32))
      .u32LE(time)
      .u32LE(0x207fffff)
      .u32LE(nonce)
      .toBytes();
    if (checkProofOfWork(header, REGTEST.powLimit)) return toHex(header);
  }
}

function paymentTo(script: Uint8Array, marker: number): Transaction {
  const tx = new Transaction();
  tx.inputs.push({ txid: marker.toString(16).padStart(2, '0').repeat(32), vout: 0, scriptSig: new Uint8Array([0x51]), sequence: 0xffffffff, witness: [] });
  tx.outputs.push({ value: 5n * DEWIES_PER_LBC, script });
  return tx;
}

/** A scripted hub: tests decide which proof and which header it serves. */
class ScriptedBackend extends Emitter<BackendEvents> implements ChainBackend {
  readonly kind = 'hub' as const;
  readonly untrusted = true;
  tip: ChainTip = { height: 101, header: '' };
  history = new Map<string, HistoryItem[]>();
  txs = new Map<string, FetchedTransaction>();
  headers = new Map<number, string>();
  headerRequests = 0;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  getStatus(): BackendStatus {
    return { connected: true, kind: 'hub' };
  }
  async getTip(): Promise<ChainTip> {
    return this.tip;
  }
  async getHeaders(start: number, count: number): Promise<string[]> {
    this.headerRequests++;
    const out: string[] = [];
    for (let h = start; h < start + count && this.headers.has(h); h++) out.push(this.headers.get(h)!);
    return out;
  }
  async subscribeAddresses(addresses: string[]): Promise<(string | null)[]> {
    return addresses.map((a) => (this.history.get(a)?.length ? this.history.get(a)!.map((h) => `${h.txid}:${h.height}:`).join('') : null));
  }
  async getHistory(address: string): Promise<HistoryItem[]> {
    return this.history.get(address) ?? [];
  }
  async getTransactions(txids: string[]): Promise<Map<string, FetchedTransaction>> {
    return new Map(txids.filter((t) => this.txs.has(t)).map((t) => [t, this.txs.get(t)!]));
  }
  async broadcast(): Promise<string> {
    throw new Error('not supported');
  }
  newTip(tip: ChainTip): void {
    this.tip = tip;
    this.emit('tip', tip);
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
}

describe('wallet engine SPV verification', () => {
  const deriver = new AddressDeriver(publicOnly(deriveAccountKey(PHRASE, 'bip44', REGTEST), REGTEST), REGTEST);
  const address = deriver.derive(0, 0).address;
  const payment = paymentTo(addressToScript(address, REGTEST), 0xaa);
  // Two competing blocks at height 100 that both include the payment, with different coinbases.
  const coinbaseA = paymentTo(new Uint8Array([0x51]), 0x01).txid;
  const coinbaseB = paymentTo(new Uint8Array([0x52]), 0x02).txid;
  const headerA = mineHeader([coinbaseA, payment.txid], 1_700_000_000);
  const headerB = mineHeader([coinbaseB, payment.txid], 1_700_000_100);
  const proofA = { branch: [coinbaseA], pos: 1 };
  const proofB = { branch: [coinbaseB], pos: 1 };

  function setup() {
    const backend = new ScriptedBackend();
    backend.history.set(address, [{ txid: payment.txid, height: 100 }]);
    const logs: string[] = [];
    const engine = new WalletEngine({
      network: REGTEST,
      deriver,
      backend,
      state: emptyWalletState(),
      persist: () => undefined,
      log: (_level, message) => logs.push(message),
    });
    return { backend, engine, logs };
  }

  it('verifies a confirmed payment against its block header', async () => {
    const { backend, engine } = setup();
    backend.txs.set(payment.txid, { hex: payment.toHex(), height: 100, merkle: proofA });
    backend.headers.set(100, headerA);
    await engine.start();
    await settle();
    const [tx] = engine.getTransactions();
    expect(tx?.verified).toBe(true);
    await engine.stop();
  });

  it('recovers when a reorg replaces the block between fetching the proof and the header', async () => {
    const { backend, engine, logs } = setup();
    // The proof comes from block A, but by the time the header is fetched block B has replaced it.
    backend.txs.set(payment.txid, { hex: payment.toHex(), height: 100, merkle: proofA });
    backend.headers.set(100, headerB);
    await engine.start();
    await settle();
    expect(engine.getTransactions()[0]?.verified).toBe(false);
    expect(logs.some((l) => /SPV verification failed .*merkle proof mismatch \(will retry\)/.test(l))).toBe(true);

    // The hub now serves block B's proof; the next block triggers a fresh proof and header.
    backend.txs.set(payment.txid, { hex: payment.toHex(), height: 100, merkle: proofB });
    backend.newTip({ height: 102, header: mineHeader([coinbaseB], 1_700_000_300) });
    await settle();
    expect(engine.getTransactions()[0]?.verified).toBe(true);
    await engine.stop();
  });

  it('gives up after repeated failures from a lying server', async () => {
    const { backend, engine, logs } = setup();
    backend.txs.set(payment.txid, { hex: payment.toHex(), height: 100, merkle: proofA });
    backend.headers.set(100, headerB);
    await engine.start();
    for (let h = 102; h < 108; h++) {
      await settle();
      backend.newTip({ height: h, header: mineHeader([coinbaseB], 1_700_000_000 + h) });
    }
    await settle();
    expect(engine.getTransactions()[0]?.verified).toBe(false);
    expect(logs.filter((l) => l.startsWith('SPV verification failed')).length).toBe(3);
    expect(logs.at(-1) ?? '').not.toMatch(/will retry/);
    await engine.stop();
  });
});
