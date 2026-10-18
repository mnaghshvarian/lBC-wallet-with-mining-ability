import { useEffect, useMemo, useRef, useState } from 'react';
import { BatteryCharging, Cpu, Gauge, HardDrive, Laptop, Moon, Pickaxe, Play, Server, Square, Trophy, Wallet } from 'lucide-react';
import { useApp, useT, errorMessage, viewError } from '../store';
import { Badge, Button, Callout, Field, Segmented, Toggle } from '../components/ui';
import { AddressText, Sparkline } from '../components/display';
import { compact, daysText, duration, formatFiat, formatHashrate, number, percent, relativeTime } from '../lib/format';
import type { MinerEstimateView, MiningSettings, PoolBalanceView } from '@lbcwallet/services/api';
import type { Translate } from '../i18n';

const POOLS = [{ id: 'lbrypool', name: 'LBRYPool (lbrypool.net)', fee: '0.5%', url: 'stratum+tcp://lbrypool.net:3334', api: 'https://lbrypool.net' }];

/** Refreshes the pool balance for the payout address every two minutes. */
function usePoolBalance(deps: unknown[]): PoolBalanceView | null {
  const [balance, setBalance] = useState<PoolBalanceView | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void window.lbc.miner.poolBalance().then((b) => alive && setBalance(b));
    load();
    const timer = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return balance;
}

function PoolSelect({ m, setMining }: { m: MiningSettings; setMining: (patch: Partial<MiningSettings>) => void }) {
  const t = useT();
  const poolPreset = POOLS.find((p) => p.url === m.poolUrl)?.id ?? 'custom';
  return (
    <>
      <Field label={t('mining.pool')}>
        <select
          className="select"
          value={poolPreset}
          onChange={(e) => {
            const p = POOLS.find((x) => x.id === e.target.value);
            if (p) setMining({ poolUrl: p.url, poolApi: p.api });
            else setMining({ poolUrl: '', poolApi: '' });
          }}
        >
          {POOLS.map((p) => (
            <option key={p.id} value={p.id}>
              {t('mining.poolOption', { name: p.name, fee: p.fee })}
            </option>
          ))}
          <option value="custom">{t('mining.customPool')}</option>
        </select>
      </Field>
      {poolPreset === 'custom' && (
        <>
          <Field label={t('mining.poolAddress')} hint={t('mining.poolAddressHint')}>
            <input className="input mono" value={m.poolUrl} onChange={(e) => setMining({ poolUrl: e.target.value })} placeholder="stratum+tcp://pool.example.com:3334" spellCheck={false} />
          </Field>
          <Field label={t('mining.poolApi')} hint={t('mining.poolApiHint')}>
            <input className="input mono" value={m.poolApi} onChange={(e) => setMining({ poolApi: e.target.value.trim() })} placeholder="https://pool.example.com" spellCheck={false} />
          </Field>
        </>
      )}
    </>
  );
}

function PayoutField({ m, setMining }: { m: MiningSettings; setMining: (patch: Partial<MiningSettings>) => void }) {
  const t = useT();
  const overview = useApp((s) => s.overview);
  const payout = m.payoutAddress || overview?.receiveAddress || '';
  return (
    <Field label={t('mining.payout')} hint={m.payoutAddress ? t('mining.payoutCustom') : t('mining.payoutWallet')}>
      <div className="row">
        <div className="address-box" style={{ flex: 1, fontSize: 13, padding: '9px 12px' }}>
          {payout ? <AddressText address={payout} /> : <span className="muted">{t('mining.payoutNone')}</span>}
        </div>
        {m.payoutAddress ? (
          <Button size="sm" variant="ghost" onClick={() => setMining({ payoutAddress: '' })}>
            <Wallet size={15} /> {t('mining.useWallet')}
          </Button>
        ) : null}
      </div>
      <input
        className="input mono"
        style={{ marginTop: 6 }}
        placeholder={t('mining.payoutPlaceholder')}
        aria-label={t('mining.payoutPlaceholder')}
        value={m.payoutAddress}
        onChange={(e) => setMining({ payoutAddress: e.target.value.trim() })}
        spellCheck={false}
      />
    </Field>
  );
}

function PoolBalanceCard({ balance, m }: { balance: PoolBalanceView | null; m: MiningSettings }) {
  const t = useT();
  return (
    <div className="card">
      <div className="card-header">
        <h3>{t('mining.poolBalance')}</h3>
        <div className="spacer" />
        {balance && <span className="tiny muted">{relativeTime(balance.updatedAt / 1000)}</span>}
      </div>
      {balance ? (
        <div className="kv">
          <div className="k">{t('mining.unpaid')}</div>
          <div className="strong">{number(balance.balance + balance.unpaid, 4)} LBC</div>
          <div className="k">{t('mining.paid24h')}</div>
          <div>{number(balance.paid24h, 4)} LBC</div>
          <div className="k">{t('mining.paidTotal')}</div>
          <div>{number(balance.total, 4)} LBC</div>
          {balance.hashrate ? (
            <>
              <div className="k">{t('mining.poolSees')}</div>
              <div>{formatHashrate(balance.hashrate)}</div>
            </>
          ) : null}
        </div>
      ) : (
        <div className="muted small">{m.poolApi ? t('mining.noPoolData') : t('mining.noPoolApi')}</div>
      )}
      <div className="hint" style={{ marginTop: 10 }}>
        {t('mining.payoutRule')}
      </div>
    </div>
  );
}

/** Phones don't mine (heat, battery, store rules); they follow the pool balance instead. */
function MiningMonitor() {
  const t = useT();
  const settings = useApp((s) => s.settings)!;
  const overview = useApp((s) => s.overview);
  const updateSettings = useApp((s) => s.updateSettings);
  const m = settings.mining;
  const setMining = (patch: Partial<MiningSettings>) => void updateSettings({ mining: { ...m, ...patch } });
  const balance = usePoolBalance([m.poolUrl, m.poolApi, m.payoutAddress, overview?.receiveAddress]);
  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t('nav.mining')}</h1>
          <div className="sub">{t('mining.monitorSub')}</div>
        </div>
      </div>
      <Callout title={t('mining.monitorTitle')}>
        <span className="row" style={{ alignItems: 'flex-start' }}>
          <Laptop size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{t('mining.monitorText')}</span>
        </span>
      </Callout>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', marginTop: 16 }}>
        <PoolBalanceCard balance={balance} m={m} />
        <div className="card stack">
          <PoolSelect m={m} setMining={setMining} />
          <PayoutField m={m} setMining={setMining} />
        </div>
      </div>
    </>
  );
}

function stateText(t: Translate, miner: ReturnType<typeof useApp.getState>['miner'], mode: MiningSettings['mode']): string {
  if (!miner) return t('mining.state.stopped');
  if (miner.paused === 'battery') return t('mining.state.battery');
  if (miner.paused === 'in-use') return t('mining.state.inUse');
  switch (miner.state) {
    case 'starting':
      return t('mining.state.starting');
    case 'connecting':
      return mode === 'pool' ? t('mining.state.connectingPool') : t('mining.state.connectingNode');
    case 'mining':
      return t('mining.state.mining');
    case 'waiting':
      return t('mining.state.waiting');
    case 'error':
      return t('mining.state.error');
    default:
      return t('mining.state.stopped');
  }
}

/** Where solo mining gets its block templates from. */
function SoloSource() {
  const t = useT();
  const info = useApp((s) => s.info)!;
  const settings = useApp((s) => s.settings)!;
  const node = useApp((s) => s.node);
  const navigate = useApp((s) => s.navigate);
  const running = !!node && (node.state === 'syncing' || node.state === 'synced' || node.state === 'starting');
  let line: string;
  let tone: 'ok' | 'warn' | undefined;
  if (running && node.state === 'synced') {
    line = t('mining.soloBuiltInReady');
    tone = 'ok';
  } else if (running) {
    line = t('mining.soloBuiltInSyncing', { progress: percent(node.progress, 1) });
    tone = 'warn';
  } else if (settings.lbcd.url) {
    line = t('mining.soloOwnNode', { url: settings.lbcd.url });
  } else {
    line = t('mining.soloNoNode');
    tone = 'warn';
  }
  return (
    <Callout tone={tone} title={t('mining.soloTitle')}>
      <div className="stack tight">
        <span>{t('mining.soloText')}</span>
        <span className="strong">{line}</span>
        <span className="row wrap">
          {info.capabilities.node && !running && (
            <Button size="sm" onClick={() => navigate({ name: 'node' })}>
              <HardDrive size={15} /> {t('mining.openNode')}
            </Button>
          )}
          {!running && (
            <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'settings', tab: 'network' })}>
              <Server size={15} /> {t('mining.ownNode')}
            </Button>
          )}
        </span>
      </div>
    </Callout>
  );
}

export function Mining() {
  const info = useApp((s) => s.info)!;
  if (!info.capabilities.mining) return <MiningMonitor />;
  return <Miner />;
}

function Miner() {
  const t = useT();
  const settings = useApp((s) => s.settings)!;
  const info = useApp((s) => s.info)!;
  const overview = useApp((s) => s.overview);
  const miner = useApp((s) => s.miner);
  const history = useApp((s) => s.hashrateHistory);
  const log = useApp((s) => s.minerLog);
  const updateSettings = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const price = useApp((s) => s.price);
  const [estimate, setEstimate] = useState<MinerEstimateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const logRef = useRef<HTMLDivElement>(null);
  const m = settings.mining;
  const active = !!miner && miner.state !== 'stopped' && miner.state !== 'error';
  /** Switched on: running, or paused until power/idle conditions allow it. */
  const switchedOn = active || !!miner?.paused;
  const poolBalance = usePoolBalance([m.poolUrl, m.poolApi, m.payoutAddress, m.mode, overview?.receiveAddress]);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      setNow(Date.now());
      void window.lbc.miner.estimate().then((e) => alive && setEstimate(e));
    };
    tick();
    const timer = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log.length]);

  const setMining = (patch: Partial<MiningSettings>) => void updateSettings({ mining: { ...m, ...patch } });

  const toggle = async () => {
    setBusy(true);
    try {
      if (switchedOn) await window.lbc.miner.stop();
      else await window.lbc.miner.start();
    } catch (err) {
      toast({ kind: 'error', title: t('nav.mining'), message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const payout = m.payoutAddress || overview?.receiveAddress || '';
  const uptime = miner?.startedAt && active ? now - miner.startedAt : 0;
  const stateLabel = useMemo(() => stateText(t, miner, m.mode), [t, miner, m.mode]);
  const minerError = viewError(miner);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t('nav.mining')}</h1>
          <div className="sub">{t('mining.sub')}</div>
        </div>
        <div className="actions">{active ? <Badge tone="violet">{stateLabel}</Badge> : <Badge>{stateLabel}</Badge>}</div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)' }}>
        <div className="card">
          <div className="mine-hero">
            <div className={`mine-orb ${active ? 'active' : ''}`}>
              <Pickaxe size={46} />
            </div>
            <div className="stack tight" style={{ flex: 1, minWidth: 0 }}>
              <div className="muted small">
                {active
                  ? t('mining.current')
                  : miner?.paused === 'in-use'
                    ? t('mining.pausedInUse', { count: m.idleMinutes })
                    : miner?.paused === 'battery'
                      ? t('mining.pausedBattery')
                      : t('mining.idle')}
              </div>
              <div className="hashrate-big">{formatHashrate(miner?.hashrate ?? 0)}</div>
              <div className="small text-2">
                {active
                  ? t('mining.activeLine', { threads: t('overview.threads', { count: miner!.threads }), uptime: duration(uptime), avg: formatHashrate(miner!.hashrateAvg) })
                  : t('mining.idleLine', { mode: m.mode === 'pool' ? t('mining.poolMining') : t('mining.soloMining'), threads: m.threads, cpus: info.cpuCount })}
              </div>
              {minerError && <div className="error-text">{minerError}</div>}
              <div className="row" style={{ marginTop: 8 }}>
                <Button variant={switchedOn ? 'danger' : 'violet'} size="lg" loading={busy} onClick={() => void toggle()} disabled={!payout && !switchedOn}>
                  {switchedOn ? <Square size={16} /> : <Play size={16} />}
                  {switchedOn ? t('mining.stop') : t('mining.start')}
                </Button>
              </div>
            </div>
          </div>
          <div style={{ marginTop: 18 }}>
            <Sparkline points={history} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>{t('mining.estimated')}</h3>
          </div>
          {settings.network !== 'mainnet' ? (
            <div className="muted small">{t('mining.estimatesMainnetOnly')}</div>
          ) : estimate && estimate.basis !== 'none' ? (
            <div className="stack tight">
              <div className="hashrate-big" style={{ fontSize: 26 }}>
                {estimate.lbcPerDay > 0 ? t('mining.perDay', { amount: estimate.lbcPerDay < 0.01 ? estimate.lbcPerDay.toExponential(2) : number(estimate.lbcPerDay, 3) }) : '—'}
              </div>
              {estimate.fiatPerDay !== null && estimate.lbcPerDay > 0 && price && <div className="small text-2">{t('mining.fiatPerDay', { amount: formatFiat(estimate.fiatPerDay, price.currency) })}</div>}
              <div className="kv" style={{ marginTop: 10 }}>
                <div className="k">{t('mining.networkHashrate')}</div>
                <div>{formatHashrate(estimate.networkHashrate)}</div>
                <div className="k">{t('mining.blockReward')}</div>
                <div>{number(estimate.blockReward)} LBC</div>
                <div className="k">{t('mining.soloEvery')}</div>
                <div>{daysText(estimate.daysPerBlock)}</div>
              </div>
              {estimate.lbcPerDay === 0 && <div className="hint">{t('mining.measureFirst')}</div>}
            </div>
          ) : (
            <div className="muted small">{t('mining.estimatesLater')}</div>
          )}
          <div style={{ marginTop: 14 }}>
            <Callout tone="warn" title={t('mining.expectationsTitle')}>
              {t('mining.expectationsText')}
            </Callout>
          </div>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        <div className="stat">
          <div className="k">
            <Gauge size={14} /> {t('mining.average')}
          </div>
          <div className="v">{formatHashrate(miner?.hashrateAvg ?? 0)}</div>
          <div className="s">{miner?.totalHashes ? t('mining.totalHashes', { n: compact(miner.totalHashes) }) : t('mining.noHashes')}</div>
        </div>
        {m.mode === 'pool' ? (
          <div className="stat">
            <div className="k">
              <Trophy size={14} /> {t('mining.shares')}
            </div>
            <div className="v">
              <span className="positive">{number(miner?.accepted ?? 0)}</span>
              <span className="muted" style={{ fontSize: 15 }}>
                {' '}
                / {t('mining.rejected', { n: number(miner?.rejected ?? 0) })}
              </span>
            </div>
            <div className="s">{miner?.lastShareAt ? t('mining.lastShare', { when: relativeTime(miner.lastShareAt / 1000) }) : t('mining.noneYet')}</div>
          </div>
        ) : (
          <div className="stat">
            <div className="k">
              <Trophy size={14} /> {t('mining.blocksFound')}
            </div>
            <div className="v">{number(miner?.blocksFound ?? 0)}</div>
            <div className="s">{t('mining.soloFullReward')}</div>
          </div>
        )}
        <div className="stat">
          <div className="k">
            <Cpu size={14} /> {m.mode === 'pool' ? t('mining.shareDifficulty') : t('mining.threads')}
          </div>
          <div className="v">{m.mode === 'pool' ? (miner?.difficulty ? number(miner.difficulty, miner.difficulty < 10 ? 4 : 0) : '—') : (miner?.threads ?? m.threads)}</div>
          <div className="s">{m.mode === 'pool' ? t('mining.vardiff') : t('mining.cpusAvailable', { count: info.cpuCount })}</div>
        </div>
        <div className="stat">
          <div className="k">
            <Server size={14} /> {t('overview.height')}
          </div>
          <div className="v">{miner?.height ? number(miner.height) : overview?.tipHeight ? number(overview.tipHeight) : '—'}</div>
          <div className="s ellipsis">{miner?.server ?? (m.mode === 'pool' ? m.poolUrl.replace(/^stratum\+\w+:\/\//, '') : t('net.yourNode'))}</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)', marginTop: 16 }}>
        <div className="card stack">
          <div className="card-header">
            <h3>{t('mining.configuration')}</h3>
            <div className="spacer" />
            {active && <span className="small muted">{t('mining.stopToChange')}</span>}
          </div>
          <fieldset disabled={active} style={{ border: 'none', padding: 0, margin: 0 }} className="stack">
            <Field label={t('mining.mode')}>
              <Segmented
                value={m.mode}
                options={[
                  { value: 'pool', label: t('mining.modePool') },
                  { value: 'solo', label: t('mining.modeSolo') },
                ]}
                onChange={(v) => setMining({ mode: v })}
              />
            </Field>

            {m.mode === 'pool' ? (
              <>
                <PoolSelect m={m} setMining={setMining} />
                <div className="grid grid-2">
                  <Field label={t('mining.worker')}>
                    <input className="input" value={m.workerName} maxLength={64} onChange={(e) => setMining({ workerName: e.target.value })} />
                  </Field>
                  <Field label={t('mining.poolPassword')}>
                    <input className="input" value={m.poolPassword} maxLength={200} onChange={(e) => setMining({ poolPassword: e.target.value })} />
                  </Field>
                </div>
                <div className="hint">{t('mining.decentralizedSoon')}</div>
              </>
            ) : (
              <SoloSource />
            )}

            <PayoutField m={m} setMining={setMining} />

            <Field label={t('mining.threadsLabel', { threads: m.threads, cpus: info.cpuCount })} hint={t('mining.threadsHint')}>
              <input type="range" className="slider" min={1} max={info.cpuCount} value={m.threads} onChange={(e) => setMining({ threads: Number(e.target.value) })} aria-label={t('mining.threads')} />
            </Field>
            <div className="setting-row">
              <div className="text">
                <div className="title">{t('mining.lowPriority')}</div>
                <div className="desc">{t('mining.lowPriorityHint')}</div>
              </div>
              <Toggle checked={m.lowPriority} onChange={(v) => setMining({ lowPriority: v })} label={t('mining.lowPriority')} />
            </div>
            <div className="setting-row">
              <div className="text">
                <div className="title row">
                  <BatteryCharging size={15} /> {t('mining.pauseOnBattery')}
                </div>
                <div className="desc">{t('mining.pauseOnBatteryHint')}</div>
              </div>
              <Toggle checked={m.pauseOnBattery} onChange={(v) => setMining({ pauseOnBattery: v })} label={t('mining.pauseOnBattery')} />
            </div>
            <div className="setting-row">
              <div className="text">
                <div className="title row">
                  <Moon size={15} /> {t('mining.onlyIdle')}
                </div>
                <div className="desc">{t('mining.onlyIdleHint', { count: m.idleMinutes })}</div>
              </div>
              <Toggle checked={m.onlyWhenIdle} onChange={(v) => setMining({ onlyWhenIdle: v })} label={t('mining.onlyIdle')} />
            </div>
            {m.onlyWhenIdle && (
              <Field label={t('mining.startAfter')}>
                <Segmented
                  value={String(m.idleMinutes)}
                  options={[1, 3, 5, 10, 15, 30].map((n) => ({ value: String(n), label: t('mining.minutes', { count: n }) }))}
                  onChange={(v) => setMining({ idleMinutes: Number(v) })}
                />
              </Field>
            )}
          </fieldset>
        </div>

        <div className="stack">
          {m.mode === 'pool' && <PoolBalanceCard balance={poolBalance} m={m} />}
          <div className="card">
            <div className="card-header">
              <h3>{t('mining.log')}</h3>
            </div>
            <div className="logbox mono selectable" ref={logRef} dir="ltr">
              {log.length === 0 ? (
                <div className="l muted">{t('mining.logEmpty')}</div>
              ) : (
                log.map((e, i) => (
                  <div key={i} className={`l ${e.level}`}>
                    <span className="t">{new Date(e.at).toLocaleTimeString()}</span>
                    {e.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
