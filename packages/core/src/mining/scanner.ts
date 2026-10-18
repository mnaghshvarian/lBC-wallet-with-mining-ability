import { base64 } from '@scure/base';
import { LBRY_SCAN_SIMD_WASM_BASE64, LBRY_SCAN_WASM_BASE64 } from './lbry-scan-wasm.generated.js';
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

/** 'simd' hashes four nonces per pass with WebAssembly SIMD; 'scalar' is the portable fallback. */
export type ScannerFlavor = 'simd' | 'scalar';

const compiled: Partial<Record<ScannerFlavor, Promise<WebAssembly.Module>>> = {};
let simdOk: boolean | undefined;

function wasmBytes(flavor: ScannerFlavor): Uint8Array {
  return base64.decode(flavor === 'simd' ? LBRY_SCAN_SIMD_WASM_BASE64 : LBRY_SCAN_WASM_BASE64);
}

/** Whether this runtime supports WebAssembly SIMD (all current Electron and Node.js builds do). */
export function simdSupported(): boolean {
  simdOk ??= WebAssembly.validate(wasmBytes('simd') as BufferSource);
  return simdOk;
}

/** The fastest scanner this runtime can run. */
export function bestScannerFlavor(): ScannerFlavor {
  return simdSupported() ? 'simd' : 'scalar';
}

export function compileScanner(flavor: ScannerFlavor = bestScannerFlavor()): Promise<WebAssembly.Module> {
  compiled[flavor] ??= WebAssembly.compile(wasmBytes(flavor) as BufferSource);
  return compiled[flavor];
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
  private constructor(
    private readonly x: ScanExports,
    readonly flavor: ScannerFlavor,
  ) {}

  static async create(flavor: ScannerFlavor = bestScannerFlavor()): Promise<LbryScanner> {
    const instance = await WebAssembly.instantiate(await compileScanner(flavor), {});
    return new LbryScanner(instance.exports as unknown as ScanExports, flavor);
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
