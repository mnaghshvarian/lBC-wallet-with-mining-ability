import { create } from 'zustand';
import type { AppInfo, MinerLogEntry, MinerStatsView, NoticeView, PriceView, Settings, WalletListItem, WalletOverview } from '../../shared/api';

export type Route =
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
  | { name: 'contacts' }
  | { name: 'settings'; tab?: string };

export const WALLET_ROUTES = new Set(['overview', 'send', 'receive', 'activity', 'mining', 'contacts', 'settings']);

export interface Toast extends NoticeView {
  id: number;
}

interface AppState {
  booted: boolean;
  info: AppInfo | null;
  settings: Settings | null;
  wallets: WalletListItem[];
  overview: WalletOverview | null;
  price: PriceView | null;
  miner: MinerStatsView | null;
  minerLog: MinerLogEntry[];
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
  toast: (n: NoticeView) => void;
  dismiss: (id: number) => void;
}

let toastSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  info: null,
  settings: null,
  wallets: [],
  overview: null,
  price: null,
  miner: null,
  minerLog: [],
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
    const [info, settings, wallets, overview, price, miner, minerLog] = await Promise.all([
      api.app.info(),
      api.settings.get(),
      api.wallets.list(),
      api.wallet.overview(),
      api.price.get(),
      api.miner.status(),
      api.miner.logs(),
    ]);
    applyTheme(settings.theme);
    let route: Route = { name: 'welcome' };
    if (overview) route = { name: 'overview' };
    else if (settings.lastWalletId && wallets.some((w) => w.id === settings.lastWalletId)) route = { name: 'unlock', walletId: settings.lastWalletId };
    set({ booted: true, info, settings, wallets, overview, price, miner, minerLog, route });

    api.on('wallet:changed', (o) => set((s) => ({ overview: o, version: s.version + 1 })));
    api.on('wallet:locked', ({ reason }) => {
      const id = get().overview?.id;
      set({ overview: null, route: id ? { name: 'unlock', walletId: id } : { name: 'welcome' } });
      if (reason === 'timeout') get().toast({ kind: 'locked', title: 'Wallet locked', message: 'Locked automatically after inactivity.' });
      if (reason === 'system') get().toast({ kind: 'locked', title: 'Wallet locked', message: 'Locked because the computer went to sleep or the screen was locked.' });
    });
    api.on('network:status', (st) => set((s) => (s.overview ? { overview: { ...s.overview, backend: st } } : {})));
    api.on('miner:stats', (m) =>
      set((s) => {
        const history = m.state === 'stopped' ? s.hashrateHistory : [...s.hashrateHistory, { t: Date.now(), v: m.hashrate }].slice(-300);
        return { miner: m, hashrateHistory: history };
      }),
    );
    api.on('miner:log', (e) => set((s) => ({ minerLog: [...s.minerLog, e].slice(-500) })));
    api.on('price:update', (p) => set({ price: p }));
    api.on('notice', (n) => get().toast(n));

    // Feed the auto-lock timer with user activity.
    const activity = () => api.app.activity();
    window.addEventListener('mousedown', activity, { passive: true });
    window.addEventListener('keydown', activity, { passive: true });
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
    set({ settings, price });
    return settings;
  },

  setOverview: (o) => set((s) => ({ overview: o, version: s.version + 1 })),

  toast: (n) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { ...n, id }].slice(-3) }));
    setTimeout(() => get().dismiss(id), n.kind === 'error' ? 8000 : 5500);
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

const media = window.matchMedia('(prefers-color-scheme: dark)');
let currentTheme: Settings['theme'] = 'system';

export function applyTheme(theme: Settings['theme']): void {
  currentTheme = theme;
  const dark = theme === 'dark' || (theme === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
media.addEventListener('change', () => applyTheme(currentTheme));

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
