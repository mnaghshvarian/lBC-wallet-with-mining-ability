import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useApp, errorMessage } from '../store';
import { Button, Callout, Field, PasswordInput, Segmented, StrengthMeter } from '../components/ui';

export function ImportKey() {
  const navigate = useApp((s) => s.navigate);
  const refreshWallets = useApp((s) => s.refreshWallets);
  const setOverview = useApp((s) => s.setOverview);
  const [kind, setKind] = useState<'xprv' | 'watch'>('xprv');
  const [key, setKey] = useState('');
  const [name, setName] = useState('Imported wallet');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
            <h1>Import an extended key</h1>
            <p className="lead">For keys exported from LBRY Desktop (the “private_key” xprv in wallet.json) or a watch-only xpub.</p>
          </div>
          <Segmented
            value={kind}
            options={[
              { value: 'xprv', label: 'Private key (xprv)' },
              { value: 'watch', label: 'Watch-only (xpub)' },
            ]}
            onChange={(v) => {
              setKind(v);
              setKey('');
            }}
          />
          {kind === 'watch' && <Callout>A watch-only wallet shows balances and receives payments (great for a mining rig) but cannot send.</Callout>}
          <Field label={kind === 'xprv' ? 'Extended private key' : 'Extended public key'} error={key && !prefixOk ? `This doesn't look like an ${kind === 'xprv' ? 'xprv' : 'xpub'} key` : undefined}>
            <textarea className="textarea mono" rows={3} value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} placeholder={kind === 'xprv' ? 'xprv9s21ZrQH143K…' : 'xpub661MyMwAqRbc…'} />
          </Field>
          <Field label="Wallet name">
            <input className="input" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Password">
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
            {password && <StrengthMeter password={password} />}
          </Field>
          <Field label="Confirm password" error={confirm && confirm !== password ? 'Passwords do not match' : undefined}>
            <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!confirm && confirm !== password} />
          </Field>
          {error && <Callout tone="danger">{error}</Callout>}
          <div className="row">
            <Button variant="ghost" onClick={() => navigate({ name: 'welcome' })}>
              <ArrowLeft size={16} /> Back
            </Button>
            <div className="spacer" />
            <Button variant="primary" loading={busy} disabled={!prefixOk || !name.trim() || password.length < 8 || password !== confirm} onClick={() => void submit()}>
              Import
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
