import type { HDKey } from '@scure/bip32';
import { randomBytes } from '../crypto/hash.js';
import { fromHex, toHex, utf8Decode, utf8Encode, wipe } from '../encoding/bytes.js';
import { accountKeyFromExtended, AddressDeriver, deriveAccountKey, derivePrivateKey, publicOnly, type DerivationScheme } from '../keys/hd.js';
import { checkPhrase, cleanPhrase } from '../keys/mnemonic.js';
import { getNetwork, type NetworkName, type NetworkParams } from '../networks.js';
import { DEFAULT_KDF, openJson, openWithKey, sealJson, sealWithKey, type SealedBox } from '../vault.js';
import { emptyWalletState, type WalletState } from './types.js';

export type SecretSource =
  | { type: 'mnemonic'; mnemonic: string; passphrase?: string; scheme: DerivationScheme; accountIndex?: number }
  | { type: 'xprv'; xprv: string }
  | { type: 'watch'; xpub: string };

interface SecretPayload {
  source: SecretSource;
  dataKey: string;
}

export interface WalletFile {
  format: 'lbc-wallet';
  version: 1;
  id: string;
  name: string;
  network: NetworkName;
  createdAt: number;
  kind: SecretSource['type'];
  scheme: DerivationScheme | 'xprv' | 'xpub';
  /** Seed / keys, sealed with the user's password. */
  secret: SealedBox;
  /** Address and transaction cache, sealed with a random data key stored inside `secret`. */
  state: SealedBox;
}

export interface WalletInfo {
  id: string;
  name: string;
  network: NetworkName;
  createdAt: number;
  kind: SecretSource['type'];
  scheme: WalletFile['scheme'];
}

export function walletInfo(file: WalletFile): WalletInfo {
  return { id: file.id, name: file.name, network: file.network, createdAt: file.createdAt, kind: file.kind, scheme: file.scheme };
}

const SECRET_PURPOSE = 'secret';
const STATE_PURPOSE = 'state';

export function normalizeSource(source: SecretSource): SecretSource {
  if (source.type === 'mnemonic') {
    const mnemonic = cleanPhrase(source.mnemonic);
    const words = mnemonic.split(' ');
    if (words.length < 12) throw new Error('A recovery phrase has at least 12 words');
    if (source.scheme === 'bip44' && !checkPhrase(mnemonic).bip39Valid) throw new Error('This is not a valid BIP39 recovery phrase (checksum mismatch)');
    return { type: 'mnemonic', mnemonic, passphrase: source.passphrase || undefined, scheme: source.scheme, accountIndex: source.accountIndex ?? 0 };
  }
  if (source.type === 'xprv') return { type: 'xprv', xprv: source.xprv.trim() };
  return { type: 'watch', xpub: source.xpub.trim() };
}

/** Account-level key for a secret source (private unless watch-only). */
export function accountKeyFor(source: SecretSource, network: NetworkParams): HDKey {
  switch (source.type) {
    case 'mnemonic':
      return deriveAccountKey(source.mnemonic, source.scheme, network, { passphrase: source.passphrase, accountIndex: source.accountIndex });
    case 'xprv': {
      const key = accountKeyFromExtended(source.xprv, network);
      if (!key.privateKey) throw new Error('Expected an extended private key (xprv)');
      return key;
    }
    case 'watch': {
      const key = accountKeyFromExtended(source.xpub, network);
      return publicOnly(key, network);
    }
  }
}

function schemeOf(source: SecretSource): WalletFile['scheme'] {
  return source.type === 'mnemonic' ? source.scheme : source.type === 'xprv' ? 'xprv' : 'xpub';
}

function newId(): string {
  return toHex(randomBytes(8));
}

export async function createWalletFile(params: {
  name: string;
  network: NetworkName;
  source: SecretSource;
  password: string;
  kdfCost?: typeof DEFAULT_KDF;
  state?: WalletState;
  now?: number;
}): Promise<WalletFile> {
  const network = getNetwork(params.network);
  const source = normalizeSource(params.source);
  // Validate the keys before persisting anything.
  accountKeyFor(source, network);
  const dataKey = randomBytes(32);
  const payload: SecretPayload = { source, dataKey: toHex(dataKey) };
  const secret = await sealJson(payload, params.password, SECRET_PURPOSE, params.kdfCost ?? DEFAULT_KDF);
  const state = sealWithKey(utf8Encode(serializeState(params.state ?? emptyWalletState())), dataKey, STATE_PURPOSE);
  wipe(dataKey);
  return {
    format: 'lbc-wallet',
    version: 1,
    id: newId(),
    name: params.name.trim() || 'My LBC Wallet',
    network: params.network,
    createdAt: params.now ?? Date.now(),
    kind: source.type,
    scheme: schemeOf(source),
    secret,
    state,
  };
}

export function serializeState(state: WalletState): string {
  return JSON.stringify(state);
}

export function parseState(json: string): WalletState {
  const s = JSON.parse(json) as WalletState;
  if (s.version !== 1) throw new Error('unsupported wallet state version');
  return { ...emptyWalletState(), ...s };
}

export function validateWalletFile(value: unknown): WalletFile {
  const f = value as WalletFile;
  if (!f || f.format !== 'lbc-wallet' || f.version !== 1 || !f.secret || !f.state || !f.id) throw new Error('Not an LBC wallet file');
  return f;
}

/**
 * An unlocked wallet. Holds the account xpub and the data key; private keys are
 * re-derived from the password for each signature unless `keepKeys` is set.
 */
export class WalletSession {
  readonly network: NetworkParams;
  readonly deriver: AddressDeriver;
  private dataKey: Uint8Array;
  private accountPrivate: HDKey | null;

  private constructor(
    public file: WalletFile,
    dataKey: Uint8Array,
    readonly xpub: string,
    accountPrivate: HDKey | null,
    readonly state: WalletState,
  ) {
    this.network = getNetwork(file.network);
    this.dataKey = dataKey;
    this.accountPrivate = accountPrivate;
    this.deriver = AddressDeriver.fromExtendedKey(xpub, this.network);
  }

  static async unlock(file: WalletFile, password: string, options: { keepKeys?: boolean } = {}): Promise<WalletSession> {
    const network = getNetwork(file.network);
    const payload = await openJson<SecretPayload>(file.secret, password, SECRET_PURPOSE);
    const account = accountKeyFor(payload.source, network);
    const xpub = account.publicExtendedKey;
    const dataKey = fromHex(payload.dataKey);
    const state = parseState(utf8Decode(openWithKey(file.state, dataKey, STATE_PURPOSE)));
    const keep = options.keepKeys && payload.source.type !== 'watch' ? account : null;
    return new WalletSession(file, dataKey, xpub, keep, state);
  }

  get watchOnly(): boolean {
    return this.file.kind === 'watch';
  }

  get keysInMemory(): boolean {
    return this.accountPrivate !== null;
  }

  /** Re-seals the current state into the wallet file (call after engine changes). */
  snapshot(state: WalletState = this.state): WalletFile {
    this.file = { ...this.file, state: sealWithKey(utf8Encode(serializeState(state)), this.dataKey, STATE_PURPOSE) };
    return this.file;
  }

  rename(name: string): WalletFile {
    this.file = { ...this.file, name: name.trim().slice(0, 64) || this.file.name };
    return this.file;
  }

  /** Returns a key provider for signing; requires the password unless keys are kept in memory. */
  async keyProvider(password?: string): Promise<{ provider: (chain: number, index: number) => Uint8Array; release: () => void }> {
    if (this.watchOnly) throw new Error('This is a watch-only wallet; it cannot sign transactions');
    let account = this.accountPrivate;
    let temporary = false;
    if (!account) {
      if (password === undefined) throw new Error('Password required');
      const payload = await openJson<SecretPayload>(this.file.secret, password, SECRET_PURPOSE);
      account = accountKeyFor(payload.source, this.network);
      temporary = true;
      if (account.publicExtendedKey !== this.xpub) throw new Error('Wallet keys do not match');
    } else if (password !== undefined) {
      // still verify the password when the UI asks for it
      await openJson<SecretPayload>(this.file.secret, password, SECRET_PURPOSE);
    }
    const acc = account;
    return {
      provider: (chain, index) => derivePrivateKey(acc, chain, index),
      release: () => {
        if (temporary) acc.wipePrivateData();
      },
    };
  }

  async verifyPassword(password: string): Promise<boolean> {
    try {
      await openJson<SecretPayload>(this.file.secret, password, SECRET_PURPOSE);
      return true;
    } catch {
      return false;
    }
  }

  /** Returns the recovery material (phrase or extended key) after re-checking the password. */
  async revealSecret(password: string): Promise<SecretSource> {
    const payload = await openJson<SecretPayload>(this.file.secret, password, SECRET_PURPOSE);
    return payload.source;
  }

  async changePassword(oldPassword: string, newPassword: string, kdfCost = DEFAULT_KDF): Promise<WalletFile> {
    const payload = await openJson<SecretPayload>(this.file.secret, oldPassword, SECRET_PURPOSE);
    const secret = await sealJson(payload, newPassword, SECRET_PURPOSE, kdfCost);
    this.file = { ...this.file, secret };
    return this.file;
  }

  /** Clears key material from memory. The session must not be used afterwards. */
  lock(): void {
    this.accountPrivate?.wipePrivateData();
    this.accountPrivate = null;
    wipe(this.dataKey);
  }
}
