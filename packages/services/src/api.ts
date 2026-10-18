/**
 * The contract between the user interface and the wallet services.
 *
 * On desktop the UI runs in a sandboxed renderer and reaches the services in
 * the main process over IPC; on Android both run in the app, connected
 * directly. Either way the UI only uses this API. Amounts cross it as decimal
 * strings of dewies (1 LBC = 100,000,000 dewies).
 */

export type Dewies = string;
export type NetworkName = 'mainnet' | 'testnet' | 'regtest';
export type BackendKind = 'hub' | 'lbcd';
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
  /** Mine only after the computer has been idle (no keyboard/mouse input) for idleMinutes. */
  onlyWhenIdle: boolean;
  idleMinutes: number;
  /** yiimp-style API base for showing pool balance, e.g. https://lbrypool.net */
  poolApi: string;
}

export interface NodeSettings {
  /** Run the built-in lbcd full node (desktop). */
  enabled: boolean;
  /** Folder for the blockchain data; empty = inside the app data folder. */
  dataDir: string;
  /** Accept incoming connections from other nodes (helps the network). */
  listen: boolean;
  /** Extra nodes ("host:port") to connect to, e.g. your own other node. */
  peers: string[];
}

export interface Settings {
  network: NetworkName;
  /** UI language code (e.g. "fa"), or "auto" to follow the system. */
  language: string;
  /** Version of the disclaimer the user accepted; empty until accepted. */
  acceptedTerms: string;
  theme: 'system' | 'dark' | 'light';
  fiatCurrency: string;
  showFiat: boolean;
  hideBalances: boolean;
  /** Where the wallet reads the blockchain: public hubs, your own lbcd, or the built-in node (hubs until it is synced). */
  backendMode: 'hub' | 'lbcd' | 'local';
  useDefaultHubs: boolean;
  customHubs: HubEndpoint[];
  socks5: { enabled: boolean; host: string; port: number };
  lbcd: { url: string; username: string; password: string; certPath: string };
  feePerByte: number;
  autoLockMinutes: number;
  requirePasswordToSend: boolean;
  mining: MiningSettings;
  node: NodeSettings;
  explorerTxUrl: string;
  explorerAddressUrl: string;
  lastWalletId: string | null;
  developerMode: boolean;
}

export interface AppInfo {
  name: string;
  version: string;
  /** What the UI runs on; decides which features are offered. */
  kind: 'desktop' | 'android' | 'web';
  platform: string;
  arch: string;
  /** e.g. "Electron 44.9.0 · Chrome 144" or "Android 14 · WebView 120". */
  runtime: string;
  dataDir: string;
  cpuCount: number;
  isPackaged: boolean;
  capabilities: {
    /** CPU mining on this device. */
    mining: boolean;
    /** The built-in full node. */
    node: boolean;
    /** Connecting to the user's own lbcd over RPC. */
    ownNode: boolean;
    /** SOCKS5 proxy support. */
    proxy: boolean;
  };
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
  kind: BackendKind;
  /** Using public hubs only until the built-in node finishes syncing. */
  waitingForNode?: boolean;
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
  /** Lets the UI translate `error`. */
  errorCode?: string;
  errorParams?: Record<string, string | number>;
  server?: string;
  payoutAddress?: string;
  /** Mining is switched on but paused: laptop on battery, or the computer is in use ("only when idle"). */
  paused?: 'battery' | 'in-use';
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

/** A notification for the user. The UI words it from `code` and `params` in the chosen language. */
export interface NoticeView {
  kind: 'received' | 'confirmed' | 'dropped' | 'block-found' | 'locked' | 'node' | 'error';
  code: NoticeCode;
  params?: Record<string, string | number>;
}

export type NoticeCode =
  /** params: count, what ('payment' | 'mining' | 'tip' | 'mixed'), amount (dewies) */
  | 'received'
  /** params: txid */
  | 'dropped'
  /** params: height */
  | 'blockFound'
  | 'lockedTimeout'
  | 'lockedSystem'
  | 'nodeSynced'
  /** params: detail */
  | 'nodeStopped'
  /** params: message */
  | 'error';

export interface NodeStatusView {
  state: 'off' | 'starting' | 'syncing' | 'synced' | 'stopping' | 'error';
  network: NetworkName;
  /** The folder actually in use. */
  dataDir: string;
  /** Blocks verified and stored. */
  height: number;
  /** Block headers known (the node downloads headers first). */
  headers: number;
  /** Height of the network's chain tip, when known. */
  networkHeight: number | null;
  /** 0..1 */
  progress: number;
  peers: number;
  /** Bytes used by the data folder, and free on its drive. */
  diskUsed: number | null;
  diskFree: number | null;
  /** Rough estimate while syncing. */
  etaSeconds: number | null;
  listen: boolean;
  startedAt: number | null;
  version: string | null;
  error?: string;
  errorCode?: string;
  errorParams?: Record<string, string | number>;
}

export interface NodeRequirementsView {
  /** Approximate disk space the node needs (GB). */
  diskGb: number;
  /** Recommended memory (GB) and what this computer has. */
  ramGb: number;
  systemRamGb: number;
  defaultDataDir: string;
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
    /** Hide the screen from screenshots and the app switcher while secrets are shown (Android). */
    secureScreen(on: boolean): Promise<void>;
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
  node: {
    status(): Promise<NodeStatusView>;
    requirements(): Promise<NodeRequirementsView>;
    start(): Promise<NodeStatusView>;
    stop(): Promise<NodeStatusView>;
    /** Lets the user pick a folder for the blockchain data; null if cancelled. */
    chooseDataDir(): Promise<string | null>;
    openDataDir(): Promise<void>;
    logs(): Promise<string[]>;
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
  'node:status': NodeStatusView;
  'price:update': PriceView;
  notice: NoticeView;
}

export const EVENT_CHANNELS: (keyof LbcEvents)[] = ['wallet:changed', 'wallet:locked', 'network:status', 'miner:stats', 'miner:log', 'node:status', 'price:update', 'notice'];

/** How every API call answers: a value, or a user-facing error with a translatable code. */
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string; code?: string; params?: Record<string, string | number> };
