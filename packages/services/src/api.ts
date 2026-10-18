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

export type BitcoinUnit = 'auto' | 'btc' | 'sats' | 'sci';

export interface Settings {
  network: NetworkName;
  /** UI language code (e.g. "fa"), or "auto" to follow the system. */
  language: string;
  /** Version of the disclaimer the user accepted; empty until accepted. */
  acceptedTerms: string;
  theme: 'system' | 'dark' | 'light';
  fiatCurrency: string;
  showFiat: boolean;
  /**
   * How Bitcoin amounts are shown in swaps and on the Market: automatic (sats below
   * 0.001 BTC, BTC above), always BTC, always sats, or scientific notation (2.05e-5 BTC).
   */
  bitcoinUnit: BitcoinUnit;
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
  /** Atomic swaps: an Esplora server for the Bitcoin side; empty = blockstream.info, checked against mempool.space. */
  swap: { btcExplorer: string };
  /** The order board: Nostr relays (wss://…) for offers and trade messages; empty = the default list. */
  market: { relays: string[] };
  /** Version of the order board's own warning the user accepted; empty until accepted. */
  acceptedMarketTerms: string;
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
    /** Solo mining (needs the built-in node or the user's own). */
    soloMining: boolean;
    /** Mining at low priority and "only when idle" (keyboard and mouse input). */
    idleMining: boolean;
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
  /** The signing keys stay in memory (the wallet was opened while "ask for the password on every send" was off); otherwise sending needs the password. */
  keysInMemory: boolean;
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
  /** Mining is switched on but paused until the reason goes away. */
  paused?: MinerPauseReason;
}

/** Limits of mining on a phone: it pauses at `hotC` battery temperature and resumes below `resumeC`; with mining on battery allowed it stops below `lowBattery`. */
export const PHONE_MINING = { hotC: 40, resumeC: 37, lowBattery: 0.3 } as const;

/**
 * Why switched-on mining is paused: on battery power, the computer is in use
 * ("only when idle"); on a phone also a low battery, a hot phone, battery
 * saver, or the app not being on screen.
 */
export type MinerPauseReason = 'battery' | 'in-use' | 'battery-low' | 'hot' | 'power-save' | 'background';

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
  kind: 'received' | 'confirmed' | 'dropped' | 'block-found' | 'locked' | 'node' | 'swap' | 'error';
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
  /** The other side's coins are locked and confirmed: lock yours. params: coin */
  | 'swapReadyToLock'
  /** params: coin (received) */
  | 'swapCompleted'
  /** params: coin (returned) */
  | 'swapRefunded'
  /** Someone took your offer; their wallet locks first. params: lbc (dewies) */
  | 'marketTaken'
  /** Your take was accepted: lock your coins now. params: coin */
  | 'marketAccepted'
  /** params: reason */
  | 'marketDeclined'
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

export type SwapCoinName = 'LBC' | 'BTC';

/**
 * Where a swap stands, from this wallet's side:
 * send-invite — share the invite and wait for the other person's lock code;
 * lock — lock your coins now; pay-btc — pay the Bitcoin contract from another wallet;
 * send-lock — share your lock code and wait; checking — waiting for the other
 * side's coins to confirm; claiming — collecting their coins; refund-waiting —
 * your coins come back after the lock time; refunding — refund sent.
 */
export type SwapStage =
  | 'send-invite'
  | 'lock'
  | 'pay-btc'
  | 'send-lock'
  | 'checking'
  | 'claiming'
  | 'refund-waiting'
  | 'refunding'
  | 'completed'
  | 'refunded'
  | 'cancelled'
  | 'failed';

export interface SwapContractView {
  coin: SwapCoinName;
  address: string;
  /** Unix time after which the coins can go back to the side that locked them. */
  locktime: number;
  txid?: string;
  /** Locked amount in the coin's smallest unit (dewies or satoshis). */
  value?: string;
  confirmations: number;
  /** Confirmations the other side waits for. */
  required: number;
}

export interface SwapView {
  id: string;
  /** starter: created the invite and locks second; joiner: joined and locks first. */
  role: 'starter' | 'joiner';
  give: SwapCoinName;
  get: SwapCoinName;
  /** Agreed amounts: dewies and satoshis. */
  lbc: Dewies;
  btc: string;
  stage: SwapStage;
  createdAt: number;
  updatedAt: number;
  /** The code to send to the other person now. */
  code?: string;
  /** Waiting for the other person's lock code. */
  expectsCode: boolean;
  /** Bitcoin to pay to the contract from another wallet (stage pay-btc), in satoshis. */
  payTo?: { address: string; amount: string };
  ours?: SwapContractView;
  theirs?: SwapContractView;
  claimTxid?: string;
  refundTxid?: string;
  /** Where your new coins go, and where a refund goes. */
  receiveTo: string;
  refundTo: string;
  /** From when your locked coins can come back if the swap does not finish (Unix time). */
  refundAt?: number;
  /** Nothing of yours is locked yet. */
  cancellable: boolean;
  /** Lock before this time (Unix seconds), for swaps from the order board. */
  lockBy?: number;
  problem?: { code: string; params?: Record<string, string | number> };
  events: { at: number; code: string; params?: Record<string, string | number> }[];
}

/** Version of the order board's own warning; a new version asks everyone to read it again. */
export const MARKET_TERMS_VERSION = '2026-10-18';

/** Free, public relays that keep application events (NIP-78) and honour expiry (NIP-40). */
export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://relay.mostro.network'];

/** One LBC in other money, for comparing offers with the exchanges. */
export interface MarketPriceView {
  /** US dollars, satoshis and Monero per LBC. */
  usd: number;
  sats: number;
  xmr: number | null;
  /** US dollars per Bitcoin and per Monero. */
  btcUsd: number;
  xmrUsd: number | null;
  source: string;
  updatedAt: number;
}

export interface MarketOfferView {
  /** Identifies the offer on the board (its key and id). */
  key: string;
  /** What the person who posted it gives; you give the other coin. */
  give: SwapCoinName;
  /** The price as amounts of the whole offer (dewies, satoshis), the smallest part, and what is left. */
  lbc: Dewies;
  btc: string;
  min: Dewies;
  left: Dewies;
  /** Satoshis per LBC. */
  price: number;
  /** Percent above (+) or below (−) the reference price; null without one. */
  premium: number | null;
  createdAt: number;
  /** Posted by this wallet. */
  mine: boolean;
}

export interface MyOfferView extends MarketOfferView {
  id: string;
  status: 'open' | 'closed';
  /** Where your Bitcoin goes (or comes back to, when you give Bitcoin). */
  btcAddress: string;
  /** Trades of this offer still running. */
  running: number;
  /** Relays that took the latest version (0 = not on the board yet). */
  relays: number;
  publishedAt: number;
}

export type MarketTradeStatus = 'waiting' | 'invited' | 'swapping' | 'done' | 'declined' | 'expired' | 'cancelled';

export interface MarketTradeView {
  id: string;
  /** maker: you posted the offer; taker: you took it. */
  role: 'maker' | 'taker';
  give: SwapCoinName;
  get: SwapCoinName;
  lbc: Dewies;
  btc: string;
  /**
   * waiting — your take is sent; the other wallet answers within minutes;
   * invited — someone took your offer; their wallet locks first;
   * swapping — the swap runs (see its card); then done, declined, expired or cancelled.
   */
  status: MarketTradeStatus;
  reason?: string;
  /** The swap this trade became. */
  swapId?: string;
  /** The message is not on any relay yet (it is sent again until one takes it). */
  unsent: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MarketRelayView {
  url: string;
  state: 'connecting' | 'open' | 'closed';
  error?: string;
}

export interface MarketView {
  network: NetworkName;
  /** Offers on the board, best price first: people selling LBC, then people buying it. */
  offers: MarketOfferView[];
  mine: MyOfferView[];
  trades: MarketTradeView[];
  relays: MarketRelayView[];
  price: MarketPriceView | null;
  /** The reference price could not be fetched (no price service reachable). */
  priceUnavailable: boolean;
  /** At least one relay has sent what it has. */
  loaded: boolean;
}

/** What a pasted swap code is, before anything is done with it. */
export type SwapCodeView =
  | { type: 'invite'; id: string; network: NetworkName; youGive: SwapCoinName; lbc: Dewies; btc: string; known: boolean }
  | { type: 'lock'; id: string; network: NetworkName; coin: SwapCoinName; known: boolean };

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
  swap: {
    list(): Promise<SwapView[]>;
    /** Starts a swap; the view carries the invite code for the other person. */
    start(params: { give: SwapCoinName; lbc: Dewies; btc: string; btcAddress: string }): Promise<SwapView>;
    inspect(code: string): Promise<SwapCodeView>;
    /** Joins from an invite code. */
    join(params: { code: string; btcAddress: string }): Promise<SwapView>;
    /** Takes the other person's lock code. */
    accept(params: { code: string }): Promise<SwapView>;
    /** Locks your coins: pays LBC from the wallet, or shows where to pay the Bitcoin. */
    lock(params: { id: string; password?: string }): Promise<SwapView>;
    cancel(id: string): Promise<SwapView>;
    remove(id: string): Promise<void>;
    /** Current Bitcoin fee for claiming or refunding a contract, or null when unknown. */
    btcFee(): Promise<{ satPerVbyte: number; claimSats: string } | null>;
  };
  market: {
    /** The board, your offers and trades; keeps the board up to date for a few minutes. */
    view(): Promise<MarketView>;
    /** Posts an offer (amounts in dewies and satoshis; `min` is the smallest part someone can take). */
    post(params: { give: SwapCoinName; lbc: Dewies; btc: string; min: Dewies; btcAddress: string }): Promise<MarketView>;
    /** Takes the offer down; trades already running go on. */
    withdraw(id: string): Promise<MarketView>;
    /** Takes `lbc` dewies of an offer; the other wallet answers within minutes. */
    take(params: { key: string; lbc: Dewies; btcAddress: string }): Promise<MarketTradeView>;
    /** Removes a finished trade from the list (its swap stays in Swaps). */
    dismiss(id: string): Promise<MarketView>;
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
  'swap:changed': SwapView;
  'market:changed': MarketView;
  notice: NoticeView;
}

export const EVENT_CHANNELS: (keyof LbcEvents)[] = ['wallet:changed', 'wallet:locked', 'network:status', 'miner:stats', 'miner:log', 'node:status', 'price:update', 'swap:changed', 'market:changed', 'notice'];

/** How every API call answers: a value, or a user-facing error with a translatable code. */
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string; code?: string; params?: Record<string, string | number> };
