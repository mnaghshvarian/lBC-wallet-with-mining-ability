import { AddressDeriver, deriveAccountKey, publicOnly, type DerivationScheme } from '../keys/hd.js';
import { checkPhrase } from '../keys/mnemonic.js';
import type { NetworkParams } from '../networks.js';
import type { ChainBackend } from '../net/backend.js';

export interface SchemeScanResult {
  scheme: DerivationScheme;
  /** Number of scanned addresses that have on-chain history. */
  usedAddresses: number;
  firstAddress: string;
}

export function candidateSchemes(phrase: string): DerivationScheme[] {
  const check = checkPhrase(phrase);
  // LBRY seeds have no checksum and are accepted as-is; BIP44 requires a valid BIP39 phrase.
  return check.bip39Valid ? ['bip44', 'lbry'] : ['lbry'];
}

/**
 * Looks for on-chain activity under each derivation scheme a phrase could have
 * been used with, so restoring a LBRY Desktop / Odysee seed or a standard
 * BIP39 seed "just works" without the user knowing about derivation paths.
 */
export async function scanSchemes(
  phrase: string,
  network: NetworkParams,
  backend: ChainBackend,
  options: { passphrase?: string; receive?: number; change?: number } = {},
): Promise<SchemeScanResult[]> {
  const results: SchemeScanResult[] = [];
  for (const scheme of candidateSchemes(phrase)) {
    const account = deriveAccountKey(phrase, scheme, network, { passphrase: scheme === 'bip44' ? options.passphrase : undefined });
    const deriver = new AddressDeriver(publicOnly(account, network), network);
    const addresses: string[] = [];
    for (let i = 0; i < (options.receive ?? 20); i++) addresses.push(deriver.derive(0, i).address);
    for (let i = 0; i < (options.change ?? 6); i++) addresses.push(deriver.derive(1, i).address);
    const statuses = await backend.subscribeAddresses(addresses);
    results.push({ scheme, usedAddresses: statuses.filter((s) => s !== null).length, firstAddress: addresses[0]! });
  }
  return results;
}

/** Picks the scheme to restore with: the one with activity, else the preferred default. */
export function chooseScheme(results: SchemeScanResult[], preferred: DerivationScheme = 'bip44'): DerivationScheme {
  const used = results.filter((r) => r.usedAddresses > 0).sort((a, b) => b.usedAddresses - a.usedAddresses);
  if (used.length) return used[0]!.scheme;
  return results.some((r) => r.scheme === preferred) ? preferred : results[0]!.scheme;
}
