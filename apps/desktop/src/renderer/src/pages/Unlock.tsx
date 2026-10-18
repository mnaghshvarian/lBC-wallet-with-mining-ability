import { useState } from 'react';
import { Lock } from 'lucide-react';
import logo from '../assets/logo.svg';
import { useApp, errorMessage } from '../store';
import { Button, Field, PasswordInput } from '../components/ui';

export function Unlock({ walletId }: { walletId: string }) {
  const wallets = useApp((s) => s.wallets);
  const setOverview = useApp((s) => s.setOverview);
  const wallet = wallets.find((w) => w.id === walletId);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const unlock = async () => {
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      const overview = await window.lbc.wallets.open(walletId, password);
      setPassword('');
      setOverview(overview);
      useApp.setState({ route: { name: 'overview' } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="onboard">
      <div className="onboard-card" style={{ maxWidth: 440 }}>
        <div className="stack">
          <div className="center">
            <img className="onboard-logo" src={logo} alt="" />
            <h1>{wallet?.name ?? 'Wallet'}</h1>
            <p className="lead" style={{ marginBottom: 6 }}>
              Enter your password to unlock.
            </p>
          </div>
          <Field error={error}>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void unlock()} invalid={!!error} autoFocus placeholder="Password" />
          </Field>
          <Button variant="primary" size="lg" block loading={busy} disabled={!password} onClick={() => void unlock()}>
            <Lock size={16} /> Unlock
          </Button>
          <div className="row between small">
            <a onClick={() => useApp.setState({ route: { name: 'welcome' } })}>Other wallets</a>
            <a onClick={() => useApp.setState({ route: { name: 'restore' } })}>Forgot password? Restore from phrase</a>
          </div>
        </div>
      </div>
    </div>
  );
}
