import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronsUpDown,
  HardDrive,
  LayoutDashboard,
  Lock,
  MoreHorizontal,
  Pickaxe,
  Settings as SettingsIcon,
  Users,
  X,
} from 'lucide-react';
import logo from '../assets/logo.svg';
import { useApp, useT, type Route } from '../store';
import { formatHashrate, number, percent } from '../lib/format';

type NavItem = { route: Route['name']; key: string; icon: typeof Activity };

const NAV: NavItem[] = [
  { route: 'overview', key: 'nav.overview', icon: LayoutDashboard },
  { route: 'send', key: 'nav.send', icon: ArrowUpRight },
  { route: 'receive', key: 'nav.receive', icon: ArrowDownLeft },
  { route: 'activity', key: 'nav.activity', icon: Activity },
  { route: 'mining', key: 'nav.mining', icon: Pickaxe },
  { route: 'swap', key: 'nav.swap', icon: ArrowLeftRight },
  { route: 'node', key: 'nav.node', icon: HardDrive },
  { route: 'contacts', key: 'nav.contacts', icon: Users },
  { route: 'settings', key: 'nav.settings', icon: SettingsIcon },
];

function useNavItems(): NavItem[] {
  const info = useApp((s) => s.info);
  return NAV.filter((n) => n.route !== 'node' || info?.capabilities.node);
}

/** Connection summary shown in the sidebar footer and the mobile top bar. */
function useNetStatus() {
  const t = useT();
  const overview = useApp((s) => s.overview);
  if (!overview) return null;
  const b = overview.backend;
  const sync = overview.sync;
  const dot = !b.connected ? 'bad' : sync.state === 'syncing' || sync.state === 'connecting' ? 'busy' : 'ok';
  const text = !b.connected ? (b.error ? t('net.disconnected') : t('net.connecting')) : sync.state === 'syncing' ? t('net.syncing') : t('net.connected');
  const line2 = b.connected
    ? `${b.kind === 'lbcd' ? t('net.yourNode') : (b.server ?? '')}${overview.tipHeight ? ` · #${number(overview.tipHeight)}` : ''}`
    : (b.error ?? t('net.lookingForServer'));
  return { dot, text, line2, title: b.error ?? b.server ?? '' };
}

function walletKind(t: ReturnType<typeof useT>, o: { watchOnly: boolean; scheme: string }): string {
  if (o.watchOnly) return t('walletKind.watch');
  if (o.scheme === 'lbry') return t('walletKind.lbry');
  if (o.scheme === 'bip44') return t('walletKind.bip44');
  return t('walletKind.imported');
}

export function Sidebar() {
  const t = useT();
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const overview = useApp((s) => s.overview);
  const miner = useApp((s) => s.miner);
  const node = useApp((s) => s.node);
  const items = useNavItems();
  const net = useNetStatus();
  if (!overview || !net) return null;
  const mining = miner && miner.state !== 'stopped' && miner.state !== 'error';
  const nodeBusy = node && (node.state === 'syncing' || node.state === 'starting');

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={logo} alt="" />
        <div>
          <div className="brand-name">LBC Wallet</div>
          <div className="brand-sub">{overview.network === 'mainnet' ? t('brand.mainnet') : `LBC ${overview.network}`}</div>
        </div>
      </div>

      <button className="wallet-switch" onClick={() => void window.lbc.wallets.lock()} title={t('nav.switchWallet')}>
        <div className="wallet-avatar">{overview.name.slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="name">{overview.name}</div>
          <div className="meta">{walletKind(t, overview)}</div>
        </div>
        <ChevronsUpDown size={16} color="var(--text-3)" />
      </button>

      <nav className="nav">
        {items.map(({ route: r, key, icon: Icon }) => (
          <button key={r} className={`nav-item ${route.name === r ? 'active' : ''}`} onClick={() => navigate({ name: r } as Route)}>
            <Icon size={18} />
            {t(key)}
            {r === 'mining' && mining && <span className="pill">{formatHashrate(miner!.hashrate)}</span>}
            {r === 'node' && nodeBusy && <span className="pill">{percent(node!.progress, 0)}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="net-status" title={net.title}>
          <span className={`dot ${net.dot}`} />
          <div style={{ minWidth: 0 }}>
            <div>{net.text}</div>
            <div className="line2 ellipsis">{net.line2}</div>
          </div>
        </div>
        <button className="nav-item" onClick={() => void window.lbc.wallets.lock()}>
          <Lock size={18} /> {t('nav.lock')}
        </button>
      </div>
    </aside>
  );
}

/** Phone layout: wallet name and connection on top. */
export function TopBar() {
  const t = useT();
  const overview = useApp((s) => s.overview);
  const net = useNetStatus();
  if (!overview || !net) return null;
  return (
    <header className="topbar">
      <img src={logo} alt="" className="topbar-logo" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="name ellipsis">{overview.name}</div>
        <div className="meta ellipsis">
          <span className={`dot ${net.dot}`} /> {net.text}
        </div>
      </div>
      <button className="btn ghost icon-btn" aria-label={t('nav.lock')} title={t('nav.lock')} onClick={() => void window.lbc.wallets.lock()}>
        <Lock size={18} />
      </button>
    </header>
  );
}

/** Phone layout: the four main destinations plus "More". */
export function BottomNav() {
  const t = useT();
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const items = useNavItems();
  const [more, setMore] = useState(false);
  const main = items.slice(0, 4);
  const rest = items.slice(4);
  const inRest = rest.some((i) => i.route === route.name);
  useEffect(() => {
    if (!more) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMore(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [more]);
  return (
    <>
      <nav className="bottom-nav">
        {main.map(({ route: r, key, icon: Icon }) => (
          <button key={r} className={route.name === r ? 'active' : ''} onClick={() => navigate({ name: r } as Route)}>
            <Icon size={22} />
            <span>{t(key)}</span>
          </button>
        ))}
        <button className={inRest ? 'active' : ''} onClick={() => setMore(true)}>
          <MoreHorizontal size={22} />
          <span>{t('nav.more')}</span>
        </button>
      </nav>
      {more && (
        <div className="overlay sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && setMore(false)}>
          <div className="sheet" role="dialog" aria-modal="true">
            <div className="sheet-header">
              <h2>{t('nav.more')}</h2>
              <div className="spacer" />
              <button className="btn ghost icon-btn" aria-label={t('common.close')} onClick={() => setMore(false)}>
                <X size={18} />
              </button>
            </div>
            {rest.map(({ route: r, key, icon: Icon }) => (
              <button
                key={r}
                className={`nav-item ${route.name === r ? 'active' : ''}`}
                onClick={() => {
                  setMore(false);
                  navigate({ name: r } as Route);
                }}
              >
                <Icon size={20} /> {t(key)}
              </button>
            ))}
            <button className="nav-item" onClick={() => void window.lbc.wallets.lock()}>
              <Lock size={20} /> {t('nav.lock')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
