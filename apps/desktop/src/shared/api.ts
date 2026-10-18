/**
 * The contract between the renderer (UI) and the main process.
 *
 * The renderer never sees private keys or opens network connections: it asks
 * the main process to do things through this API. Amounts cross the boundary
 * as decimal strings of dewies (1 LBC = 100,000,000 dewies).
 */

export type Dewies = string;
export type NetworkName = 'mainnet' | 'testnet' | 'regtest';
export type DerivationScheme = 'bip44' | 'lbry';

export interface HubEndpoint {
  host: string;
  port: number;
  tls?: boolean;
}

export interface MiningSettings {
  mode: 'pool' | 'solo';
  /** stratum+tcp://host:port or stratum+ssl://host:port */
  poolUrl: string;
  /** Payout address override; empty = the open wallet's mining address. */
  payoutAddress: string;
  workerName: string;
  poolPassword: string;
  threads: number;
  lowPriority: boolean;
  pauseOnBattery: boolean;
  /** yiimp-style API base for showing pool balance, e.g. https://lbrypool.net */
  poolApi: string;
}

export interface Settings {
  network: NetworkName;
  theme: 'system' | 'dark' | 'light';
  fiatCurrency: string;
  showFiat: boolean;
  hideBalances: boolean;
  backendMode: 'hub' | 'lbcd';
  useDefaultHubs: boolean;
  customHubs: HubEndpoint[];
  socks5: { enabled: boolean; host: string; port: number };
  lbcd: { url: string; username: string; password: string; certPath: string };
  feePerByte: number;
  autoLockMinutes: number;
  requirePasswordToSend: boolean;
  mining: MiningSettings;
  explorerTxUrl: string;
  explorerAddressUrl: string;
  lastWalletId: string | null;
  developerMode: boolean;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  dataDir: string;
  cpuCount: number;
  isPackaged: boolean;
}

export interface WalletListItem {
  id: string;
  name: string;
  network: NetworkName;
  createdAt: number;
  kind: 'mnemonic' | 'xprv' | 'watch';
  scheme: DerivationScheme | 'xprv' | 'xpub';
}

export interface BalanceView {
  available: Dewies;
  pending: Dewies;
  immature: Dewies;
  supports: Dewies;
  claims: Dewies;
  total: Dewies;
}

export interface BackendStatusView {
  connected: boolean;
  kind: 'hub' | 'lbcd';
  server?: string;
  serverVersion?: string;
  latencyMs?: number;
  height?: number;
  error?: string;
}

export interface SyncView {
  state: 'idle' | 'connecting' | 'syncing' | 'synced' | 'offline' | 'error';
  addresses: number;
  transactions: number;
  lastSyncAt?: number;
  error?: string;
}

export interface WalletOverview {
  id: string;
  name: string;
  network: NetworkName;
  kind: WalletListItem['kind'];
  scheme: WalletListItem['scheme'];
  watchOnly: boolean;
  balance: BalanceView;
  receiveAddress: string;
  tipHeight: number;
  /** Header bits at the tip (for mining estimates). */
  tipBits: number | null;
  sync: SyncView;
  backend: BackendStatusView;
  txCount: number;
}

export type TxType = 'receive' | 'send' | 'self' | 'mining' | 'tip-in' | 'tip-out' | 'support' | 'claim' | 'unlock';

export interface TxListItem {
  txid: string;
  height: number;
  confirmations: number;
  time: number;
  type: TxType;
  amount: Dewies;
  fee: Dewies | null;
  counterparty: string | null;
  label?: string;
  status: 'pending' | 'confirmed';
  verified?: boolean;
}

export interface TxDetailView extends TxListItem {
  inputs: { txid: string; vout: number; address: string | null; value: Dewies | null; mine: boolean }[];
  outputs: { vout: number; address: string | null; value: Dewies; mine: boolean; change: boolean; kind: string; claimName?: string; claimId?: string }[];
  size: number;
  explorerUrl: string | null;
}

export interface AddressView {
  address: string;
  chain: number;
  index: number;
  used: boolean;
  balance: Dewies;
  txCount: number;
  label?: string;
}

export interface Contact {
  id: string;
  name: string;
  address: string;
  note?: string;
}

export interface DraftView {
  id: string;
  kind: 'payment' | 'unlock-supports' | 'sweep';
  recipients: { address: string; value: Dewies }[];
  fee: Dewies;
  feePerByte: number;
  change: Dewies;
  total: Dewies;
  size: number;
  inputCount: number;
}

export interface SchemeScanView {
  scheme: DerivationScheme;
  usedAddresses: number;
  firstAddress: string;
}

export type CreateSource =
  | { type: 'mnemonic'; mnemonic: string; passphrase?: string; scheme: DerivationScheme }
  | { type: 'xprv'; xprv: string }
  | { type: 'watch'; xpub: string };

export interface PhraseCheckView {
  words: number;
  unknownWords: string[];
  bip39Valid: boolean;
  /** Schemes this phrase could belong to. */
  schemes: DerivationScheme[];
}

export interface PriceView {
  currency: string;
  price: number;
  change24h: number | null;
  updatedAt: number;
  source: string;
}

export interface MinerStatsView {
  state: 'stopped' | 'starting' | 'connecting' | 'mining' | 'waiting' | 'error';
  mode: 'pool' | 'solo' | null;
  threads: number;
  hashrate: number;
  hashrateAvg: number;
  totalHashes: number;
  accepted: number;
  rejected: number;
  blocksFound: number;
  difficulty: number;
  height: number | null;
  networkBits: number | null;
  startedAt: number | null;
  lastShareAt: number | null;
  lastJobAt: number | null;
  error?: string;
  server?: string;
  payoutAddress?: string;
  pausedOnBattery?: boolean;
}

export interface MinerEstimateView {
  networkHashrate: number;
  blockReward: number;
  lbcPerDay: number;
  daysPerBlock: number;
  fiatPerDay: number | null;
  basis: 'pool' | 'difficulty' | 'none';
}

export interface PoolBalanceView {
  balance: number;
  unpaid: number;
  paid24h: number;
  total: number;
  hashrate?: number;
  updatedAt: number;
}

export interface MinerLogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  at: number;
}

export interface HubTestResult {
  ok: boolean;
  latencyMs?: number;
  height?: number;
  version?: string;
  error?: string;
}

export interface NoticeView {
  kind: 'received' | 'confirmed' | 'dropped' | 'block-found' | 'locked' | 'error';
  title: string;
  message?: string;
}

/** Everything the preload exposes as `window.lbc`. */
export interface LbcApi {
  app: {
    info(): Promise<AppInfo>;
    openExternal(url: string): Promise<void>;
    copy(text: string, opts?: { sensitive?: boolean }): Promise<void>;
    paste(): Promise<string>;
    activity(): void;
    quit(): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: Partial<Settings>): Promise<Settings>;
  };
  wallets: {
    list(): Promise<WalletListItem[]>;
    generateMnemonic(words: 12 | 24): Promise<string>;
    checkPhrase(phrase: string): Promise<PhraseCheckView>;
    suggestWords(prefix: string): Promise<string[]>;
    scan(phrase: string, passphrase?: string): Promise<SchemeScanView[]>;
    create(params: { name: string; password: string; source: CreateSource }): Promise<WalletOverview>;
    open(id: string, password: string): Promise<WalletOverview>;
    lock(): Promise<void>;
    remove(id: string, password: string): Promise<void>;
    rename(name: string): Promise<WalletOverview>;
    changePassword(oldPassword: string, newPassword: string): Promise<void>;
    reveal(password: string): Promise<{ type: 'mnemonic' | 'xprv' | 'watch'; secret: string; passphrase?: string; scheme?: string }>;
    xpub(): Promise<string>;
    passwordStrength(password: string): Promise<{ score: number; hint: string }>;
  };
  wallet: {
    overview(): Promise<WalletOverview | null>;
    transactions(): Promise<TxListItem[]>;
    transaction(txid: string): Promise<TxDetailView | null>;
    addresses(): Promise<AddressView[]>;
    newAddress(): Promise<{ address: string; atLimit: boolean }>;
    setLabel(key: string, label: string): Promise<void>;
    validateAddress(address: string): Promise<{ valid: boolean; error?: string; mine?: boolean }>;
    prepareSend(params: { address: string; amount: Dewies | 'max'; feePerByte?: number }): Promise<DraftView>;
    prepareUnlock(): Promise<DraftView>;
    send(params: { draftId: string; password?: string; label?: string }): Promise<{ txid: string }>;
    rescan(): Promise<void>;
    exportCsv(): Promise<{ saved: boolean; path?: string }>;
    contacts(): Promise<Contact[]>;
    saveContact(contact: Omit<Contact, 'id'> & { id?: string }): Promise<Contact[]>;
    deleteContact(id: string): Promise<Contact[]>;
  };
  network: {
    status(): Promise<BackendStatusView>;
    testHub(endpoint: HubEndpoint): Promise<HubTestResult>;
    testNode(): Promise<HubTestResult>;
    reconnect(): Promise<void>;
  };
  miner: {
    status(): Promise<MinerStatsView>;
    start(): Promise<MinerStatsView>;
    stop(): Promise<MinerStatsView>;
    logs(): Promise<MinerLogEntry[]>;
    estimate(): Promise<MinerEstimateView>;
    poolBalance(): Promise<PoolBalanceView | null>;
  };
  price: {
    get(): Promise<PriceView | null>;
  };
  on<E extends keyof LbcEvents>(event: E, handler: (payload: LbcEvents[E]) => void): () => void;
}

export interface LbcEvents {
  'wallet:changed': WalletOverview;
  'wallet:locked': { reason: 'manual' | 'timeout' | 'system' };
  'network:status': BackendStatusView;
  'miner:stats': MinerStatsView;
  'miner:log': MinerLogEntry;
  'price:update': PriceView;
  notice: NoticeView;
}

export const EVENT_CHANNELS: (keyof LbcEvents)[] = ['wallet:changed', 'wallet:locked', 'network:status', 'miner:stats', 'miner:log', 'price:update', 'notice'];
