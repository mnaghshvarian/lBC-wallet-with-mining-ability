import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Search } from 'lucide-react';
import { useApp, useT, errorMessage } from '../store';
import { Button, Callout, Field, PasswordInput, Segmented, Spinner, StrengthMeter } from '../components/ui';
import type { DerivationScheme, PhraseCheckView, SchemeScanView } from '@lbcwallet/services/api';
import type { Translate } from '../i18n';

type Step = 'phrase' | 'scan' | 'secure';
const schemeLabel = (t: Translate, scheme: DerivationScheme) => (scheme === 'bip44' ? t('walletKind.bip44') : t('restore.lbryScheme'));

export function RestoreWallet() {
  const t = useT();
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
  const [name, setName] = useState(() => useApp.getState().t('restore.defaultName'));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (!phrase.trim()) return setCheck(null);
      void window.lbc.wallets.checkPhrase(phrase).then((c) => alive && setCheck(c));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
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

  // The phrase is typed on this screen: keep it out of screenshots and the app switcher (Android).
  useEffect(() => {
    void window.lbc.app.secureScreen(true);
    return () => void window.lbc.app.secureScreen(false);
  }, []);

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
              <h1>{t('restore.title')}</h1>
              <p className="lead">{t('restore.lead')}</p>
            </div>
            <Field label={t('restore.phrase')}>
              <textarea
                className={`textarea mono ${check && check.unknownWords.length ? 'invalid' : ''}`}
                rows={4}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={t('restore.placeholder')}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                autoFocus
              />
            </Field>
            {check && (
              <div className="small">
                {check.unknownWords.length > 0 ? (
                  <span className="error-text">{t('restore.unknownWords', { count: check.unknownWords.length, words: check.unknownWords.slice(0, 5).join(', ') })}</span>
                ) : check.words < 12 ? (
                  <span className="muted">{t('restore.wordsEntered', { count: check.words })}</span>
                ) : check.bip39Valid ? (
                  <span className="ok-text row">
                    <CheckCircle2 size={14} /> {t('restore.validBip39', { count: check.words })}
                  </span>
                ) : (
                  <span className="text-2">{t('restore.notBip39', { count: check.words })}</span>
                )}
              </div>
            )}

            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAdvanced(!advanced)}>
              {advanced ? t('create.hideAdvanced') : t('create.showAdvanced')}
            </button>
            {advanced && (
              <div className="card tight stack">
                <Field label={t('restore.method')} hint={t('restore.methodHint')}>
                  <Segmented
                    value={mode}
                    options={[
                      { value: 'auto', label: t('restore.autoDetect') },
                      { value: 'bip44', label: t('walletKind.bip44') },
                      { value: 'lbry', label: t('restore.lbryShort') },
                    ]}
                    onChange={setMode}
                  />
                </Field>
                {check?.bip39Valid && (
                  <Field label={t('restore.bip39Passphrase')} hint={t('restore.bip39PassphraseHint')}>
                    <PasswordInput value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
                  </Field>
                )}
              </div>
            )}

            <div className="row" style={{ marginTop: 8 }}>
              <Button variant="ghost" onClick={() => navigate({ name: 'welcome' })}>
                <ArrowLeft size={16} className="flip-rtl" /> {t('common.back')}
              </Button>
              <div className="spacer" />
              <Button variant="primary" disabled={!phraseOk} onClick={next}>
                {t('common.continue')}
              </Button>
            </div>
          </div>
        )}

        {step === 'scan' && (
          <div className="stack">
            <div>
              <h1>{t('restore.scanTitle')}</h1>
              <p className="lead">{t('restore.scanLead')}</p>
            </div>
            {scanning && (
              <div className="row" style={{ padding: '20px 0' }}>
                <Spinner large />
                <div className="text-2">{t('restore.contacting')}</div>
              </div>
            )}
            {scanError && (
              <Callout tone="warn" title={t('restore.scanFailed')}>
                {t('restore.scanFailedText', { error: scanError })}
              </Callout>
            )}
            {scan && (
              <div className="stack tight">
                {scan.map((r) => (
                  <div key={r.scheme} className="row between card tight">
                    <div>
                      <div className="strong">{schemeLabel(t, r.scheme)}</div>
                      <div className="tiny muted mono">{r.firstAddress}</div>
                    </div>
                    {r.usedAddresses > 0 ? <span className="badge green">{t('restore.usedAddresses', { count: r.usedAddresses })}</span> : <span className="badge">{t('restore.noActivity')}</span>}
                  </div>
                ))}
              </div>
            )}
            {!scanning && (
              <>
                {found ? (
                  <Callout tone="ok" title={t('restore.found', { scheme: schemeLabel(t, scheme) })}>
                    {t('restore.foundText')}
                  </Callout>
                ) : (
                  scan && <Callout title={t('restore.notFound')}>{t('restore.notFoundText', { scheme: schemeLabel(t, scheme) })}</Callout>
                )}
                {check?.bip39Valid && (
                  <Field label={t('restore.method')}>
                    <Segmented
                      value={scheme}
                      options={[
                        { value: 'bip44', label: schemeLabel(t, 'bip44') },
                        { value: 'lbry', label: schemeLabel(t, 'lbry') },
                      ]}
                      onChange={setScheme}
                    />
                  </Field>
                )}
              </>
            )}
            <div className="row">
              <Button variant="ghost" onClick={() => setStep('phrase')}>
                <ArrowLeft size={16} className="flip-rtl" /> {t('common.back')}
              </Button>
              <div className="spacer" />
              {!scanning && scanError && (
                <Button variant="ghost" onClick={() => void runScan()}>
                  <Search size={16} /> {t('common.retry')}
                </Button>
              )}
              <Button variant="primary" disabled={scanning} onClick={() => setStep('secure')}>
                {t('common.continue')}
              </Button>
            </div>
          </div>
        )}

        {step === 'secure' && (
          <div className="stack">
            <div>
              <h1>{t('restore.secureTitle')}</h1>
              <p className="lead">{t('restore.secureLead')}</p>
            </div>
            <Field label={t('common.walletName')}>
              <input className="input" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t('common.password')}>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
              {password && <StrengthMeter password={password} />}
            </Field>
            <Field label={t('common.confirmPassword')} error={confirm && confirm !== password ? t('create.mismatch') : undefined}>
              <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} invalid={!!confirm && confirm !== password} />
            </Field>
            <div className="small muted">{t('restore.derivationIs', { scheme: schemeLabel(t, scheme) })}</div>
            {error && <Callout tone="danger">{error}</Callout>}
            <div className="row">
              <Button variant="ghost" onClick={() => setStep(mode === 'auto' ? 'scan' : 'phrase')}>
                <ArrowLeft size={16} className="flip-rtl" /> {t('common.back')}
              </Button>
              <div className="spacer" />
              <Button variant="primary" loading={busy} disabled={!name.trim() || password.length < 8 || password !== confirm} onClick={() => void restore()}>
                {t('restore.restoreButton')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
