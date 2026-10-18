import { create } from 'zustand';
import type {
  AppInfo,
  MinerLogEntry,
  MinerStatsView,
  NodeStatusView,
  NoticeView,
  PriceView,
  Settings,
  WalletListItem,
  WalletOverview,
} from '@lbcwallet/services/api';
import { createTranslator, languageInfo, resolveLanguage, type Params, type Translate } from './i18n';
import { lbc, setFormatLanguage } from './lib/format';

/** Version of the disclaimer users must accept (bump when its substance changes). */
export const TERMS_VERSION = '2026-10';

export type Route =
  | { name: 'terms' }
  | { name: 'welcome' }
  | { name: 'create' }
  | { name: 'restore' }
  | { name: 'import' }
  | { name: 'unlock'; walletId: string }
  | { name: 'overview' }
  | { name: 'send'; to?: string }
  | { name: 'receive' }
  | { name: 'activity'; txid?: string }
  | { name: 'mining' }
  | { name: 'market' }
  | { name: 'swap' }
  | { name: 'node' }
  | { name: 'contacts' }
  | { name: 'settings'; tab?: string };

export const WALLET_ROUTES = new Set(['overview', 'send', 'receive', 'activity', 'mining', 'market', 'swap', 'node', 'contacts', 'settings']);

export interface Toast {
  id: number;
  kind: NoticeView['kind'];
  title: string;
  message?: string;
}

interface AppState {
  booted: boolean;
  info: AppInfo | null;
  settings: Settings | null;
  /** Resolved UI language code and its translator. */
  language: string;
  t: Translate;
  wallets: WalletListItem[];
  overview: WalletOverview | null;
  price: PriceView | null;
  miner: MinerStatsView | null;
  minerLog: MinerLogEntry[];
  node: NodeStatusView | null;
  hashrateHistory: { t: number; v: number }[];
  route: Route;
  toasts: Toast[];
  /** Bumped whenever wallet data changes so pages can refetch. */
  version: number;
  navigate: (route: Route) => void;
  boot: () => Promise<void>;
  refreshWallets: () => Promise<WalletListItem[]>;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  setOverview: (o: WalletOverview | null) => void;
  toast: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 0;

function languageFor(settings: Settings): string {
  return resolveLanguage(settings.language, typeof navigator !== 'undefined' ? navigator.languages : []);
}

function applyLanguage(lang: string): Translate {
  const t = createTranslator(lang);
  setFormatLanguage(lang, t);
  document.documentElement.lang = lang;
  document.documentElement.dir = languageInfo(lang).dir;
  return t;
}

/** Words a service notification in the current language. */
export function noticeText(n: NoticeView, t: Translate): { title: string; message?: string } {
  const p = (n.params ?? {}) as Params;
  switch (n.code) {
    case 'received': {
      const count = Number(p.count ?? 1);
      const what = String(p.what ?? 'payment');
      const amount = `+${lbc(String(p.amount ?? '0'))} LBC`;
      const title = t(`notice.received.${what}`, { count });
      return { title, message: what === 'mining' ? t('notice.received.maturing', { amount }) : amount };
    }
    case 'dropped':
      return { title: t('notice.dropped.title'), message: t('notice.dropped.message', { txid: `${String(p.txid ?? '').slice(0, 16)}…` }) };
    case 'blockFound':
      return { title: t('notice.blockFound.title'), message: t('notice.blockFound.message', p) };
    case 'lockedTimeout':
      return { title: t('notice.locked.title'), message: t('notice.locked.timeout') };
    case 'lockedSystem':
      return { title: t('notice.locked.title'), message: t('notice.locked.system') };
    case 'nodeSynced':
      return { title: t('notice.nodeSynced.title'), message: t('notice.nodeSynced.message', p) };
    case 'nodeStopped':
      return { title: t('notice.nodeStopped.title'), message: t('notice.nodeStopped.message', p) };
    case 'swapReadyToLock':
      return { title: t('notice.swapReadyToLock.title'), message: t('notice.swapReadyToLock.message', p) };
    case 'swapCompleted':
      return { title: t('notice.swapCompleted.title'), message: t('notice.swapCompleted.message', p) };
    case 'swapRefunded':
      return { title: t('notice.swapRefunded.title'), message: t('notice.swapRefunded.message', p) };
    case 'marketTaken':
      return { title: t('notice.marketTaken.title'), message: t('notice.marketTaken.message', { amount: `${lbc(String(p.lbc ?? '0'))} LBC` }) };
    case 'marketAccepted':
      return { title: t('notice.marketAccepted.title'), message: t('notice.marketAccepted.message', p) };
    case 'marketDeclined':
      return { title: t('notice.marketDeclined.title'), message: t(`market.trade.declined.${String(p.reason ?? 'closed')}`, { lbc: '', btc: '' }) };
    default:
      return { title: t('notice.error'), message: String(p.message ?? '') };
  }
}

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  info: null,
  settings: null,
  language: 'en',
  t: createTranslator('en'),
  wallets: [],
  overview: null,
  price: null,
  miner: null,
  minerLog: [],
  node: null,
  hashrateHistory: [],
  route: { name: 'welcome' },
  toasts: [],
  version: 0,

  navigate: (route) => {
    const { overview } = get();
    if (WALLET_ROUTES.has(route.name) && !overview) return;
    set({ route });
  },

  boot: async () => {
    const api = window.lbc;
    const [info, settings, wallets, overview, price, miner, minerLog, node] = await Promise.all([
      api.app.info(),
      api.settings.get(),
      api.wallets.list(),
      api.wallet.overview(),
      api.price.get(),
      api.miner.status(),
      api.miner.logs(),
      api.node.status().catch(() => null),
    ]);
    applyTheme(settings.theme);
    const language = languageFor(settings);
    const t = applyLanguage(language);
    let route: Route = { name: 'welcome' };
    if (settings.acceptedTerms !== TERMS_VERSION) route = { name: 'terms' };
    else if (overview) route = { name: 'overview' };
    else if (settings.lastWalletId && wallets.some((w) => w.id === settings.lastWalletId)) route = { name: 'unlock', walletId: settings.lastWalletId };
    set({ booted: true, info, settings, language, t, wallets, overview, price, miner, minerLog, node, route });

    api.on('wallet:changed', (o) => set((s) => ({ overview: o, version: s.version + 1 })));
    api.on('wallet:locked', ({ reason }) => {
      const id = get().overview?.id;
      set({ overview: null, route: id ? { name: 'unlock', walletId: id } : { name: 'welcome' } });
      if (reason === 'timeout') get().toast({ kind: 'locked', ...noticeText({ kind: 'locked', code: 'lockedTimeout' }, get().t) });
      if (reason === 'system') get().toast({ kind: 'locked', ...noticeText({ kind: 'locked', code: 'lockedSystem' }, get().t) });
    });
    api.on('network:status', (st) => set((s) => (s.overview ? { overview: { ...s.overview, backend: st } } : {})));
    api.on('miner:stats', (m) =>
      set((s) => {
        const history = m.state === 'stopped' ? s.hashrateHistory : [...s.hashrateHistory, { t: Date.now(), v: m.hashrate }].slice(-300);
        return { miner: m, hashrateHistory: history };
      }),
    );
    api.on('miner:log', (e) => set((s) => ({ minerLog: [...s.minerLog, e].slice(-500) })));
    api.on('node:status', (n) => set({ node: n }));
    api.on('price:update', (p) => set({ price: p }));
    api.on('notice', (n) => get().toast({ kind: n.kind, ...noticeText(n, get().t) }));

    // Feed the auto-lock timer with user activity.
    const activity = () => api.app.activity();
    window.addEventListener('mousedown', activity, { passive: true });
    window.addEventListener('keydown', activity, { passive: true });
    window.addEventListener('touchstart', activity, { passive: true });
  },

  refreshWallets: async () => {
    const wallets = await window.lbc.wallets.list();
    set({ wallets });
    return wallets;
  },

  updateSettings: async (patch) => {
    const settings = await window.lbc.settings.update(patch);
    applyTheme(settings.theme);
    const price = settings.showFiat ? get().price : null;
    const language = languageFor(settings);
    if (language !== get().language) set({ language, t: applyLanguage(language) });
    set({ settings, price });
    return settings;
  },

  setOverview: (o) => set((s) => ({ overview: o, version: s.version + 1 })),

  toast: (toast) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-3) }));
    setTimeout(() => get().dismiss(id), toast.kind === 'error' ? 8000 : 5500);
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/**
 * The Android back button: closes the top dialog, else goes one level up.
 * Returns false at the top level, where the app should move to the background.
 */
export function goBack(): boolean {
  if (document.querySelector('.overlay, .drawer')) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    return true;
  }
  const { route, overview } = useApp.getState();
  switch (route.name) {
    case 'create':
    case 'restore':
    case 'import':
      useApp.setState({ route: { name: 'welcome' } });
      return true;
    case 'overview':
    case 'welcome':
    case 'unlock':
    case 'terms':
      return false;
    default:
      if (!overview) return false;
      useApp.setState({ route: { name: 'overview' } });
      return true;
  }
}

/** The translator for the current UI language. */
export function useT(): Translate {
  return useApp((s) => s.t);
}

const media = window.matchMedia('(prefers-color-scheme: dark)');
let currentTheme: Settings['theme'] = 'system';

export function applyTheme(theme: Settings['theme']): void {
  currentTheme = theme;
  const dark = theme === 'dark' || (theme === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
media.addEventListener('change', () => applyTheme(currentTheme));

/** A user-facing message for an error from the services, in the current language. */
export function errorMessage(err: unknown): string {
  const e = err as { message?: string; code?: string; params?: Params } | null;
  if (e?.code) {
    const t = useApp.getState().t;
    const key = `error.${e.code}`;
    const text = t(key, e.params);
    if (text !== key) return text;
  }
  if (typeof e?.message === 'string') return e.message;
  return String(err);
}

/** The translated error carried by a status view (`error` plus optional `errorCode`/`errorParams`). */
export function viewError(v: { error?: string; errorCode?: string; errorParams?: Params } | null | undefined): string | undefined {
  if (!v?.error) return undefined;
  return errorMessage({ message: v.error, code: v.errorCode, params: v.errorParams });
}
