import { ChevronRight, FileKey2, KeyRound, Plus, ShieldCheck, Wallet } from 'lucide-react';
import logo from '../assets/logo.svg';
import { useApp, useT } from '../store';
import { Badge } from '../components/ui';
import { LanguagePicker } from '../components/LanguagePicker';

export function Welcome() {
  const t = useT();
  const wallets = useApp((s) => s.wallets);
  const navigate = useApp((s) => s.navigate);
  const settings = useApp((s) => s.settings);
  const info = useApp((s) => s.info);
  const set = useApp.setState;

  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <img className="onboard-logo" src={logo} alt="" />
          <LanguagePicker compact />
        </div>
        <h1>
          LBC Wallet {settings && settings.network !== 'mainnet' && <Badge tone="amber">{settings.network}</Badge>}
        </h1>
        <p className="lead">{info?.capabilities.mining ? t('welcome.lead') : t('welcome.leadMobile')}</p>

        {wallets.length > 0 && (
          <div className="stack" style={{ marginBottom: 22 }}>
            <div className="label">{t('welcome.yourWallets')}</div>
            {wallets.map((w) => (
              <button key={w.id} className="option-card" onClick={() => set({ route: { name: 'unlock', walletId: w.id } })}>
                <div className="ic">
                  <Wallet size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t ellipsis">{w.name}</div>
                  <div className="d">
                    {t('welcome.walletMeta', {
                      kind: w.kind === 'watch' ? t('walletKind.watch') : w.scheme === 'lbry' ? t('welcome.kindLbry') : w.scheme === 'bip44' ? t('welcome.kindBip39') : t('welcome.kindKey'),
                      date: new Date(w.createdAt).toLocaleDateString(document.documentElement.lang || undefined),
                    })}
                  </div>
                </div>
                <ChevronRight size={18} color="var(--text-3)" className="flip-rtl" />
              </button>
            ))}
          </div>
        )}

        <div className="stack">
          {wallets.length > 0 && <div className="label">{t('welcome.addWallet')}</div>}
          <button className="option-card" onClick={() => navigate({ name: 'create' })}>
            <div className="ic">
              <Plus size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="t">{t('welcome.create')}</div>
              <div className="d">{t('welcome.createHint')}</div>
            </div>
            <ChevronRight size={18} color="var(--text-3)" className="flip-rtl" />
          </button>
          <button className="option-card" onClick={() => navigate({ name: 'restore' })}>
            <div className="ic">
              <KeyRound size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="t">{t('welcome.restore')}</div>
              <div className="d">{t('welcome.restoreHint')}</div>
            </div>
            <ChevronRight size={18} color="var(--text-3)" className="flip-rtl" />
          </button>
          <button className="option-card" onClick={() => navigate({ name: 'import' })}>
            <div className="ic">
              <FileKey2 size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div className="t">{t('welcome.import')}</div>
              <div className="d">{t('welcome.importHint')}</div>
            </div>
            <ChevronRight size={18} color="var(--text-3)" className="flip-rtl" />
          </button>
        </div>

        <div className="row small muted" style={{ marginTop: 22 }}>
          <ShieldCheck size={16} />
          {t('welcome.keysLocal')}
        </div>
      </div>
    </div>
  );
}
