import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  WalletEngine,
  WalletSession,
  candidateSchemes,
  checkPhrase,
  createWalletFile,
  decodeAddress,
  formatLbc,
  generateMnemonic,
  getNetwork,
  parseHeader,
  fromHex,
  passwordStrength,
  scanSchemes,
  suggestWords,
  validateWalletFile,
  walletInfo,
  InsufficientFundsError,
  type ChainBackend,
  type PaymentDraft,
  type TxDetail,
  type TxSummary,
  type WalletFile,
  type WalletInfo,
} from '@lbcwallet/core';
import type {
  AddressView,
  BackendStatusView,
  Contact,
  CreateSource,
  DraftView,
  NoticeView,
  PhraseCheckView,
  SchemeScanView,
  TxDetailView,
  TxListItem,
  WalletListItem,
  WalletOverview,
} from '../shared/api';
import { createBackend } from './backend';
import { listJsonFiles, readJson, removeFile, writeJsonAtomic } from './store';
import type { SettingsStore } from './settings';
import { logger } from './log';

const log = logger('wallet');

export interface WalletServiceEvents {
  changed(overview: WalletOverview): void;
  locked(reason: 'manual' | 'timeout' | 'system'): void;
  network(status: BackendStatusView): void;
  notice(n: NoticeView): void;
}

/** User-facing error: the message is safe to show in the UI. */
export class UserError extends Error {}

export class WalletService {
  private session: WalletSession | null = null;
  private engine: WalletEngine | null = null;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivity = Date.now();
  private changedTimer: ReturnType<typeof setTimeout> | null = null;
  private receivedBatch: { amount: bigint; kind: 'payment' | 'mining' | 'tip' }[] = [];
  private receivedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly settings: SettingsStore,
    private readonly events: WalletServiceEvents,
  ) {
    settings.onChange((next, prev) => {
      const backendChanged =
        next.backendMode !== prev.backendMode ||
        next.useDefaultHubs !== prev.useDefaultHubs ||
        JSON.stringify(next.customHubs) !== JSON.stringify(prev.customHubs) ||
        JSON.stringify(next.lbcd) !== JSON.stringify(prev.lbcd) ||
        JSON.stringify(next.socks5) !== JSON.stringify(prev.socks5);
      if (backendChanged && this.engine) void this.reconnect().catch((e) => log('warn', `reconnect failed: ${(e as Error).message}`));
      if (next.autoLockMinutes !== prev.autoLockMinutes) this.touch();
    });
  }

  private get walletDir(): string {
    return join(this.dataDir, 'wallets');
  }

  private pathFor(id: string): string {
    if (!/^[0-9a-f]{16}$/.test(id)) throw new UserError('Invalid wallet id');
    return join(this.walletDir, `${id}.lbcwallet.json`);
  }

  private readFile(id: string): WalletFile {
    const raw = readJson<unknown>(this.pathFor(id));
    if (!raw) throw new UserError('Wallet file not found');
    return validateWalletFile(raw);
  }

  private saveFile(file: WalletFile): void {
    writeJsonAtomic(this.pathFor(file.id), file, { backup: true });
  }

  // ---------------------------------------------------------------- listing

  list(): WalletListItem[] {
    const network = this.settings.get().network;
    const out: WalletInfo[] = [];
    for (const path of listJsonFiles(this.walletDir, '.lbcwallet.json')) {
      try {
        const file = validateWalletFile(readJson<unknown>(path));
        if (file.network === network) out.push(walletInfo(file));
      } catch {
        log('warn', `skipping unreadable wallet file ${path}`);
      }
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  generateMnemonic(words: 12 | 24): string {
    return generateMnemonic(words === 24 ? 24 : 12);
  }

  checkPhrase(phrase: string): PhraseCheckView {
    const c = checkPhrase(phrase);
    return { words: c.words.length, unknownWords: c.unknownWords, bip39Valid: c.bip39Valid, schemes: candidateSchemes(phrase) };
  }

  suggestWords(prefix: string): string[] {
    return suggestWords(prefix);
  }

  passwordStrength(password: string) {
    return passwordStrength(password);
  }

  /** Looks for funds under each derivation scheme (used during restore). */
  async scan(phrase: string, passphrase?: string): Promise<SchemeScanView[]> {
    const backend = createBackend(this.settings.get());
    try {
      await withTimeout(backend.start(), 45_000, 'Could not reach the LBRY network to check for funds');
      return await scanSchemes(phrase, getNetwork(this.settings.get().network), backend, { passphrase });
    } finally {
      await backend.stop().catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------- lifecycle

  async create(params: { name: string; password: string; source: CreateSource }): Promise<WalletOverview> {
    if (params.password.length < 8) throw new UserError('Use a password of at least 8 characters');
    const file = await createWalletFile({ name: params.name, network: this.settings.get().network, source: params.source, password: params.password });
    this.saveFile(file);
    log('info', `created wallet ${file.id} (${file.kind}/${file.scheme})`);
    return this.open(file.id, params.password);
  }

  async open(id: string, password: string): Promise<WalletOverview> {
    const file = this.readFile(id);
    if (file.network !== this.settings.get().network) throw new UserError('This wallet belongs to a different network');
    await this.lock('manual', false);
    const s = this.settings.get();
    const session = await WalletSession.unlock(file, password, { keepKeys: !s.requirePasswordToSend });
    let backend: ChainBackend;
    try {
      backend = createBackend(s);
    } catch (err) {
      session.lock();
      throw new UserError((err as Error).message);
    }
    const engine = new WalletEngine({
      network: session.network,
      deriver: session.deriver,
      backend,
      state: session.state,
      gap: file.scheme === 'lbry' ? { receive: 20, change: 10 } : { receive: 20, change: 20 },
      persist: (state) => {
        if (this.session !== session) return;
        try {
          this.saveFile(session.snapshot(state));
        } catch (err) {
          log('error', `failed to save wallet: ${(err as Error).message}`);
        }
      },
      log: logger('sync'),
    });
    this.session = session;
    this.engine = engine;
    this.settings.update({ lastWalletId: id });
    engine.on('changed', () => this.scheduleChanged());
    engine.on('sync', () => this.scheduleChanged());
    engine.on('notice', (n) => {
      if (n.kind === 'received' && n.amount !== undefined) {
        this.queueReceived(n.amount, n.type === 'mining' ? 'mining' : n.type === 'tip-in' ? 'tip' : 'payment');
      } else if (n.kind === 'dropped') {
        this.events.notice({ kind: 'dropped', title: 'Transaction dropped', message: `${n.txid.slice(0, 16)}… was not confirmed and has been removed.` });
      }
    });
    backend.on('status', (st) => this.events.network(st));
    // Connect in the background so unlocking is instant even when offline.
    void engine.start().catch((err) => log('warn', `initial sync failed: ${(err as Error).message}`));
    this.touch();
    log('info', `opened wallet ${id}`);
    return this.overview()!;
  }

  async lock(reason: 'manual' | 'timeout' | 'system' = 'manual', notify = true): Promise<void> {
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = null;
    const engine = this.engine;
    const session = this.session;
    this.engine = null;
    this.session = null;
    if (engine) {
      try {
        engine.flush();
      } catch {
        // already logged by persist
      }
      await engine.stop().catch(() => undefined);
    }
    session?.lock();
    if (session && notify) {
      log('info', `wallet locked (${reason})`);
      this.events.locked(reason);
    }
  }

  get isOpen(): boolean {
    return !!this.engine;
  }

  /** Records user activity for the auto-lock timer. */
  touch(): void {
    this.lastActivity = Date.now();
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = null;
    const minutes = this.settings.get().autoLockMinutes;
    if (!this.engine || minutes <= 0) return;
    this.lockTimer = setTimeout(() => void this.lock('timeout'), minutes * 60_000);
  }

  private requireOpen(): { session: WalletSession; engine: WalletEngine } {
    if (!this.session || !this.engine) throw new UserError('No wallet is open');
    return { session: this.session, engine: this.engine };
  }

  async remove(id: string, password: string): Promise<void> {
    const file = this.readFile(id);
    const probe = await WalletSession.unlock(file, password).catch(() => {
      throw new UserError('Incorrect password');
    });
    probe.lock();
    if (this.session?.file.id === id) await this.lock('manual');
    removeFile(this.pathFor(id));
    if (this.settings.get().lastWalletId === id) this.settings.update({ lastWalletId: null });
    log('info', `deleted wallet ${id}`);
  }

  rename(name: string): WalletOverview {
    const { session } = this.requireOpen();
    this.saveFile(session.rename(name));
    return this.overview()!;
  }

  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < 8) throw new UserError('Use a password of at least 8 characters');
    const { session, engine } = this.requireOpen();
    session.snapshot(engine.state);
    const file = await session.changePassword(oldPassword, newPassword);
    this.saveFile(file);
    log('info', 'wallet password changed');
  }

  async reveal(password: string) {
    const { session } = this.requireOpen();
    const src = await session.revealSecret(password);
    if (src.type === 'mnemonic') return { type: 'mnemonic' as const, secret: src.mnemonic, passphrase: src.passphrase, scheme: src.scheme };
    if (src.type === 'xprv') return { type: 'xprv' as const, secret: src.xprv };
    return { type: 'watch' as const, secret: src.xpub };
  }

  xpub(): string {
    return this.requireOpen().session.xpub;
  }

  async reconnect(): Promise<void> {
    const { engine } = this.requireOpen();
    const backend = createBackend(this.settings.get());
    backend.on('status', (st) => this.events.network(st));
    await engine.replaceBackend(backend);
  }

  async rescan(): Promise<void> {
    const { engine } = this.requireOpen();
    for (const a of engine.state.addresses) a.status = null;
    await engine.fullSync();
  }

  /** Coalesces bursts of incoming transactions (e.g. many block rewards) into one notice. */
  private queueReceived(amount: bigint, kind: 'payment' | 'mining' | 'tip') {
    this.receivedBatch.push({ amount, kind });
    if (this.receivedTimer) return;
    this.receivedTimer = setTimeout(() => {
      const batch = this.receivedBatch;
      this.receivedBatch = [];
      this.receivedTimer = null;
      const total = batch.reduce((sum, b) => sum + b.amount, 0n);
      const kinds = new Set(batch.map((b) => b.kind));
      const only = kinds.size === 1 ? batch[0]!.kind : null;
      const noun = only === 'mining' ? 'mining reward' : only === 'tip' ? 'tip' : 'payment';
      const title = batch.length === 1 ? `${noun[0]!.toUpperCase()}${noun.slice(1)} received` : `${batch.length} ${noun}s received`;
      const suffix = only === 'mining' ? ' · spendable after 100 confirmations' : '';
      this.events.notice({ kind: 'received', title, message: `+${formatLbc(total)} LBC${suffix}` });
    }, 2500);
  }

  // ---------------------------------------------------------------- views

  private scheduleChanged() {
    if (this.changedTimer) return;
    this.changedTimer = setTimeout(() => {
      this.changedTimer = null;
      const o = this.overview();
      if (o) this.events.changed(o);
    }, 150);
  }

  overview(): WalletOverview | null {
    if (!this.session || !this.engine) return null;
    const { session, engine } = this;
    const b = engine.getBalance();
    const tip = engine.state.tip;
    return {
      id: session.file.id,
      name: session.file.name,
      network: session.file.network,
      kind: session.file.kind,
      scheme: session.file.scheme,
      watchOnly: session.watchOnly,
      balance: { available: s(b.available), pending: s(b.pending), immature: s(b.immature), supports: s(b.supports), claims: s(b.claims), total: s(b.total) },
      receiveAddress: engine.getReceiveAddress(),
      tipHeight: engine.tipHeight,
      tipBits: tip ? parseHeader(fromHex(tip.header)).bits : null,
      sync: { ...engine.syncInfo },
      backend: engine.getBackend().getStatus(),
      txCount: Object.keys(engine.state.txs).length,
    };
  }

  transactions(): TxListItem[] {
    return this.requireOpen().engine.getTransactions().map(txView);
  }

  transaction(txid: string): TxDetailView | null {
    const d = this.requireOpen().engine.getTransaction(txid);
    if (!d) return null;
    const tmpl = this.settings.get().explorerTxUrl;
    return detailView(d, this.settings.get().network === 'mainnet' && tmpl ? tmpl.replace('{txid}', d.txid) : null);
  }

  addresses(): AddressView[] {
    return this.requireOpen()
      .engine.listAddresses()
      .map((a) => ({ ...a, balance: s(a.balance) }));
  }

  newAddress() {
    return this.requireOpen().engine.newReceiveAddress();
  }

  setLabel(key: string, label: string): void {
    this.requireOpen().engine.setLabel(key, label);
  }

  validateAddress(address: string): { valid: boolean; error?: string; mine?: boolean } {
    const network = getNetwork(this.settings.get().network);
    try {
      decodeAddress(address, network);
      return { valid: true, mine: this.engine?.isMine(address.trim()) ?? false };
    } catch (err) {
      return { valid: false, error: (err as Error).message };
    }
  }

  // ---------------------------------------------------------------- sending

  prepareSend(params: { address: string; amount: string | 'max'; feePerByte?: number }): DraftView {
    const { engine, session } = this.requireOpen();
    if (session.watchOnly) throw new UserError('This is a watch-only wallet. Import the recovery phrase to send.');
    const v = this.validateAddress(params.address);
    if (!v.valid) throw new UserError(v.error ?? 'Invalid address');
    const amount = params.amount === 'max' ? 'max' : BigInt(params.amount);
    if (amount !== 'max' && amount <= 0n) throw new UserError('Enter an amount greater than zero');
    try {
      return draftView(engine.createPayment({ address: params.address.trim(), amount, feePerByte: params.feePerByte ?? this.settings.get().feePerByte }));
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        throw new UserError(`Insufficient funds: you need ${formatLbc(err.needed)} LBC including the fee, but only ${formatLbc(err.available)} LBC is spendable.`);
      }
      throw new UserError((err as Error).message);
    }
  }

  prepareUnlock(): DraftView {
    const { engine, session } = this.requireOpen();
    if (session.watchOnly) throw new UserError('This is a watch-only wallet.');
    try {
      return draftView(engine.createUnlockSupports(this.settings.get().feePerByte));
    } catch (err) {
      throw new UserError((err as Error).message);
    }
  }

  async send(params: { draftId: string; password?: string; label?: string }): Promise<{ txid: string }> {
    const { engine, session } = this.requireOpen();
    const draft = engine.getDraft(params.draftId);
    if (!draft) throw new UserError('This transaction is no longer valid; please review it again.');
    const needPassword = this.settings.get().requirePasswordToSend || !session.keysInMemory;
    let keys: Awaited<ReturnType<WalletSession['keyProvider']>>;
    try {
      keys = await session.keyProvider(needPassword ? (params.password ?? '') : undefined);
    } catch (err) {
      throw new UserError((err as Error).message === 'Incorrect password' ? 'Incorrect password' : (err as Error).message);
    }
    let txid: string;
    try {
      const tx = engine.sign(draft, keys.provider);
      txid = await engine.broadcast(tx, params.label);
    } catch (err) {
      const msg = (err as Error).message;
      log('warn', `send failed: ${msg}`);
      throw new UserError(msg.includes('rejected') ? `The network rejected the transaction: ${msg}` : msg);
    } finally {
      keys.release();
    }
    log('info', `broadcast ${txid}`);
    this.touch();
    return { txid };
  }

  // ---------------------------------------------------------------- contacts & export

  contacts(): Contact[] {
    return [...this.requireOpen().engine.state.contacts].sort((a, b) => a.name.localeCompare(b.name));
  }

  saveContact(c: Omit<Contact, 'id'> & { id?: string }): Contact[] {
    const { engine } = this.requireOpen();
    const v = this.validateAddress(c.address);
    if (!v.valid) throw new UserError(v.error ?? 'Invalid address');
    const name = c.name.trim().slice(0, 80);
    if (!name) throw new UserError('Enter a name');
    const contact: Contact = { id: c.id ?? randomUUID(), name, address: c.address.trim(), note: c.note?.trim().slice(0, 500) || undefined };
    const list = engine.state.contacts.filter((x) => x.id !== contact.id);
    list.push(contact);
    engine.state.contacts = list;
    engine.stateChanged();
    return this.contacts();
  }

  deleteContact(id: string): Contact[] {
    const { engine } = this.requireOpen();
    engine.state.contacts = engine.state.contacts.filter((x) => x.id !== id);
    engine.stateChanged();
    return this.contacts();
  }

  exportCsv(path: string): void {
    const rows = [['date', 'txid', 'type', 'amount_lbc', 'fee_lbc', 'confirmations', 'counterparty', 'label']];
    for (const t of this.requireOpen().engine.getTransactions()) {
      rows.push([
        new Date(t.time * 1000).toISOString(),
        t.txid,
        t.type,
        formatLbc(t.amount, { minDecimals: 8, group: false }),
        t.fee === null ? '' : formatLbc(t.fee, { minDecimals: 8, group: false }),
        String(t.confirmations),
        t.counterparty ?? '',
        t.label ?? '',
      ]);
    }
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
    writeFileSync(path, csv + '\n', { mode: 0o600 });
  }

  /** Current receiving address of the open wallet (mining payout default). */
  miningAddress(): string | null {
    return this.engine?.getReceiveAddress() ?? null;
  }

  tipBits(): { height: number; bits: number } | null {
    const tip = this.engine?.state.tip;
    return tip ? { height: tip.height, bits: parseHeader(fromHex(tip.header)).bits } : null;
  }

  async shutdown(): Promise<void> {
    await this.lock('manual', false);
  }
}

function s(v: bigint): string {
  return v.toString();
}

function txView(t: TxSummary): TxListItem {
  return { ...t, amount: s(t.amount), fee: t.fee === null ? null : s(t.fee) };
}

function detailView(d: TxDetail, explorerUrl: string | null): TxDetailView {
  return {
    ...txView(d),
    inputs: d.inputs.map((i) => ({ ...i, value: i.value === null ? null : s(i.value) })),
    outputs: d.outputs.map((o) => ({ ...o, value: s(o.value) })),
    size: d.size,
    explorerUrl,
  };
}

function draftView(d: PaymentDraft): DraftView {
  return {
    id: d.id,
    kind: d.kind,
    recipients: d.recipients.map((r) => ({ address: r.address, value: s(r.value) })),
    fee: s(d.fee),
    feePerByte: d.feePerByte,
    change: s(d.change),
    total: s(d.total),
    size: d.size,
    inputCount: d.payment.inputs.length,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new UserError(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
