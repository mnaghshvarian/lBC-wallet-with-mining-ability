import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useApp, useT, errorMessage } from '../store';
import { Button, Callout, Field, PasswordInput, Segmented, StrengthMeter } from '../components/ui';

export function ImportKey() {
  const t = useT();
  const navigate = useApp((s) => s.navigate);
  const refreshWallets = useApp((s) => s.refreshWallets);
  const setOverview = useApp((s) => s.setOverview);
  const [kind, setKind] = useState<'xprv' | 'watch'>('xprv');
  const [key, setKey] = useState('');
  const [name, setName] = useState(() => useApp.getState().t('importKey.defaultName'));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // A private key may be typed on this screen: keep it out of screenshots and the app switcher (Android).
  useEffect(() => {
    void window.lbc.app.secureScreen(true);
    return () => void window.lbc.app.secureScreen(false);
  }, []);

  const prefixOk = kind === 'xprv' ? /^[xt]prv[1-9A-HJ-NP-Za-km-z]{100,}$/.test(key.trim()) : /^[xt]pub[1-9A-HJ-NP-Za-km-z]{100,}$/.test(key.trim());

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const overview = await window.lbc.wallets.create({ name: name.trim(), password, source: kind === 'xprv' ? { type: 'xprv', xprv: key.trim() } : { type: 'watch', xpub: key.trim() } });
      await refreshWallets();
      setOverview(overview);
      useApp.setState({ route: { name: 'overview' } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="stack">
          <div>
            <h1>{t('importKey.title')}</h1>
            <p className="lead">{t('importKey.lead')}</p>
          </div>
          <Segmented
            value={kind}
            options={[
              { value: 'xprv', label: t('importKey.xprv') },
              { value: 'watch', label: t('importKey.xpub') },
            ]}
            onChange={(v) => {
              setKind(v);
              setKey('');
            }}
          />
          {kind === 'watch' && <Callout>{t('importKey.watchExplain')}</Callout>}
          <Field label={kind === 'xprv' ? t('importKey.privateLabel') : t('importKey.publicLabel')} error={key && !prefixOk ? t('importKey.badKey', { kind: kind === 'xprv' ? 'xprv' : 'xpub' }) : undefined}>
            <textarea className="textarea mono" rows={3} value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} placeholder={kind === 'xprv' ? 'xprv9s21ZrQH143K…' : 'xpub661MyMwAqRbc…'} />
          </Field>
          <Field label={t('common.walletName')}>
            <input className="input" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('common.password')}>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
            {password && <StrengthMeter password={password} />}
          </Field>
          <Field label={t('common.confirmPassword')} error={confirm && confirm !== password ? t('create.mismatch') : undefined}>
            <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!confirm && confirm !== password} />
          </Field>
          {error && <Callout tone="danger">{error}</Callout>}
          <div className="row">
            <Button variant="ghost" onClick={() => navigate({ name: 'welcome' })}>
              <ArrowLeft size={16} className="flip-rtl" /> {t('common.back')}
            </Button>
            <div className="spacer" />
            <Button variant="primary" loading={busy} disabled={!prefixOk || !name.trim() || password.length < 8 || password !== confirm} onClick={() => void submit()}>
              {t('importKey.importButton')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
