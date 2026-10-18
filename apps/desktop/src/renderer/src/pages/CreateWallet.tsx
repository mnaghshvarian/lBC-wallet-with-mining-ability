import { useMemo, useState } from 'react';
import { ArrowLeft, Eye } from 'lucide-react';
import { useApp, errorMessage } from '../store';
import { Button, Callout, Field, PasswordInput, Segmented, StrengthMeter } from '../components/ui';
import { WordInput } from '../components/WordInput';
import type { DerivationScheme } from '../../../shared/api';

type Step = 'setup' | 'phrase' | 'verify';

function pickPositions(count: number): number[] {
  const all = Array.from({ length: count }, (_, i) => i);
  const picked: number[] = [];
  while (picked.length < 3) {
    const i = all.splice(Math.floor(Math.random() * all.length), 1)[0]!;
    picked.push(i);
  }
  return picked.sort((a, b) => a - b);
}

export function CreateWallet() {
  const navigate = useApp((s) => s.navigate);
  const refreshWallets = useApp((s) => s.refreshWallets);
  const setOverview = useApp((s) => s.setOverview);
  const [step, setStep] = useState<Step>('setup');
  const [name, setName] = useState('My LBC Wallet');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [words, setWords] = useState<12 | 24>(12);
  const [scheme, setScheme] = useState<DerivationScheme>('bip44');
  const [advanced, setAdvanced] = useState(false);
  const [mnemonic, setMnemonic] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [written, setWritten] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => mnemonic.split(' ').filter(Boolean), [mnemonic]);
  const positions = useMemo(() => (list.length ? pickPositions(list.length) : []), [list]);

  const setupValid = name.trim().length > 0 && password.length >= 8 && password === confirm;

  const toPhrase = async () => {
    setError('');
    setMnemonic(await window.lbc.wallets.generateMnemonic(words));
    setRevealed(false);
    setWritten(false);
    setAnswers({});
    setStep('phrase');
  };

  const verifyOk = positions.every((p) => (answers[p] ?? '').trim().toLowerCase() === list[p]);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const overview = await window.lbc.wallets.create({ name: name.trim(), password, source: { type: 'mnemonic', mnemonic, scheme } });
      setMnemonic('');
      await refreshWallets();
      setOverview(overview);
      useApp.setState({ route: { name: 'overview' } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const stepIndex = step === 'setup' ? 0 : step === 'phrase' ? 1 : 2;

  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="steps">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`s ${i <= stepIndex ? 'done' : ''}`} />
          ))}
        </div>

        {step === 'setup' && (
          <div className="stack">
            <div>
              <h1>Create a new wallet</h1>
              <p className="lead">Choose a name and a strong password. The password encrypts your wallet on this computer.</p>
            </div>
            <Field label="Wallet name">
              <input className="input" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Password" hint={!password ? 'At least 8 characters. A long passphrase is best.' : undefined}>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              {password && <StrengthMeter password={password} />}
            </Field>
            <Field label="Confirm password" error={confirm && confirm !== password ? 'Passwords do not match' : undefined}>
              <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!confirm && confirm !== password} onKeyDown={(e) => e.key === 'Enter' && setupValid && void toPhrase()} />
            </Field>

            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced(!advanced)}>
              {advanced ? 'Hide' : 'Show'} advanced options
            </button>
            {advanced && (
              <div className="card tight stack">
                <Field label="Recovery phrase length">
                  <Segmented value={String(words) as '12' | '24'} options={[{ value: '12', label: '12 words' }, { value: '24', label: '24 words' }]} onChange={(v) => setWords(v === '24' ? 24 : 12)} />
                </Field>
                <Field
                  label="Address derivation"
                  hint={
                    scheme === 'bip44'
                      ? "Standard BIP44 path m/44'/140'/0' — recommended, works with any BIP39 wallet that supports LBC."
                      : 'Same derivation as LBRY Desktop and Odysee, so this phrase can also be imported there.'
                  }
                >
                  <Segmented
                    value={scheme}
                    options={[
                      { value: 'bip44', label: 'Standard (BIP44)' },
                      { value: 'lbry', label: 'LBRY Desktop compatible' },
                    ]}
                    onChange={setScheme}
                  />
                </Field>
              </div>
            )}

            <div className="row" style={{ marginTop: 8 }}>
              <Button variant="ghost" onClick={() => navigate({ name: 'welcome' })}>
                <ArrowLeft size={16} /> Back
              </Button>
              <div className="spacer" />
              <Button variant="primary" disabled={!setupValid} onClick={() => void toPhrase()}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'phrase' && (
          <div className="stack">
            <div>
              <h1>Your recovery phrase</h1>
              <p className="lead">These {list.length} words are the only way to restore your wallet if this computer is lost.</p>
            </div>
            <Callout tone="warn" title="Write it down on paper, in order.">
              Never share it, type it into websites, or store it in screenshots, email or cloud notes. Anyone with these words can take your LBC.
            </Callout>
            <div className="reveal-wrap">
              {!revealed && (
                <div className="reveal-cover">
                  <Button variant="primary" onClick={() => setRevealed(true)}>
                    <Eye size={16} /> Reveal recovery phrase
                  </Button>
                </div>
              )}
              <div className={`words ${revealed ? '' : 'blur'}`}>
                {list.map((w, i) => (
                  <div className="word" key={i}>
                    <span className="n">{i + 1}</span>
                    <span className="selectable">{revealed ? w : '•••••'}</span>
                  </div>
                ))}
              </div>
            </div>
            <label className="row small" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={written} onChange={(e) => setWritten(e.target.checked)} disabled={!revealed} />
              I have written down my recovery phrase and stored it somewhere safe.
            </label>
            <div className="row">
              <Button variant="ghost" onClick={() => setStep('setup')}>
                <ArrowLeft size={16} /> Back
              </Button>
              <div className="spacer" />
              <Button variant="primary" disabled={!written} onClick={() => setStep('verify')}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'verify' && (
          <div className="stack">
            <div>
              <h1>Confirm your backup</h1>
              <p className="lead">Enter the requested words from your recovery phrase.</p>
            </div>
            {positions.map((p, idx) => {
              const value = answers[p] ?? '';
              const wrong = value.trim().length > 0 && value.trim().toLowerCase() !== list[p] && value.trim().length >= (list[p]?.length ?? 0);
              return (
                <Field key={p} label={`Word #${p + 1}`} error={wrong ? 'That word does not match' : undefined}>
                  <WordInput value={value} onChange={(v) => setAnswers({ ...answers, [p]: v })} invalid={wrong} autoFocus={idx === 0} />
                </Field>
              );
            })}
            {error && <Callout tone="danger">{error}</Callout>}
            <div className="row">
              <Button variant="ghost" onClick={() => setStep('phrase')}>
                <ArrowLeft size={16} /> Show phrase again
              </Button>
              <div className="spacer" />
              <Button variant="primary" disabled={!verifyOk} loading={busy} onClick={() => void create()}>
                Create wallet
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
