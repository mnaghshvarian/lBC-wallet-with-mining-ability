import { useState } from 'react';
import { AlertTriangle, Bug, Globe2, KeyRound, Pickaxe, Scale, ShieldOff } from 'lucide-react';
import logo from '../assets/logo.svg';
import { TERMS_VERSION, useApp, useT } from '../store';
import { Button } from '../components/ui';
import { LanguagePicker } from '../components/LanguagePicker';

const SECTIONS = [
  { key: 'risk', icon: ShieldOff },
  { key: 'audit', icon: Bug },
  { key: 'keys', icon: KeyRound },
  { key: 'mining', icon: Pickaxe },
  { key: 'network', icon: Globe2 },
  { key: 'law', icon: Scale },
] as const;

/** The disclaimer text, also shown from Settings → About. */
export function TermsText() {
  const t = useT();
  return (
    <div className="terms">
      {SECTIONS.map(({ key, icon: Icon }) => (
        <section key={key} className="terms-section">
          <h3>
            <Icon size={17} aria-hidden /> {t(`terms.${key}.title`)}
          </h3>
          <p>{t(`terms.${key}.text`)}</p>
        </section>
      ))}
      <p className="small muted">{t('terms.licenseNote')}</p>
    </div>
  );
}

const CHECKS = ['checkAudit', 'checkKeys', 'checkRisk'] as const;

/** First run: the user must read and accept the disclaimer before using the wallet. */
export function Terms() {
  const t = useT();
  const updateSettings = useApp((s) => s.updateSettings);
  const overview = useApp((s) => s.overview);
  const settings = useApp((s) => s.settings);
  const wallets = useApp((s) => s.wallets);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const all = CHECKS.every((c) => checked[c]);

  const accept = async () => {
    setBusy(true);
    try {
      const s = await updateSettings({ acceptedTerms: TERMS_VERSION });
      const last = s.lastWalletId && wallets.some((w) => w.id === s.lastWalletId) ? s.lastWalletId : null;
      useApp.setState({ route: overview ? { name: 'overview' } : last ? { name: 'unlock', walletId: last } : { name: 'welcome' } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboard">
      <div className="onboard-card terms-card">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <img className="onboard-logo" src={logo} alt="" />
          <LanguagePicker compact />
        </div>
        <h1 className="row">
          <AlertTriangle size={24} color="var(--warning)" aria-hidden /> {t('terms.title')}
        </h1>
        <p className="lead">{t('terms.lead')}</p>
        <div className="terms-scroll" tabIndex={0}>
          <TermsText />
        </div>
        <div className="stack tight" style={{ marginTop: 16 }}>
          {CHECKS.map((c) => (
            <label key={c} className="check-row">
              <input type="checkbox" checked={!!checked[c]} onChange={(e) => setChecked({ ...checked, [c]: e.target.checked })} />
              <span>{t(`terms.${c}`)}</span>
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <Button variant="ghost" onClick={() => void window.lbc.app.quit()}>
            {t('terms.quit')}
          </Button>
          <div className="spacer" />
          <Button variant="primary" size="lg" disabled={!all || !settings} loading={busy} onClick={() => void accept()}>
            {t('terms.accept')}
          </Button>
        </div>
      </div>
    </div>
  );
}
