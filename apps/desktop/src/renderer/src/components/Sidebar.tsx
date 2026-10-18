import { Activity, ArrowDownLeft, ArrowUpRight, ChevronsUpDown, LayoutDashboard, Lock, Pickaxe, Settings as SettingsIcon, Users } from 'lucide-react';
import logo from '../assets/logo.svg';
import { useApp, type Route } from '../store';
import { formatHashrate, number } from '../lib/format';

const NAV: { route: Route['name']; label: string; icon: typeof Activity }[] = [
  { route: 'overview', label: 'Overview', icon: LayoutDashboard },
  { route: 'send', label: 'Send', icon: ArrowUpRight },
  { route: 'receive', label: 'Receive', icon: ArrowDownLeft },
  { route: 'activity', label: 'Activity', icon: Activity },
  { route: 'mining', label: 'Mining', icon: Pickaxe },
  { route: 'contacts', label: 'Contacts', icon: Users },
  { route: 'settings', label: 'Settings', icon: SettingsIcon },
];

export function Sidebar() {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const overview = useApp((s) => s.overview);
  const miner = useApp((s) => s.miner);
  if (!overview) return null;
  const b = overview.backend;
  const sync = overview.sync;
  const dot = !b.connected ? 'bad' : sync.state === 'syncing' || sync.state === 'connecting' ? 'busy' : 'ok';
  const statusText = !b.connected ? (b.error ? 'Disconnected' : 'Connecting…') : sync.state === 'syncing' ? 'Syncing…' : 'Connected';
  const mining = miner && miner.state !== 'stopped' && miner.state !== 'error';

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src={logo} alt="" />
        <div>
          <div className="brand-name">LBC Wallet</div>
          <div className="brand-sub">{overview.network === 'mainnet' ? 'LBRY Credits' : `LBC ${overview.network}`}</div>
        </div>
      </div>

      <button className="wallet-switch" onClick={() => void window.lbc.wallets.lock()} title="Lock and switch wallet">
        <div className="wallet-avatar">{overview.name.slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="name">{overview.name}</div>
          <div className="meta">{overview.watchOnly ? 'Watch-only' : overview.scheme === 'lbry' ? 'LBRY-compatible' : overview.scheme === 'bip44' ? 'Standard (BIP44)' : 'Imported key'}</div>
        </div>
        <ChevronsUpDown size={16} color="var(--text-3)" />
      </button>

      <nav className="nav">
        {NAV.map(({ route: r, label, icon: Icon }) => (
          <button key={r} className={`nav-item ${route.name === r ? 'active' : ''}`} onClick={() => navigate({ name: r } as Route)}>
            <Icon size={18} />
            {label}
            {r === 'mining' && mining && <span className="pill">{formatHashrate(miner!.hashrate)}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="net-status" title={b.error ?? b.server ?? ''}>
          <span className={`dot ${dot}`} />
          <div style={{ minWidth: 0 }}>
            <div>{statusText}</div>
            <div className="line2 ellipsis">
              {b.connected ? `${b.server ?? ''}${overview.tipHeight ? ` · #${number(overview.tipHeight)}` : ''}` : (b.error ?? 'Looking for a server')}
            </div>
          </div>
        </div>
        <button className="nav-item" onClick={() => void window.lbc.wallets.lock()}>
          <Lock size={18} /> Lock wallet
        </button>
      </div>
    </aside>
  );
}
