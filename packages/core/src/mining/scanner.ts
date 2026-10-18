import { base64 } from '@scure/base';
import { LBRY_SCAN_WASM_BASE64 } from './lbry-scan-wasm.generated.js';
import { HEADER_SIZE } from '../crypto/pow.js';
import { bigIntToHash } from '../crypto/pow.js';

interface ScanExports {
  memory: WebAssembly.Memory;
  header_ptr(): number;
  target_ptr(): number;
  hash_ptr(): number;
  found(): number;
  found_nonce(): number;
  prepare(): void;
  scan(start: number, count: number): number;
  hash_nonce(nonce: number): void;
}

let compiled: Promise<WebAssembly.Module> | null = null;

function wasmBytes(): Uint8Array {
  return base64.decode(LBRY_SCAN_WASM_BASE64);
}

export function compileScanner(): Promise<WebAssembly.Module> {
  if (!compiled) compiled = WebAssembly.compile(wasmBytes() as BufferSource);
  return compiled;
}

export interface ScanResult {
  /** Hashes computed in this call. */
  hashes: number;
  found: boolean;
  nonce?: number;
  /** Internal-order hash of the hit. */
  hash?: Uint8Array;
}

/**
 * Fast LBRY PoW nonce scanner backed by WebAssembly. One instance per worker
 * thread; each instance owns its own linear memory.
 */
export class LbryScanner {
  private constructor(private readonly x: ScanExports) {}

  static async create(module?: WebAssembly.Module): Promise<LbryScanner> {
    const mod = module ?? (await compileScanner());
    const instance = await WebAssembly.instantiate(mod, {});
    return new LbryScanner(instance.exports as unknown as ScanExports);
  }

  private view(ptr: number, len: number): Uint8Array {
    return new Uint8Array(this.x.memory.buffer, ptr, len);
  }

  /** Loads a 112-byte header (nonce field ignored) and a 256-bit target. */
  setWork(header: Uint8Array, target: bigint): void {
    if (header.length !== HEADER_SIZE) throw new Error('header must be 112 bytes');
    this.view(this.x.header_ptr(), HEADER_SIZE).set(header);
    this.view(this.x.target_ptr(), 32).set(bigIntToHash(target));
    this.x.prepare();
  }

  scan(start: number, count: number): ScanResult {
    const hashes = this.x.scan(start >>> 0, count >>> 0) >>> 0;
    if (!this.x.found()) return { hashes, found: false };
    return { hashes, found: true, nonce: this.x.found_nonce() >>> 0, hash: this.view(this.x.hash_ptr(), 32).slice() };
  }

  /** Hash of the loaded header with `nonce` (for verification). */
  hash(nonce: number): Uint8Array {
    this.x.hash_nonce(nonce >>> 0);
    return this.view(this.x.hash_ptr(), 32).slice();
  }
}
