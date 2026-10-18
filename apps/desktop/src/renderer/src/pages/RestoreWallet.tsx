import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Search } from 'lucide-react';
import { useApp, errorMessage } from '../store';
import { Button, Callout, Field, PasswordInput, Segmented, Spinner, StrengthMeter } from '../components/ui';
import type { DerivationScheme, PhraseCheckView, SchemeScanView } from '../../../shared/api';

type Step = 'phrase' | 'scan' | 'secure';
const SCHEME_LABEL: Record<DerivationScheme, string> = { bip44: 'Standard (BIP44)', lbry: 'LBRY Desktop / Odysee' };

export function RestoreWallet() {
  const navigate = useApp((s) => s.navigate);
  const refreshWallets = useApp((s) => s.refreshWallets);
  const setOverview = useApp((s) => s.setOverview);
  const [step, setStep] = useState<Step>('phrase');
  const [phrase, setPhrase] = useState('');
  const [check, setCheck] = useState<PhraseCheckView | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [mode, setMode] = useState<'auto' | DerivationScheme>('auto');
  const [advanced, setAdvanced] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<SchemeScanView[] | null>(null);
  const [scanError, setScanError] = useState('');
  const [scheme, setScheme] = useState<DerivationScheme>('bip44');
  const [name, setName] = useState('Restored wallet');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (!phrase.trim()) return setCheck(null);
      void window.lbc.wallets.checkPhrase(phrase).then((c) => alive && setCheck(c));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [phrase]);

  const phraseOk = !!check && check.words >= 12 && check.unknownWords.length === 0 && (mode !== 'bip44' || check.bip39Valid);

  const runScan = async () => {
    setStep('scan');
    setScanning(true);
    setScanError('');
    setScan(null);
    try {
      const results = await window.lbc.wallets.scan(phrase, check?.bip39Valid && passphrase ? passphrase : undefined);
      setScan(results);
      const used = results.filter((r) => r.usedAddresses > 0).sort((a, b) => b.usedAddresses - a.usedAddresses);
      setScheme(used[0]?.scheme ?? (check?.bip39Valid ? 'bip44' : 'lbry'));
    } catch (err) {
      setScanError(errorMessage(err));
      setScheme(check?.bip39Valid ? 'bip44' : 'lbry');
    } finally {
      setScanning(false);
    }
  };

  const next = () => {
    if (mode === 'auto') void runScan();
    else {
      setScheme(mode);
      setStep('secure');
    }
  };

  const restore = async () => {
    setBusy(true);
    setError('');
    try {
      const overview = await window.lbc.wallets.create({
        name: name.trim(),
        password,
        source: { type: 'mnemonic', mnemonic: phrase, scheme, passphrase: scheme === 'bip44' && passphrase ? passphrase : undefined },
      });
      setPhrase('');
      await refreshWallets();
      setOverview(overview);
      useApp.setState({ route: { name: 'overview' } });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const stepIndex = step === 'phrase' ? 0 : step === 'scan' ? 1 : 2;
  const found = scan?.find((r) => r.scheme === scheme && r.usedAddresses > 0);

  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="steps">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`s ${i <= stepIndex ? 'done' : ''}`} />
          ))}
        </div>

        {step === 'phrase' && (
          <div className="stack">
            <div>
              <h1>Restore a wallet</h1>
              <p className="lead">Type or paste your recovery phrase. Phrases from LBRY Desktop and Odysee work too.</p>
            </div>
            <Field label="Recovery phrase">
              <textarea
                className={`textarea mono ${check && check.unknownWords.length ? 'invalid' : ''}`}
                rows={4}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="word1 word2 word3 …"
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoFocus
              />
            </Field>
            {check && (
              <div className="small">
                {check.unknownWords.length > 0 ? (
                  <span className="error-text">Unknown word{check.unknownWords.length > 1 ? 's' : ''}: {check.unknownWords.slice(0, 5).join(', ')} — check the spelling.</span>
                ) : check.words < 12 ? (
                  <span className="muted">{check.words} words entered…</span>
                ) : check.bip39Valid ? (
                  <span className="ok-text row">
                    <CheckCircle2 size={14} /> Valid {check.words}-word BIP39 phrase
                  </span>
                ) : (
                  <span className="text-2">Not a standard BIP39 phrase — it will be restored with the LBRY Desktop / Odysee method ({check.words} words).</span>
                )}
              </div>
            )}

            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced(!advanced)}>
              {advanced ? 'Hide' : 'Show'} advanced options
            </button>
            {advanced && (
              <div className="card tight stack">
                <Field label="Derivation method" hint="Auto-detect checks the network for funds under each method.">
                  <Segmented
                    value={mode}
                    options={[
                      { value: 'auto', label: 'Auto-detect' },
                      { value: 'bip44', label: 'Standard (BIP44)' },
                      { value: 'lbry', label: 'LBRY Desktop' },
                    ]}
                    onChange={setMode}
                  />
                </Field>
                {check?.bip39Valid && (
                  <Field label="BIP39 passphrase (optional)" hint="Only if you set an extra passphrase (“25th word”) when the wallet was created.">
                    <PasswordInput value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                  </Field>
                )}
              </div>
            )}

            <div className="row" style={{ marginTop: 8 }}>
              <Button variant="ghost" onClick={() => navigate({ name: 'welcome' })}>
                <ArrowLeft size={16} /> Back
              </Button>
              <div className="spacer" />
              <Button variant="primary" disabled={!phraseOk} onClick={next}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'scan' && (
          <div className="stack">
            <div>
              <h1>Finding your funds</h1>
              <p className="lead">Checking the LBRY network for transactions under each derivation method.</p>
            </div>
            {scanning && (
              <div className="row" style={{ padding: '20px 0' }}>
                <Spinner large />
                <div className="text-2">Contacting LBRY hubs…</div>
              </div>
            )}
            {scanError && (
              <Callout tone="warn" title="Couldn't check the network">
                {scanError}. You can still continue and choose the method yourself; the wallet will sync once it is online.
              </Callout>
            )}
            {scan && (
              <div className="stack tight">
                {scan.map((r) => (
                  <div key={r.scheme} className="row between card tight">
                    <div>
                      <div className="strong">{SCHEME_LABEL[r.scheme]}</div>
                      <div className="tiny muted mono">{r.firstAddress}</div>
                    </div>
                    {r.usedAddresses > 0 ? <span className="badge green">{r.usedAddresses} used address{r.usedAddresses > 1 ? 'es' : ''}</span> : <span className="badge">No activity</span>}
                  </div>
                ))}
              </div>
            )}
            {!scanning && (
              <>
                {found ? (
                  <Callout tone="ok" title={`Found your wallet (${SCHEME_LABEL[scheme]})`}>
                    Transactions were found with this method, so it will be used.
                  </Callout>
                ) : (
                  scan && <Callout title="No transactions found yet">That's normal for a new or unused wallet. It will use {SCHEME_LABEL[scheme]}.</Callout>
                )}
                {check?.bip39Valid && (
                  <Field label="Derivation method">
                    <Segmented
                      value={scheme}
                      options={[
                        { value: 'bip44', label: SCHEME_LABEL.bip44 },
                        { value: 'lbry', label: SCHEME_LABEL.lbry },
                      ]}
                      onChange={setScheme}
                    />
                  </Field>
                )}
              </>
            )}
            <div className="row">
              <Button variant="ghost" onClick={() => setStep('phrase')}>
                <ArrowLeft size={16} /> Back
              </Button>
              <div className="spacer" />
              {!scanning && scanError && (
                <Button variant="ghost" onClick={() => void runScan()}>
                  <Search size={16} /> Try again
                </Button>
              )}
              <Button variant="primary" disabled={scanning} onClick={() => setStep('secure')}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === 'secure' && (
          <div className="stack">
            <div>
              <h1>Secure your wallet</h1>
              <p className="lead">Name it and set the password used to unlock it on this computer.</p>
            </div>
            <Field label="Wallet name">
              <input className="input" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Password">
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              {password && <StrengthMeter password={password} />}
            </Field>
            <Field label="Confirm password" error={confirm && confirm !== password ? 'Passwords do not match' : undefined}>
              <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!confirm && confirm !== password} />
            </Field>
            <div className="small muted">Derivation: {SCHEME_LABEL[scheme]}</div>
            {error && <Callout tone="danger">{error}</Callout>}
            <div className="row">
              <Button variant="ghost" onClick={() => setStep(mode === 'auto' ? 'scan' : 'phrase')}>
                <ArrowLeft size={16} /> Back
              </Button>
              <div className="spacer" />
              <Button variant="primary" loading={busy} disabled={!name.trim() || password.length < 8 || password !== confirm} onClick={() => void restore()}>
                Restore wallet
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
