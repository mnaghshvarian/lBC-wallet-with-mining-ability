import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, KeyRound, Lock, Plus, RefreshCw, ShieldAlert, Trash2, Wifi } from 'lucide-react';
import { MAINNET } from '@lbcwallet/core/ui';
import { useApp, errorMessage } from '../store';
import { Badge, Button, Callout, CopyButton, Field, IconButton, Modal, PasswordInput, PasswordPrompt, Segmented, StrengthMeter, Toggle } from '../components/ui';
import type { HubEndpoint, HubTestResult, Settings } from '../../../shared/api';

type Tab = 'general' | 'network' | 'security' | 'wallet' | 'about';
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'INR', 'BRL', 'RUB', 'TRY', 'KRW', 'BTC'];

export function SettingsPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) ?? 'general');
  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
      </div>
      <div className="tabs">
        {(['general', 'network', 'security', 'wallet', 'about'] as Tab[]).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t[0]!.toUpperCase() + t.slice(1)}
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

function Row({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
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
  return [
    settings,
    async (patch) => {
      try {
        await updateSettings(patch);
      } catch (err) {
        toast({ kind: 'error', title: 'Could not save setting', message: errorMessage(err) });
      }
    },
  ];
}

function General() {
  const [s, update] = useSettings();
  const [txUrl, setTxUrl] = useState(s.explorerTxUrl);
  return (
    <div className="card">
      <Row title="Theme">
        <Segmented
          value={s.theme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
          onChange={(theme) => void update({ theme })}
        />
      </Row>
      <Row title="Show fiat values" desc="Fetches the LBC price from CoinPaprika (CoinGecko as fallback). Turn off for maximum privacy.">
        <Toggle checked={s.showFiat} onChange={(v) => void update({ showFiat: v })} label="Show fiat values" />
      </Row>
      <Row title="Currency">
        <select className="select" style={{ width: 140 }} value={s.fiatCurrency} disabled={!s.showFiat} onChange={(e) => void update({ fiatCurrency: e.target.value })}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Row>
      <Row title="Hide balances" desc="Mask amounts on screen (useful when sharing your screen).">
        <Toggle checked={s.hideBalances} onChange={(v) => void update({ hideBalances: v })} label="Hide balances" />
      </Row>
      <Row title="Block explorer" desc="Link used for “View in explorer”. {txid} is replaced with the transaction id.">
        <input className="input mono" style={{ width: 340 }} value={txUrl} onChange={(e) => setTxUrl(e.target.value)} onBlur={() => txUrl !== s.explorerTxUrl && void update({ explorerTxUrl: txUrl })} />
      </Row>
    </div>
  );
}

function HubTestBadge({ result }: { result?: HubTestResult | 'testing' }) {
  if (!result) return null;
  if (result === 'testing') return <Badge>testing…</Badge>;
  return result.ok ? <Badge tone="green">{result.latencyMs} ms · #{result.height?.toLocaleString()}</Badge> : <Badge tone="red">{result.error ?? 'failed'}</Badge>;
}

function Network() {
  const [s, update] = useSettings();
  const overview = useApp((s) => s.overview);
  const toast = useApp((s) => s.toast);
  const [tests, setTests] = useState<Record<string, HubTestResult | 'testing'>>({});
  const [newHub, setNewHub] = useState({ host: '', port: '50001', tls: false });
  const [node, setNode] = useState(s.lbcd);
  const [nodeTest, setNodeTest] = useState<HubTestResult | 'testing' | undefined>();
  const [socks, setSocks] = useState(s.socks5);
  const defaults = s.network === 'mainnet' ? MAINNET.defaultHubs : [];

  const test = async (h: HubEndpoint) => {
    const key = `${h.host}:${h.port}`;
    setTests((t) => ({ ...t, [key]: 'testing' }));
    const r = await window.lbc.network.testHub(h).catch((err) => ({ ok: false, error: errorMessage(err) }));
    setTests((t) => ({ ...t, [key]: r }));
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

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <h3>Connection</h3>
          <div className="spacer" />
          {overview && (
            <Button
              size="sm"
              onClick={() =>
                void window.lbc.network
                  .reconnect()
                  .then(() => toast({ kind: 'confirmed', title: 'Reconnecting' }))
                  .catch((err) => toast({ kind: 'error', title: 'Reconnect failed', message: errorMessage(err) }))
              }
            >
              <RefreshCw size={15} /> Reconnect
            </Button>
          )}
        </div>
        <Segmented
          value={s.backendMode}
          options={[
            { value: 'hub', label: 'LBRY hubs (light wallet)' },
            { value: 'lbcd', label: 'My own node (lbcd)' },
          ]}
          onChange={(backendMode) => void update({ backendMode })}
        />
        <div className="hint" style={{ marginTop: 8 }}>
          {s.backendMode === 'hub'
            ? 'Hubs are public servers that index the LBRY blockchain. They never see your keys, and every confirmed transaction is checked against proof-of-work headers.'
            : 'Maximum privacy and trust: the wallet talks only to your own full node.'}
        </div>
        {overview && (
          <div className="row small" style={{ marginTop: 12 }}>
            <span className={`dot ${overview.backend.connected ? 'ok' : 'bad'}`} />
            {overview.backend.connected ? `Connected to ${overview.backend.server}` : `Not connected${overview.backend.error ? ` — ${overview.backend.error}` : ''}`}
          </div>
        )}
      </div>

      {s.backendMode === 'hub' ? (
        <div className="card">
          <div className="card-header">
            <h3>Hub servers</h3>
          </div>
          <Row title="Use the default hub list" desc="Odysee and community-operated hubs. The wallet picks one and fails over automatically.">
            <Toggle checked={s.useDefaultHubs} onChange={(v) => void update({ useDefaultHubs: v })} label="Use default hubs" />
          </Row>
          <table className="table" style={{ marginTop: 8 }}>
            <tbody>
              {[...(s.useDefaultHubs ? defaults.map((h) => ({ ...h, custom: false })) : []), ...s.customHubs.map((h) => ({ ...h, custom: true }))].map((h) => (
                <tr key={`${h.host}:${h.port}`}>
                  <td className="mono">
                    {h.host}:{h.port} {h.tls && <Badge tone="blue">TLS</Badge>} {h.custom && <Badge>custom</Badge>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                      <HubTestBadge result={tests[`${h.host}:${h.port}`]} />
                      <Button size="sm" variant="ghost" onClick={() => void test(h)}>
                        <Wifi size={14} /> Test
                      </Button>
                      {h.custom && (
                        <IconButton label="Remove" onClick={() => void update({ customHubs: s.customHubs.filter((x) => !(x.host === h.host && x.port === h.port)) })}>
                          <Trash2 size={15} />
                        </IconButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 12 }}>
            <input className="input mono" placeholder="hub.example.com" value={newHub.host} onChange={(e) => setNewHub({ ...newHub, host: e.target.value })} />
            <input className="input" style={{ width: 100 }} value={newHub.port} onChange={(e) => setNewHub({ ...newHub, port: e.target.value.replace(/\D/g, '') })} />
            <label className="row small nowrap">
              <input type="checkbox" checked={newHub.tls} onChange={(e) => setNewHub({ ...newHub, tls: e.target.checked })} /> TLS
            </label>
            <Button onClick={() => void addHub()} disabled={!newHub.host.trim()}>
              <Plus size={15} /> Add
            </Button>
          </div>
        </div>
      ) : (
        <div className="card stack">
          <div className="card-header">
            <h3>Full node (lbcd)</h3>
          </div>
          <Callout>
            Run lbcd with <span className="mono">--txindex --addrindex</span> and RPC credentials. The default RPC port is 9245 (HTTPS with the self-signed <span className="mono">rpc.cert</span>; point
            the certificate field at it, or run lbcd with <span className="mono">--notls</span> on localhost).
          </Callout>
          <Field label="RPC URL">
            <input className="input mono" value={node.url} onChange={(e) => setNode({ ...node, url: e.target.value })} placeholder="https://127.0.0.1:9245" />
          </Field>
          <div className="grid grid-2">
            <Field label="RPC username">
              <input className="input" value={node.username} onChange={(e) => setNode({ ...node, username: e.target.value })} />
            </Field>
            <Field label="RPC password">
              <PasswordInput value={node.password} onChange={(e) => setNode({ ...node, password: e.target.value })} />
            </Field>
          </div>
          <Field label="TLS certificate (rpc.cert) path" hint="e.g. ~/.lbcd/rpc.cert — leave empty for --notls nodes.">
            <input className="input mono" value={node.certPath} onChange={(e) => setNode({ ...node, certPath: e.target.value })} />
          </Field>
          <div className="row">
            <Button variant="primary" onClick={() => void saveNode()}>
              Save &amp; test
            </Button>
            <HubTestBadge result={nodeTest} />
          </div>
        </div>
      )}

      <div className="card stack">
        <div className="card-header">
          <h3>Proxy</h3>
        </div>
        <Row title="Route connections through SOCKS5 (e.g. Tor)" desc="Hub, pool and price connections go through the proxy; DNS is resolved by the proxy too.">
          <Toggle checked={socks.enabled} onChange={(v) => setSocks({ ...socks, enabled: v })} label="SOCKS5" />
        </Row>
        <div className="row">
          <input className="input mono" value={socks.host} onChange={(e) => setSocks({ ...socks, host: e.target.value })} />
          <input className="input" style={{ width: 110 }} value={socks.port} onChange={(e) => setSocks({ ...socks, port: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
          <Button onClick={() => void update({ socks5: socks })}>Save</Button>
        </div>
      </div>
    </div>
  );
}

function Security() {
  const [s, update] = useSettings();
  const overview = useApp((st) => st.overview);
  const toast = useApp((st) => st.toast);
  const [reveal, setReveal] = useState(false);
  const [secret, setSecret] = useState<{ type: string; secret: string; passphrase?: string; scheme?: string } | null>(null);
  const [changePw, setChangePw] = useState(false);
  const [xpub, setXpub] = useState<string | null>(null);

  return (
    <div className="stack">
      <div className="card">
        <Row title="Auto-lock" desc="Lock the wallet after this much inactivity. It also locks when the computer sleeps.">
          <select className="select" style={{ width: 160 }} value={s.autoLockMinutes} onChange={(e) => void update({ autoLockMinutes: Number(e.target.value) })}>
            {[1, 5, 15, 30, 60, 240].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}
              </option>
            ))}
            <option value={0}>Never</option>
          </select>
        </Row>
        <Row title="Ask for the password on every send" desc="Recommended. When on, private keys are never kept in memory — they're derived only to sign, then wiped.">
          <Toggle checked={s.requirePasswordToSend} onChange={(v) => void update({ requirePasswordToSend: v })} label="Require password" />
        </Row>
      </div>
      {overview && (
        <div className="card">
          <Row title="Change password" desc="Re-encrypts this wallet's keys with a new password.">
            <Button onClick={() => setChangePw(true)}>
              <Lock size={15} /> Change
            </Button>
          </Row>
          {!overview.watchOnly && (
            <Row title="Show recovery phrase" desc="Displays the secret that controls this wallet. Make sure nobody is watching.">
              <Button onClick={() => setReveal(true)}>
                <KeyRound size={15} /> Show
              </Button>
            </Row>
          )}
          <Row title="Extended public key (xpub)" desc="Lets software watch your balance without being able to spend. It reveals all your addresses — share carefully.">
            <Button onClick={() => void window.lbc.wallets.xpub().then(setXpub)}>Show xpub</Button>
          </Row>
        </div>
      )}

      {reveal && (
        <PasswordPrompt
          title="Show recovery phrase"
          description="Enter your password to display the recovery phrase."
          confirmLabel="Show"
          onClose={() => setReveal(false)}
          onSubmit={async (pw) => {
            setSecret(await window.lbc.wallets.reveal(pw));
            setReveal(false);
          }}
        />
      )}
      {secret && (
        <Modal title="Recovery secret" icon={<ShieldAlert size={22} color="var(--warning)" />} onClose={() => setSecret(null)} footer={<Button variant="primary" onClick={() => setSecret(null)}>Done</Button>} wide>
          <div className="stack">
            <Callout tone="warn">Anyone who sees this can take your funds. Never share it or enter it on a website.</Callout>
            {secret.type === 'mnemonic' ? (
              <>
                <div className="words">
                  {secret.secret.split(' ').map((w, i) => (
                    <div className="word" key={i}>
                      <span className="n">{i + 1}</span>
                      <span className="selectable">{w}</span>
                    </div>
                  ))}
                </div>
                <div className="small muted">
                  Derivation: {secret.scheme === 'lbry' ? 'LBRY Desktop / Odysee compatible' : "Standard BIP44 (m/44'/140'/0')"}
                  {secret.passphrase ? ' · protected with an extra BIP39 passphrase' : ''}
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
        <Modal title="Extended public key" onClose={() => setXpub(null)} footer={<CopyButton text={xpub} label="Copy xpub" size="lg" variant="primary" />}>
          <div className="address-box mono selectable" style={{ fontSize: 12.5 }}>
            {xpub}
          </div>
        </Modal>
      )}
      {changePw && <ChangePassword onClose={() => setChangePw(false)} onDone={() => toast({ kind: 'confirmed', title: 'Password changed' })} />}
    </div>
  );
}

function ChangePassword({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
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
      title="Change password"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!oldPw || newPw.length < 8 || newPw !== confirm} onClick={() => void submit()}>
            Change password
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Current password" error={error || undefined}>
          <PasswordInput value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoFocus />
        </Field>
        <Field label="New password">
          <PasswordInput value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          {newPw && <StrengthMeter password={newPw} />}
        </Field>
        <Field label="Confirm new password" error={confirm && confirm !== newPw ? 'Passwords do not match' : undefined}>
          <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function WalletTab() {
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
  if (!overview) return <div className="muted">Open a wallet to manage it.</div>;

  return (
    <div className="stack">
      <div className="card">
        <Row title="Wallet name">
          <div className="row">
            <input className="input" style={{ width: 240 }} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
            <Button
              disabled={!name.trim() || name === overview.name}
              onClick={async () => {
                setOverview(await window.lbc.wallets.rename(name));
                await refreshWallets();
              }}
            >
              Save
            </Button>
          </div>
        </Row>
        <Row title="Default fee rate" desc="Dewies per byte. 50 is the LBRY SDK default; the network minimum relay fee is 1.">
          <div className="row">
            <input className="input" style={{ width: 100 }} value={fee} onChange={(e) => setFee(e.target.value.replace(/\D/g, ''))} />
            <Button disabled={!fee || Number(fee) === s.feePerByte} onClick={() => void update({ feePerByte: Number(fee) })}>
              Save
            </Button>
          </div>
        </Row>
        <Row title="Rescan" desc="Re-downloads this wallet's history from the network. Use it if a balance looks wrong.">
          <Button
            loading={rescanning}
            onClick={async () => {
              setRescanning(true);
              try {
                await window.lbc.wallet.rescan();
                toast({ kind: 'confirmed', title: 'Rescan complete' });
              } catch (err) {
                toast({ kind: 'error', title: 'Rescan failed', message: errorMessage(err) });
              } finally {
                setRescanning(false);
              }
            }}
          >
            <RefreshCw size={15} /> Rescan
          </Button>
        </Row>
      </div>
      <div className="card">
        <Row title="Delete this wallet" desc="Removes the wallet file from this computer. Your funds stay on the blockchain and can be restored with the recovery phrase.">
          <Button variant="danger" onClick={() => setDeleting(true)}>
            <Trash2 size={15} /> Delete wallet
          </Button>
        </Row>
      </div>
      {deleting && (
        <PasswordPrompt
          title="Delete wallet"
          danger
          confirmLabel="Delete permanently"
          description={
            <>
              Make sure you have your recovery phrase written down. <strong>Without it, the funds in “{overview.name}” are lost forever.</strong>
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
  const info = useApp((s) => s.info)!;
  const [s, update] = useSettings();
  return (
    <div className="stack">
      <div className="card">
        <div className="kv">
          <div className="k">Version</div>
          <div>{info.version}</div>
          <div className="k">Electron / Chrome</div>
          <div>
            {info.electron} / {info.chrome}
          </div>
          <div className="k">Platform</div>
          <div>
            {info.platform} ({info.arch}), {info.cpuCount} CPU threads
          </div>
          <div className="k">Data folder</div>
          <div className="mono small break selectable">{info.dataDir}</div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <Button size="sm" onClick={() => void window.lbc.app.openExternal('https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability')}>
            <ExternalLink size={15} /> Source code
          </Button>
          <Button size="sm" onClick={() => void window.lbc.app.openExternal('https://github.com/mnaghshvarian/lBC-wallet-with-mining-ability/releases')}>
            <ExternalLink size={15} /> Check for updates
          </Button>
        </div>
      </div>
      <div className="card">
        <Row title="Developer mode" desc="Shows test-network options. Wallets are kept separately per network.">
          <Toggle checked={s.developerMode} onChange={(v) => void update({ developerMode: v })} label="Developer mode" />
        </Row>
        {s.developerMode && (
          <Row title="Network" desc="Switching locks the open wallet.">
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
      <div className="small muted">
        LBC Wallet is open-source software provided under the MIT license, without warranty. It is not affiliated with LBRY Inc. or Odysee.
      </div>
    </div>
  );
}
