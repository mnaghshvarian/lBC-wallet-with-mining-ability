import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, Cpu, Folder, FolderOpen, HardDrive, Info, Network, Play, RefreshCw, Square, Users } from 'lucide-react';
import { useApp, useT, errorMessage, viewError } from '../store';
import { Badge, Button, Callout, Field, Toggle } from '../components/ui';
import { bytes, duration, number, percent } from '../lib/format';
import type { NodeRequirementsView, NodeStatusView } from '@lbcwallet/services/api';
import type { Translate } from '../i18n';

const P2P_PORT: Record<string, number> = { mainnet: 9246, testnet: 19246, regtest: 29246 };

function stateBadge(t: Translate, n: NodeStatusView | null) {
  switch (n?.state) {
    case 'starting':
      return <Badge tone="blue">{t('node.state.starting')}</Badge>;
    case 'syncing':
      return <Badge tone="blue">{t('node.state.syncing')}</Badge>;
    case 'synced':
      return <Badge tone="green">{t('node.state.synced')}</Badge>;
    case 'stopping':
      return <Badge>{t('node.state.stopping')}</Badge>;
    case 'error':
      return <Badge tone="red">{t('node.state.error')}</Badge>;
    default:
      return <Badge>{t('node.state.off')}</Badge>;
  }
}

/** Optional extra nodes to connect to (for example your own node on another computer). */
function PeersField() {
  const t = useT();
  const settings = useApp((s) => s.settings)!;
  const updateSettings = useApp((s) => s.updateSettings);
  const [open, setOpen] = useState(settings.node.peers.length > 0);
  const [text, setText] = useState(settings.node.peers.join('\n'));
  const peers = text.split(/[\s,]+/).filter(Boolean);
  const invalid = peers.filter((p) => !/^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+):\d{1,5}$/.test(p));
  if (!open) {
    return (
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        {t('create.showAdvanced')}
      </button>
    );
  }
  return (
    <Field label={t('node.peersLabel')} hint={t('node.peersHint')} error={invalid.length ? t('node.peersInvalid', { peers: invalid.join(', ') }) : undefined}>
      <textarea
        className="textarea mono"
        rows={2}
        value={text}
        placeholder="203.0.113.5:9246"
        spellCheck={false}
        dir="ltr"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => !invalid.length && void updateSettings({ node: { ...settings.node, peers } })}
      />
    </Field>
  );
}

export function NodePage() {
  const t = useT();
  const node = useApp((s) => s.node);
  const settings = useApp((s) => s.settings)!;
  const updateSettings = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const [req, setReq] = useState<NodeRequirementsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[] | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const running = !!node && (node.state === 'starting' || node.state === 'syncing' || node.state === 'synced');
  const stopping = node?.state === 'stopping';

  useEffect(() => {
    void window.lbc.node.requirements().then(setReq);
  }, [settings.node.dataDir, settings.network]);

  useEffect(() => {
    if (!logs) return;
    const load = () => void window.lbc.node.logs().then(setLogs);
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
    // Reload while the log panel is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!logs]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs?.length]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toast({ kind: 'error', title: t('nav.node'), message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      await window.lbc.node.start();
      // The wallet switches to the node by itself once it has the whole chain.
      if (settings.backendMode === 'hub') await updateSettings({ backendMode: 'local' });
    });
  const stop = () => run(() => window.lbc.node.stop());
  const chooseFolder = () => run(() => window.lbc.node.chooseDataDir());

  const dataDir = node?.dataDir || req?.defaultDataDir || '';
  const lowRam = !!req && req.systemRamGb > 0 && req.systemRamGb < req.ramGb;
  const lowDisk = !!req && node?.diskFree != null && node.diskFree < req.diskGb * 1e9 - (node.diskUsed ?? 0);
  const error = viewError(node);
  const port = P2P_PORT[settings.network] ?? 9246;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t('node.title')}</h1>
          <div className="sub">{t('node.sub')}</div>
        </div>
        <div className="actions">{stateBadge(t, node)}</div>
      </div>

      {!running && !stopping && (
        <div className="card stack">
          <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
            <div className="node-icon">
              <HardDrive size={28} />
            </div>
            <div className="stack tight" style={{ flex: 1, minWidth: 0 }}>
              <h3>{t('node.introTitle')}</h3>
              <div className="text-2">{t('node.introText')}</div>
            </div>
          </div>
          {req && (
            <div className="grid grid-3 node-req">
              <div className="stat">
                <div className="k">
                  <HardDrive size={14} /> {t('node.reqDisk')}
                </div>
                <div className="v">{t('node.gb', { n: req.diskGb })}</div>
                <div className="s">{node?.diskFree != null ? t('node.freeHere', { free: bytes(node.diskFree) }) : t('node.reqDiskHint')}</div>
              </div>
              <div className="stat">
                <div className="k">
                  <Cpu size={14} /> {t('node.reqRam')}
                </div>
                <div className="v">{t('node.gb', { n: req.ramGb })}</div>
                <div className="s">{req.systemRamGb ? t('node.thisComputer', { n: req.systemRamGb }) : ''}</div>
              </div>
              <div className="stat">
                <div className="k">
                  <Clock size={14} /> {t('node.reqTime')}
                </div>
                <div className="v">{t('node.reqTimeValue')}</div>
                <div className="s">{t('node.reqTimeHint')}</div>
              </div>
            </div>
          )}
          {lowRam && <Callout tone="warn">{t('node.lowRam', { have: req!.systemRamGb, need: req!.ramGb })}</Callout>}
          {lowDisk && <Callout tone="warn">{t('node.lowDisk', { need: req!.diskGb })}</Callout>}
          {error && (
            <Callout tone="danger" title={t('node.failedTitle')}>
              {error}
            </Callout>
          )}

          <div className="storage-box">
            <div className="label">{t('node.storage')}</div>
            <div className="row wrap">
              <Folder size={18} color="var(--text-3)" />
              <span className="mono small break selectable" style={{ flex: '1 1 240px' }} dir="ltr">
                {dataDir}
              </span>
              <Button size="sm" onClick={() => void chooseFolder()} disabled={busy}>
                <FolderOpen size={15} /> {t('node.changeFolder')}
              </Button>
            </div>
            <div className="hint">{settings.node.dataDir ? t('node.storageCustom') : t('node.storageDefault')}</div>
          </div>

          <div className="setting-row">
            <div className="text">
              <div className="title row">
                <Network size={15} /> {t('node.listen')}
              </div>
              <div className="desc">{t('node.listenHint', { port })}</div>
            </div>
            <Toggle checked={settings.node.listen} onChange={(v) => void updateSettings({ node: { ...settings.node, listen: v } })} label={t('node.listen')} />
          </div>

          <PeersField />

          <div className="row">
            <div className="spacer" />
            <Button variant="primary" size="lg" loading={busy} onClick={() => void start()}>
              <Play size={16} /> {error ? t('node.retry') : t('node.start')}
            </Button>
          </div>
        </div>
      )}

      {(running || stopping) && node && (
        <>
          <div className="card stack">
            <div className="row between wrap">
              <div className="stack tight" style={{ minWidth: 0 }}>
                <div className="muted small">{node.state === 'synced' ? t('node.syncedLine') : node.state === 'starting' ? t('node.startingLine') : t('node.syncingLine')}</div>
                <div className="hashrate-big">{percent(node.progress, node.progress >= 0.999 ? 0 : 2)}</div>
                <div className="small text-2">
                  {t('node.blocks', { height: number(node.height), total: node.networkHeight ? number(node.networkHeight) : '…' })}
                  {node.state === 'syncing' && node.headers > node.height && node.height === 0 ? ` · ${t('node.headers', { n: number(node.headers) })}` : ''}
                </div>
              </div>
              <Button variant="danger" loading={busy || stopping} onClick={() => void stop()}>
                <Square size={16} /> {stopping ? t('node.stopping') : t('node.stop')}
              </Button>
            </div>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(node.progress * 100)}>
              <div className="bar" style={{ width: `${Math.max(1, node.progress * 100)}%` }} />
            </div>
            {node.state === 'synced' ? (
              <Callout tone="ok" title={t('node.readyTitle')}>
                <span className="row">
                  <CheckCircle2 size={16} /> {settings.backendMode === 'local' ? t('node.readyText') : t('node.readyNotUsed')}
                </span>
              </Callout>
            ) : (
              <div className="hint">{t('node.syncHint')}</div>
            )}
            {settings.backendMode !== 'local' && (
              <div className="row">
                <Button size="sm" onClick={() => void updateSettings({ backendMode: 'local' })}>
                  {t('node.useForWallet')}
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-4" style={{ marginTop: 16 }}>
            <div className="stat">
              <div className="k">
                <Users size={14} /> {t('node.peers')}
              </div>
              <div className="v">{number(node.peers)}</div>
              <div className="s">{node.listen ? t('node.listening', { port }) : t('node.outboundOnly')}</div>
            </div>
            <div className="stat">
              <div className="k">
                <Clock size={14} /> {t('node.eta')}
              </div>
              <div className="v">{node.state === 'synced' ? '—' : node.etaSeconds ? duration(node.etaSeconds * 1000) : '…'}</div>
              <div className="s">{node.startedAt ? t('node.uptime', { time: duration(Date.now() - node.startedAt) }) : ''}</div>
            </div>
            <div className="stat">
              <div className="k">
                <HardDrive size={14} /> {t('node.diskUsed')}
              </div>
              <div className="v">{node.diskUsed != null ? bytes(node.diskUsed) : '…'}</div>
              <div className="s">{node.diskFree != null ? t('node.diskFree', { free: bytes(node.diskFree) }) : ''}</div>
            </div>
            <div className="stat">
              <div className="k">
                <RefreshCw size={14} /> {t('node.version')}
              </div>
              <div className="v" style={{ fontSize: 17 }}>
                {node.version ?? 'lbcd'}
              </div>
              <div className="s">{node.network}</div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="storage-box">
              <div className="label">{t('node.storage')}</div>
              <div className="row wrap">
                <Folder size={18} color="var(--text-3)" />
                <span className="mono small break selectable" style={{ flex: '1 1 240px' }} dir="ltr">
                  {node.dataDir}
                </span>
                <Button size="sm" variant="ghost" onClick={() => void window.lbc.node.openDataDir()}>
                  <FolderOpen size={15} /> {t('node.openFolder')}
                </Button>
              </div>
              <div className="hint">{t('node.moveHint')}</div>
            </div>
          </div>
        </>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <h3>{t('node.logTitle')}</h3>
          <div className="spacer" />
          <Button size="sm" variant="ghost" onClick={() => (logs ? setLogs(null) : void window.lbc.node.logs().then(setLogs))}>
            {logs ? t('common.hide') : t('common.show')}
          </Button>
        </div>
        {logs && (
          <div className="logbox mono selectable" ref={logRef} dir="ltr">
            {logs.length === 0 ? <div className="l muted">{t('node.logEmpty')}</div> : logs.map((l, i) => <div key={i} className="l">{l}</div>)}
          </div>
        )}
        {!logs && (
          <div className="small muted row">
            <Info size={14} /> {t('node.about')}
          </div>
        )}
      </div>
    </>
  );
}
