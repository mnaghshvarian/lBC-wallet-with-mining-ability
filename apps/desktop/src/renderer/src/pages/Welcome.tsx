import { ChevronRight, FileKey2, KeyRound, Plus, ShieldCheck, Wallet } from 'lucide-react';
import logo from '../assets/logo.svg';
import { useApp } from '../store';
import { Badge } from '../components/ui';

export function Welcome() {
  const wallets = useApp((s) => s.wallets);
  const navigate = useApp((s) => s.navigate);
  const settings = useApp((s) => s.settings);
  const set = useApp.setState;

  return (
    <div className="onboard">
      <div className="onboard-card">
        <img className="onboard-logo" src={logo} alt="" />
        <h1>
          LBC Wallet {settings && settings.network !== 'mainnet' && <Badge tone="amber">{settings.network}</Badge>}
        </h1>
        <p className="lead">A non-custodial wallet for LBRY Credits — with mining built in. Your keys never leave this computer.</p>

        {wallets.length > 0 && (
          <div className="stack" style={{ marginBottom: 22 }}>
            <div className="label">Your wallets</div>
            {wallets.map((w) => (
              <button key={w.id} className="option-card" onClick={() => set({ route: { name: 'unlock', walletId: w.id } })}>
                <div className="ic">
                  <Wallet size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t ellipsis">{w.name}</div>
                  <div className="d">
                    {w.kind === 'watch' ? 'Watch-only' : w.scheme === 'lbry' ? 'LBRY Desktop / Odysee compatible' : w.scheme === 'bip44' ? 'Standard BIP39 wallet' : 'Imported extended key'} · created{' '}
                    {new Date(w.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <ChevronRight size={18} color="var(--text-3)" />
              </button>
            ))}
          </div>
        )}

        <div className="stack">
          {wallets.length > 0 && <div className="label">Add a wallet</div>}
          <button className="option-card" onClick={() => navigate({ name: 'create' })}>
            <div className="ic">
              <Plus size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="t">Create a new wallet</div>
              <div className="d">Generate a fresh recovery phrase</div>
            </div>
            <ChevronRight size={18} color="var(--text-3)" />
          </button>
          <button className="option-card" onClick={() => navigate({ name: 'restore' })}>
            <div className="ic">
              <KeyRound size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="t">Restore from a recovery phrase</div>
              <div className="d">12/24 words — works with LBRY Desktop, Odysee and BIP39 phrases</div>
            </div>
            <ChevronRight size={18} color="var(--text-3)" />
          </button>
          <button className="option-card" onClick={() => navigate({ name: 'import' })}>
            <div className="ic">
              <FileKey2 size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="t">Import an extended key</div>
              <div className="d">An xprv from LBRY Desktop, or an xpub for a watch-only wallet</div>
            </div>
            <ChevronRight size={18} color="var(--text-3)" />
          </button>
        </div>

        <div className="row small muted" style={{ marginTop: 22 }}>
          <ShieldCheck size={16} />
          Keys are encrypted with your password (scrypt + AES-256-GCM) and stored only on this device.
        </div>
      </div>
    </div>
  );
}
