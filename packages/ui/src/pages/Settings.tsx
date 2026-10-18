import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, FileWarning, HardDrive, KeyRound, Lock, Plus, RefreshCw, ShieldAlert, Trash2, Wifi } from 'lucide-react';
import { MAINNET } from '@lbcwallet/core/ui';
import { useApp, useT, errorMessage } from '../store';
import { Badge, Button, Callout, CopyButton, Field, IconButton, Modal, PasswordInput, PasswordPrompt, Segmented, StrengthMeter, Toggle } from '../components/ui';
import { LanguagePicker } from '../components/LanguagePicker';
import { TermsText } from './Terms';
import { number } from '../lib/format';
import { DEFAULT_RELAYS, type HubEndpoint, type HubTestResult, type Settings } from '@lbcwallet/services/api';

type Tab = 'general' | 'network' | 'security' | 'wallet' | 'about';
const TABS: Tab[] = ['general', 'network', 'security', 'wallet', 'about'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR', 'BRL', 'RUB', 'TRY', 'KRW', 'BTC'];
export const REPO_URL = 'https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability';

export function SettingsPage({ initialTab }: { initialTab?: string }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'general');
  return (
    <>
      <div className="page-header">
        <h1>{t('nav.settings')}</h1>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((id) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {t(`settings.tab.${id}`)}
          </button>
        ))}
      </div>
      {tab === 'general' && <General />}
      {tab === 'network' && <Network />}
      {tab === 'security' && <Security />}
      {tab === 'wallet' && <WalletTab />}
      {tab === 'about' && <About />}
    </>
  );
}

function Row({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="text">
        <div className="title">{title}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function useSettings(): [Settings, (patch: Partial<Settings>) => Promise<void>] {
  const settings = useApp((s) => s.settings)!;
  const updateSettings = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const t = useT();
  return [
    settings,
    async (patch) => {
      try {
        await updateSettings(patch);
      } catch (err) {
        toast({ kind: 'error', title: t('settings.saveFailed'), message: errorMessage(err) });
      }
    },
  ];
}

function General() {
  const t = useT();
  const [s, update] = useSettings();
  const [txUrl, setTxUrl] = useState(s.explorerTxUrl);
  return (
    <div className="card">
      <Row title={t('settings.language')} desc={t('settings.languageHint')}>
        <LanguagePicker />
      </Row>
      <Row title={t('settings.theme')}>
        <Segmented
          value={s.theme}
          options={[
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'dark', label: t('settings.themeDark') },
            { value: 'light', label: t('settings.themeLight') },
          ]}
          onChange={(theme) => void update({ theme })}
        />
      </Row>
      <Row title={t('settings.showFiat')} desc={t('settings.showFiatHint')}>
        <Toggle checked={s.showFiat} onChange={(v) => void update({ showFiat: v })} label={t('settings.showFiat')} />
      </Row>
      <Row title={t('settings.currency')}>
        <select className="select" style={{ width: 140 }} value={s.fiatCurrency} disabled={!s.showFiat} onChange={(e) => void update({ fiatCurrency: e.target.value })} aria-label={t('settings.currency')}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Row>
      <Row title={t('settings.bitcoinUnit')} desc={t('settings.bitcoinUnitHint')}>
        <select className="select" style={{ width: 220 }} value={s.bitcoinUnit} onChange={(e) => void update({ bitcoinUnit: e.target.value as 'auto' | 'btc' | 'sats' | 'sci' })} aria-label={t('settings.bitcoinUnit')}>
          <option value="auto">{t('settings.bitcoinUnitAuto')}</option>
          <option value="btc">{t('settings.bitcoinUnitBtc')}</option>
          <option value="sats">{t('settings.bitcoinUnitSats')}</option>
          <option value="sci">{t('settings.bitcoinUnitSci')}</option>
        </select>
      </Row>
      <Row title={t('settings.hideBalances')} desc={t('settings.hideBalancesHint')}>
        <Toggle checked={s.hideBalances} onChange={(v) => void update({ hideBalances: v })} label={t('settings.hideBalances')} />
      </Row>
      <Row title={t('settings.explorer')} desc={t('settings.explorerHint', { txid: '{txid}' })}>
        <input
          className="input mono setting-input-wide"
          value={txUrl}
          onChange={(e) => setTxUrl(e.target.value)}
          onBlur={() => txUrl !== s.explorerTxUrl && void update({ explorerTxUrl: txUrl })}
          aria-label={t('settings.explorer')}
          dir="ltr"
        />
      </Row>
    </div>
  );
}

function HubTestBadge({ result }: { result?: HubTestResult | 'testing' }) {
  const t = useT();
  if (!result) return null;
  if (result === 'testing') return <Badge>{t('settings.testing')}</Badge>;
  return result.ok ? (
    <Badge tone="green">{t('settings.testOk', { ms: result.latencyMs ?? 0, height: number(result.height ?? 0) })}</Badge>
  ) : (
    <Badge tone="red">{result.error ?? t('settings.testFailed')}</Badge>
  );
}

function Network() {
  const t = useT();
  const [s, update] = useSettings();
  const info = useApp((st) => st.info)!;
  const overview = useApp((st) => st.overview);
  const nodeStatus = useApp((st) => st.node);
  const navigate = useApp((st) => st.navigate);
  const toast = useApp((st) => st.toast);
  const [tests, setTests] = useState<Record<string, HubTestResult | 'testing'>>({});
  const [newHub, setNewHub] = useState({ host: '', port: '50001', tls: false });
  const [node, setNode] = useState(s.lbcd);
  const [nodeTest, setNodeTest] = useState<HubTestResult | 'testing' | undefined>();
  const [socks, setSocks] = useState(s.socks5);
  const [btcExplorer, setBtcExplorer] = useState(s.swap.btcExplorer);
  const [relays, setRelays] = useState(s.market.relays.join('\n'));
  const defaults = s.network === 'mainnet' ? MAINNET.defaultHubs : [];
  const caps = info.capabilities;

  const modes: { value: Settings['backendMode']; label: string }[] = [{ value: 'hub', label: t('settings.modeHub') }];
  if (caps.node) modes.push({ value: 'local', label: t('settings.modeLocal') });
  if (caps.ownNode) modes.push({ value: 'lbcd', label: t('settings.modeOwn') });

  const test = async (h: HubEndpoint) => {
    const key = `${h.host}:${h.port}`;
    setTests((x) => ({ ...x, [key]: 'testing' }));
    const r = await window.lbc.network.testHub(h).catch((err) => ({ ok: false, error: errorMessage(err) }));
    setTests((x) => ({ ...x, [key]: r }));
  };

  const addHub = async () => {
    const port = Number(newHub.port);
    if (!newHub.host.trim() || !(port > 0 && port < 65536)) return;
    await update({ customHubs: [...s.customHubs, { host: newHub.host.trim(), port, tls: newHub.tls }] });
    setNewHub({ host: '', port: '50001', tls: false });
  };

  const saveNode = async () => {
    await update({ lbcd: node });
    setNodeTest('testing');
    setNodeTest(await window.lbc.network.testNode().catch((err) => ({ ok: false, error: errorMessage(err) })));
  };

  const modeHint = s.backendMode === 'hub' ? t('settings.modeHubHint') : s.backendMode === 'local' ? t('settings.modeLocalHint') : t('settings.modeOwnHint');
  const backend = overview?.backend;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <h3>{t('settings.connection')}</h3>
          <div className="spacer" />
          {overview && (
            <Button
              size="sm"
              onClick={() =>
                void window.lbc.network
                  .reconnect()
                  .then(() => toast({ kind: 'confirmed', title: t('settings.reconnecting') }))
                  .catch((err) => toast({ kind: 'error', title: t('settings.reconnectFailed'), message: errorMessage(err) }))
              }
            >
              <RefreshCw size={15} /> {t('settings.reconnect')}
            </Button>
          )}
        </div>
        {modes.length > 1 && <Segmented value={s.backendMode} options={modes} onChange={(backendMode) => void update({ backendMode })} />}
        <div className="hint" style={{ marginTop: 8 }}>
          {modeHint}
        </div>
        {backend && (
          <div className="row small" style={{ marginTop: 12 }}>
            <span className={`dot ${backend.connected ? 'ok' : 'bad'}`} />
            {backend.connected
              ? t('settings.connectedTo', { server: backend.kind === 'lbcd' && s.backendMode === 'local' ? t('net.yourNode') : (backend.server ?? '') })
              : backend.error
                ? t('settings.notConnectedError', { error: backend.error })
                : t('settings.notConnected')}
          </div>
        )}
      </div>

      {s.backendMode === 'local' && (
        <div className="card">
          <Row
            title={t('settings.builtInNode')}
            desc={
              !nodeStatus || nodeStatus.state === 'off'
                ? t('settings.builtInOff')
                : nodeStatus.state === 'synced'
                  ? t('settings.builtInSynced')
                  : t('settings.builtInSyncing')
            }
          >
            <Button onClick={() => navigate({ name: 'node' })}>
              <HardDrive size={15} /> {t('settings.openNodePage')}
            </Button>
          </Row>
        </div>
      )}

      {s.backendMode !== 'lbcd' && (
        <div className="card">
          <div className="card-header">
            <h3>{t('settings.hubs')}</h3>
          </div>
          {s.backendMode === 'local' && <div className="hint" style={{ marginBottom: 8 }}>{t('settings.hubsWhileSyncing')}</div>}
          <Row title={t('settings.defaultHubs')} desc={t('settings.defaultHubsHint')}>
            <Toggle checked={s.useDefaultHubs} onChange={(v) => void update({ useDefaultHubs: v })} label={t('settings.defaultHubs')} />
          </Row>
          <div className="table-wrap">
            <table className="table" style={{ marginTop: 8 }}>
              <tbody>
                {[...(s.useDefaultHubs ? defaults.map((h) => ({ ...h, custom: false })) : []), ...s.customHubs.map((h) => ({ ...h, custom: true }))].map((h) => (
                  <tr key={`${h.host}:${h.port}`}>
                    <td className="mono" dir="ltr">
                      {h.host}:{h.port} {h.tls && <Badge tone="blue">TLS</Badge>} {h.custom && <Badge>{t('settings.custom')}</Badge>}
                    </td>
                    <td style={{ textAlign: 'end' }}>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <HubTestBadge result={tests[`${h.host}:${h.port}`]} />
                        <Button size="sm" variant="ghost" onClick={() => void test(h)}>
                          <Wifi size={14} /> {t('common.test')}
                        </Button>
                        {h.custom && (
                          <IconButton label={t('settings.remove')} onClick={() => void update({ customHubs: s.customHubs.filter((x) => !(x.host === h.host && x.port === h.port)) })}>
                            <Trash2 size={15} />
                          </IconButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <input className="input mono" style={{ flex: '1 1 180px' }} placeholder="hub.example.com" aria-label={t('settings.hubHost')} value={newHub.host} onChange={(e) => setNewHub({ ...newHub, host: e.target.value })} dir="ltr" />
            <input className="input" style={{ width: 100 }} aria-label={t('settings.port')} value={newHub.port} onChange={(e) => setNewHub({ ...newHub, port: e.target.value.replace(/\D/g, '') })} dir="ltr" />
            <label className="row small nowrap">
              <input type="checkbox" checked={newHub.tls} onChange={(e) => setNewHub({ ...newHub, tls: e.target.checked })} /> TLS
            </label>
            <Button onClick={() => void addHub()} disabled={!newHub.host.trim()}>
              <Plus size={15} /> {t('common.add')}
            </Button>
          </div>
        </div>
      )}

      {s.backendMode === 'lbcd' && (
        <div className="card stack">
          <div className="card-header">
            <h3>{t('settings.ownNode')}</h3>
          </div>
          <Callout>{t('settings.ownNodeHelp', { flags: '--txindex --addrindex', port: 9245, cert: 'rpc.cert', notls: '--notls' })}</Callout>
          <Field label={t('settings.rpcUrl')}>
            <input className="input mono" value={node.url} onChange={(e) => setNode({ ...node, url: e.target.value })} placeholder="https://127.0.0.1:9245" dir="ltr" />
          </Field>
          <div className="grid grid-2">
            <Field label={t('settings.rpcUser')}>
              <input className="input" value={node.username} onChange={(e) => setNode({ ...node, username: e.target.value })} dir="ltr" />
            </Field>
            <Field label={t('settings.rpcPassword')}>
              <PasswordInput value={node.password} onChange={(e) => setNode({ ...node, password: e.target.value })} />
            </Field>
          </div>
          <Field label={t('settings.certPath')} hint={t('settings.certPathHint')}>
            <input className="input mono" value={node.certPath} onChange={(e) => setNode({ ...node, certPath: e.target.value })} dir="ltr" />
          </Field>
          <div className="row">
            <Button variant="primary" onClick={() => void saveNode()}>
              {t('settings.saveTest')}
            </Button>
            <HubTestBadge result={nodeTest} />
          </div>
        </div>
      )}

      {caps.proxy && (
        <div className="card stack">
          <div className="card-header">
            <h3>{t('settings.proxy')}</h3>
          </div>
          <Row title={t('settings.socks')} desc={t('settings.socksHint')}>
            <Toggle checked={socks.enabled} onChange={(v) => setSocks({ ...socks, enabled: v })} label="SOCKS5" />
          </Row>
          <div className="row">
            <input className="input mono" value={socks.host} aria-label={t('settings.proxyHost')} onChange={(e) => setSocks({ ...socks, host: e.target.value })} dir="ltr" />
            <input className="input" style={{ width: 110 }} value={socks.port} aria-label={t('settings.port')} onChange={(e) => setSocks({ ...socks, port: Number(e.target.value.replace(/\D/g, '')) || 0 })} dir="ltr" />
            <Button onClick={() => void update({ socks5: socks })}>{t('common.save')}</Button>
          </div>
        </div>
      )}

      <div className="card stack">
        <div className="card-header">
          <h3>{t('settings.swapExplorer')}</h3>
        </div>
        <div className="hint">{t('settings.swapExplorerHint')}</div>
        <div className="row">
          <input
            className="input mono"
            value={btcExplorer}
            aria-label={t('settings.swapExplorer')}
            placeholder="https://blockstream.info/api"
            onChange={(e) => setBtcExplorer(e.target.value)}
            dir="ltr"
            spellCheck={false}
          />
          <Button onClick={() => void update({ swap: { btcExplorer: btcExplorer.trim() } })}>{t('common.save')}</Button>
        </div>
      </div>

      <div className="card stack">
        <div className="card-header">
          <h3>{t('settings.relays')}</h3>
        </div>
        <div className="hint">{t('settings.relaysHint')}</div>
        <textarea
          className="input mono"
          rows={5}
          value={relays}
          aria-label={t('settings.relays')}
          placeholder={DEFAULT_RELAYS.join('\n')}
          onChange={(e) => setRelays(e.target.value)}
          dir="ltr"
          spellCheck={false}
        />
        <div className="row">
          <Button
            onClick={() =>
              void update({ market: { relays: relays.split(/\s+/).filter(Boolean) } }).then(() => {
                // Addresses that are not wss:// are dropped by the settings.
                const saved = useApp.getState().settings?.market.relays ?? [];
                setRelays(saved.join('\n'));
                if (relays.split(/\s+/).filter(Boolean).length !== saved.length) toast({ kind: 'error', title: t('settings.relays'), message: t('settings.relaysInvalid') });
              })
            }
          >
            {t('common.save')}
          </Button>
          {s.market.relays.length > 0 && (
            <Button variant="ghost" onClick={() => void update({ market: { relays: [] } }).then(() => setRelays(''))}>
              {t('settings.relaysDefault')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Security() {
  const t = useT();
  const [s, update] = useSettings();
  const overview = useApp((st) => st.overview);
  const toast = useApp((st) => st.toast);
  const [reveal, setReveal] = useState(false);
  const [secret, setSecret] = useState<{ type: string; secret: string; passphrase?: string; scheme?: string } | null>(null);
  const [changePw, setChangePw] = useState(false);
  const [xpub, setXpub] = useState<string | null>(null);

  // Keep the recovery phrase out of screenshots and the app switcher (Android).
  useEffect(() => {
    if (!secret) return;
    void window.lbc.app.secureScreen(true);
    return () => void window.lbc.app.secureScreen(false);
  }, [secret]);

  return (
    <div className="stack">
      <div className="card">
        <Row title={t('settings.autoLock')} desc={t('settings.autoLockHint')}>
          <select className="select" style={{ width: 160 }} value={s.autoLockMinutes} onChange={(e) => void update({ autoLockMinutes: Number(e.target.value) })} aria-label={t('settings.autoLock')}>
            {[1, 5, 15, 30, 60, 240].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? t('settings.minutes', { count: m }) : t('settings.hours', { count: m / 60 })}
              </option>
            ))}
            <option value={0}>{t('settings.never')}</option>
          </select>
        </Row>
        <Row title={t('settings.passwordOnSend')} desc={t('settings.passwordOnSendHint')}>
          <Toggle checked={s.requirePasswordToSend} onChange={(v) => void update({ requirePasswordToSend: v })} label={t('settings.passwordOnSend')} />
        </Row>
      </div>
      {overview && (
        <div className="card">
          <Row title={t('settings.changePassword')} desc={t('settings.changePasswordHint')}>
            <Button onClick={() => setChangePw(true)}>
              <Lock size={15} /> {t('settings.change')}
            </Button>
          </Row>
          {!overview.watchOnly && (
            <Row title={t('settings.showPhrase')} desc={t('settings.showPhraseHint')}>
              <Button onClick={() => setReveal(true)}>
                <KeyRound size={15} /> {t('common.show')}
              </Button>
            </Row>
          )}
          <Row title={t('settings.xpub')} desc={t('settings.xpubHint')}>
            <Button onClick={() => void window.lbc.wallets.xpub().then(setXpub)}>{t('settings.showXpub')}</Button>
          </Row>
        </div>
      )}

      {reveal && (
        <PasswordPrompt
          title={t('settings.showPhrase')}
          description={t('settings.showPhrasePrompt')}
          confirmLabel={t('common.show')}
          onClose={() => setReveal(false)}
          onSubmit={async (pw) => {
            setSecret(await window.lbc.wallets.reveal(pw));
            setReveal(false);
          }}
        />
      )}
      {secret && (
        <Modal
          title={t('settings.secretTitle')}
          icon={<ShieldAlert size={22} color="var(--warning)" />}
          onClose={() => setSecret(null)}
          footer={
            <Button variant="primary" onClick={() => setSecret(null)}>
              {t('common.done')}
            </Button>
          }
          wide
        >
          <div className="stack">
            <Callout tone="warn">{t('settings.secretWarning')}</Callout>
            {secret.type === 'mnemonic' ? (
              <>
                <div className="words" dir="ltr">
                  {secret.secret.split(' ').map((w, i) => (
                    <div className="word" key={i}>
                      <span className="n">{i + 1}</span>
                      <span className="selectable">{w}</span>
                    </div>
                  ))}
                </div>
                <div className="small muted">
                  {t('restore.derivationIs', { scheme: secret.scheme === 'lbry' ? t('welcome.kindLbry') : t('settings.bip44Path', { path: "m/44'/140'/0'" }) })}
                  {secret.passphrase ? ` · ${t('settings.withPassphrase')}` : ''}
                </div>
              </>
            ) : (
              <div className="address-box mono selectable" style={{ fontSize: 12.5 }}>
                {secret.secret}
              </div>
            )}
          </div>
        </Modal>
      )}
      {xpub && (
        <Modal title={t('settings.xpub')} onClose={() => setXpub(null)} footer={<CopyButton text={xpub} label={t('settings.copyXpub')} size="lg" variant="primary" />}>
          <div className="address-box mono selectable" style={{ fontSize: 12.5 }}>
            {xpub}
          </div>
        </Modal>
      )}
      {changePw && <ChangePassword onClose={() => setChangePw(false)} onDone={() => toast({ kind: 'confirmed', title: t('settings.passwordChanged') })} />}
    </div>
  );
}

function ChangePassword({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await window.lbc.wallets.changePassword(oldPw, newPw);
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('settings.changePassword')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!oldPw || newPw.length < 8 || newPw !== confirm} onClick={() => void submit()}>
            {t('settings.changePassword')}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label={t('settings.currentPassword')} error={error || undefined}>
          <PasswordInput value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoFocus />
        </Field>
        <Field label={t('settings.newPassword')}>
          <PasswordInput value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          {newPw && <StrengthMeter password={newPw} />}
        </Field>
        <Field label={t('settings.confirmNewPassword')} error={confirm && confirm !== newPw ? t('create.mismatch') : undefined}>
          <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function WalletTab() {
  const t = useT();
  const [s, update] = useSettings();
  const overview = useApp((st) => st.overview);
  const setOverview = useApp((st) => st.setOverview);
  const refreshWallets = useApp((st) => st.refreshWallets);
  const toast = useApp((st) => st.toast);
  const [name, setName] = useState(overview?.name ?? '');
  const [fee, setFee] = useState(String(s.feePerByte));
  const [deleting, setDeleting] = useState(false);
  const [rescanning, setRescanning] = useState(false);

  useEffect(() => setName(overview?.name ?? ''), [overview?.name]);
  if (!overview) return <div className="muted">{t('settings.openWalletFirst')}</div>;

  return (
    <div className="stack">
      <div className="card">
        <Row title={t('common.walletName')}>
          <div className="row">
            <input className="input" style={{ width: 240, maxWidth: '100%' }} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} aria-label={t('common.walletName')} />
            <Button
              disabled={!name.trim() || name === overview.name}
              onClick={async () => {
                setOverview(await window.lbc.wallets.rename(name));
                await refreshWallets();
              }}
            >
              {t('common.save')}
            </Button>
          </div>
        </Row>
        <Row title={t('settings.defaultFee')} desc={t('settings.defaultFeeHint')}>
          <div className="row">
            <input className="input" style={{ width: 100 }} value={fee} onChange={(e) => setFee(e.target.value.replace(/\D/g, ''))} aria-label={t('settings.defaultFee')} />
            <Button disabled={!fee || Number(fee) === s.feePerByte} onClick={() => void update({ feePerByte: Number(fee) })}>
              {t('common.save')}
            </Button>
          </div>
        </Row>
        <Row title={t('settings.rescan')} desc={t('settings.rescanHint')}>
          <Button
            loading={rescanning}
            onClick={async () => {
              setRescanning(true);
              try {
                await window.lbc.wallet.rescan();
                toast({ kind: 'confirmed', title: t('settings.rescanDone') });
              } catch (err) {
                toast({ kind: 'error', title: t('settings.rescanFailed'), message: errorMessage(err) });
              } finally {
                setRescanning(false);
              }
            }}
          >
            <RefreshCw size={15} /> {t('settings.rescan')}
          </Button>
        </Row>
      </div>
      <div className="card">
        <Row title={t('settings.deleteWallet')} desc={t('settings.deleteWalletHint')}>
          <Button variant="danger" onClick={() => setDeleting(true)}>
            <Trash2 size={15} /> {t('settings.deleteButton')}
          </Button>
        </Row>
      </div>
      {deleting && (
        <PasswordPrompt
          title={t('settings.deleteWallet')}
          danger
          confirmLabel={t('settings.deletePermanently')}
          description={
            <>
              {t('settings.deleteWarning')} <strong>{t('settings.deleteWarningStrong', { name: overview.name })}</strong>
            </>
          }
          onClose={() => setDeleting(false)}
          onSubmit={async (pw) => {
            await window.lbc.wallets.remove(overview.id, pw);
            setDeleting(false);
            await refreshWallets();
            useApp.setState({ overview: null, route: { name: 'welcome' } });
          }}
        />
      )}
    </div>
  );
}

function About() {
  const t = useT();
  const info = useApp((s) => s.info)!;
  const [s, update] = useSettings();
  const [terms, setTerms] = useState(false);
  return (
    <div className="stack">
      <Callout tone="warn" title={t('about.unauditedTitle')}>
        <div className="stack tight">
          <span>{t('about.unauditedText')}</span>
          <span>
            <Button size="sm" onClick={() => setTerms(true)}>
              <FileWarning size={15} /> {t('about.readDisclaimer')}
            </Button>
          </span>
        </div>
      </Callout>
      <div className="card">
        <div className="kv">
          <div className="k">{t('about.version')}</div>
          <div>{info.version}</div>
          <div className="k">{t('about.runtime')}</div>
          <div>{info.runtime}</div>
          <div className="k">{t('about.platform')}</div>
          <div>{t('about.platformValue', { platform: info.platform, arch: info.arch, count: info.cpuCount })}</div>
          <div className="k">{t('about.dataFolder')}</div>
          <div className="mono small break selectable" dir="ltr">
            {info.dataDir}
          </div>
        </div>
        <div className="row wrap" style={{ marginTop: 16 }}>
          <Button size="sm" onClick={() => void window.lbc.app.openExternal(REPO_URL)}>
            <ExternalLink size={15} /> {t('about.source')}
          </Button>
          <Button size="sm" onClick={() => void window.lbc.app.openExternal(`${REPO_URL}/releases`)}>
            <ExternalLink size={15} /> {t('about.updates')}
          </Button>
          <Button size="sm" onClick={() => void window.lbc.app.openExternal(`${REPO_URL}/blob/HEAD/docs/manual/README.md`)}>
            <ExternalLink size={15} /> {t('menu.manual')}
          </Button>
          <Button size="sm" onClick={() => void window.lbc.app.openExternal(`${REPO_URL}/issues`)}>
            <ExternalLink size={15} /> {t('about.report')}
          </Button>
        </div>
      </div>
      <div className="card">
        <Row title={t('about.developerMode')} desc={t('about.developerModeHint')}>
          <Toggle checked={s.developerMode} onChange={(v) => void update({ developerMode: v })} label={t('about.developerMode')} />
        </Row>
        {s.developerMode && (
          <Row title={t('overview.network')} desc={t('about.networkHint')}>
            <Segmented
              value={s.network}
              options={[
                { value: 'mainnet', label: 'Mainnet' },
                { value: 'testnet', label: 'Testnet' },
                { value: 'regtest', label: 'Regtest' },
              ]}
              onChange={(network) => void update({ network }).then(() => useApp.getState().refreshWallets())}
            />
          </Row>
        )}
      </div>
      <div className="small muted">{t('about.license')}</div>
      {terms && (
        <Modal
          title={t('terms.title')}
          onClose={() => setTerms(false)}
          wide
          footer={
            <Button variant="primary" onClick={() => setTerms(false)}>
              {t('common.close')}
            </Button>
          }
        >
          <TermsText />
        </Modal>
      )}
    </div>
  );
}
