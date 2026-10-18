/**
 * Network parameters for the LBRY Credits (LBC) blockchain.
 *
 * Values are taken from lbcd `chaincfg/params.go`, lbry-sdk `lbry/wallet/ledger.py`
 * and the LBRY hub `hub/scribe/network.py`.
 */

export type NetworkName = 'mainnet' | 'testnet' | 'regtest';

export interface HubServer {
  host: string;
  port: number;
  tls?: boolean;
}

export interface NetworkParams {
  name: NetworkName;
  displayName: string;
  /** Base58 version byte for pay-to-pubkey-hash addresses (mainnet 0x55 → addresses start with "b"). */
  pubKeyHashPrefix: number;
  /** Base58 version byte for pay-to-script-hash addresses (mainnet 0x7a → addresses start with "r"). */
  scriptHashPrefix: number;
  /** WIF private key version byte. */
  wifPrefix: number;
  /** Human-readable part for native SegWit addresses. */
  bech32Hrp: string;
  /** BIP32 extended key version bytes (xpub/xprv style). */
  bip32: { public: number; private: number };
  /** SLIP-44 coin type used for BIP44 derivation. */
  coinType: number;
  genesisHash: string;
  powLimitBits: number;
  powLimit: bigint;
  coinbaseMaturity: number;
  /** Target seconds between blocks. */
  targetBlockTime: number;
  p2pPort: number;
  rpcPort: number;
  defaultHubs: HubServer[];
  /** `{txid}` / `{address}` / `{height}` placeholders. */
  explorer?: { tx: string; address: string; block: string };
}

export const MAINNET: NetworkParams = {
  name: 'mainnet',
  displayName: 'LBRY Credits',
  pubKeyHashPrefix: 0x55,
  scriptHashPrefix: 0x7a,
  wifPrefix: 0x1c,
  bech32Hrp: 'lbc',
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  coinType: 140,
  genesisHash: '9c89283ba0f3227f6c03b70216b9f665f0118d5e0fa729cedf4fb34d6a34f463',
  powLimitBits: 0x1f00ffff,
  powLimit: (1n << 240n) - 1n,
  coinbaseMaturity: 100,
  targetBlockTime: 150,
  p2pPort: 9246,
  rpcPort: 9245,
  defaultHubs: [
    // Odysee-operated hubs (verified alive, protocol + genesis check, October 2026)
    { host: 'a-hub1.odysee.com', port: 50001 },
    { host: 'b-hub1.odysee.com', port: 50001 },
    { host: 'c-hub1.odysee.com', port: 50001 },
    { host: 's-hub1.odysee.com', port: 50001 },
    // Community-operated hubs
    { host: 'hub.lbry.grin.io', port: 50001 },
    { host: 'hub.lizard.technology', port: 50001 },
    { host: 's1.lbry.network', port: 50001 },
  ],
  explorer: {
    tx: 'https://explorer.lbry.com/tx/{txid}',
    address: 'https://explorer.lbry.com/address/{address}',
    block: 'https://explorer.lbry.com/blocks/{height}',
  },
};

export const TESTNET: NetworkParams = {
  ...MAINNET,
  name: 'testnet',
  displayName: 'LBRY Credits Testnet',
  pubKeyHashPrefix: 111,
  scriptHashPrefix: 196,
  wifPrefix: 239,
  bech32Hrp: 'tlbc',
  bip32: { public: 0x043587cf, private: 0x04358394 },
  coinType: 1,
  genesisHash: '9c89283ba0f3227f6c03b70216b9f665f0118d5e0fa729cedf4fb34d6a34f463',
  p2pPort: 19246,
  rpcPort: 19245,
  defaultHubs: [],
  explorer: undefined,
};

export const REGTEST: NetworkParams = {
  ...MAINNET,
  name: 'regtest',
  displayName: 'LBRY Credits Regtest',
  pubKeyHashPrefix: 111,
  scriptHashPrefix: 196,
  wifPrefix: 239,
  bech32Hrp: 'rlbc',
  bip32: { public: 0x043587cf, private: 0x04358394 },
  coinType: 1,
  genesisHash: '6e3fcf1299d4ec5d79c3a4c91d624a4acf9e2e173d95a1a0504f677669687556',
  powLimitBits: 0x207fffff,
  powLimit: (1n << 255n) - 1n,
  p2pPort: 29246,
  rpcPort: 29245,
  defaultHubs: [],
  explorer: undefined,
};

export const NETWORKS: Record<NetworkName, NetworkParams> = {
  mainnet: MAINNET,
  testnet: TESTNET,
  regtest: REGTEST,
};

export function getNetwork(name: NetworkName): NetworkParams {
  const net = NETWORKS[name];
  if (!net) throw new Error(`unknown network ${name}`);
  return net;
}

/** 1 LBC = 100,000,000 dewies. */
export const DEWIES_PER_LBC = 100_000_000n;

/** Default fee rate used by the LBRY SDK (dewies per byte). */
export const DEFAULT_FEE_PER_BYTE = 50;

/** Outputs below this value are treated as dust and never created as change. */
export const DUST_THRESHOLD = 1000n;
