import { useEffect, useMemo, useRef, useState } from 'react';
import { BatteryCharging, Cpu, Gauge, Moon, Pickaxe, Play, Server, Square, Trophy, Wallet } from 'lucide-react';
import { useApp, errorMessage } from '../store';
import { Badge, Button, Callout, Field, Segmented, Toggle } from '../components/ui';
import { AddressText, Sparkline } from '../components/display';
import { compact, daysText, duration, formatFiat, formatHashrate, number, relativeTime } from '../lib/format';
import type { MinerEstimateView, MiningSettings, PoolBalanceView } from '../../../shared/api';

const POOLS = [{ id: 'lbrypool', name: 'LBRYPool (lbrypool.net) — community pool, 0.5% fee', url: 'stratum+tcp://lbrypool.net:3334', api: 'https://lbrypool.net' }];

export function Mining() {
  const settings = useApp((s) => s.settings)!;
  const info = useApp((s) => s.info)!;
  const overview = useApp((s) => s.overview);
  const miner = useApp((s) => s.miner);
  const history = useApp((s) => s.hashrateHistory);
  const log = useApp((s) => s.minerLog);
  const updateSettings = useApp((s) => s.updateSettings);
  const navigate = useApp((s) => s.navigate);
  const toast = useApp((s) => s.toast);
  const price = useApp((s) => s.price);
  const [estimate, setEstimate] = useState<MinerEstimateView | null>(null);
  const [poolBalance, setPoolBalance] = useState<PoolBalanceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const logRef = useRef<HTMLDivElement>(null);
  const m = settings.mining;
  const active = !!miner && miner.state !== 'stopped' && miner.state !== 'error';
  /** Switched on: running, or paused until power/idle conditions allow it. */
  const switchedOn = active || !!miner?.paused;
  const poolPreset = POOLS.find((p) => p.url === m.poolUrl)?.id ?? 'custom';

  useEffect(() => {
    let alive = true;
    const tick = () => {
      setNow(Date.now());
      void window.lbc.miner.estimate().then((e) => alive && setEstimate(e));
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => void window.lbc.miner.poolBalance().then((b) => alive && setPoolBalance(b));
    load();
    const t = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [m.poolUrl, m.payoutAddress, m.mode, overview?.receiveAddress]);

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
      toast({ kind: 'error', title: 'Mining', message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const payout = m.payoutAddress || overview?.receiveAddress || '';
  const uptime = miner?.startedAt && active ? now - miner.startedAt : 0;
  const stateLabel = useMemo(() => {
    if (!miner) return 'Stopped';
    if (miner.paused === 'battery') return 'Paused (on battery)';
    if (miner.paused === 'in-use') return 'Waiting for idle';
    switch (miner.state) {
      case 'starting':
        return 'Starting…';
      case 'connecting':
        return m.mode === 'pool' ? 'Connecting to pool…' : 'Connecting to node…';
      case 'mining':
        return 'Mining';
      case 'waiting':
        return 'Waiting for work';
      case 'error':
        return 'Error';
      default:
        return 'Stopped';
    }
  }, [miner, m.mode]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Mining</h1>
          <div className="sub">Mine LBRY Credits with this computer — rewards go straight to your wallet.</div>
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
                  ? 'Current hashrate'
                  : miner?.paused === 'in-use'
                    ? `Paused while you use the computer — resumes after ${m.idleMinutes} min idle`
                    : miner?.paused === 'battery'
                      ? 'Paused while on battery power'
                      : 'Miner is idle'}
              </div>
              <div className="hashrate-big">{formatHashrate(miner?.hashrate ?? 0)}</div>
              <div className="small text-2">
                {active ? (
                  <>
                    {miner!.threads} threads · up {duration(uptime)} · avg {formatHashrate(miner!.hashrateAvg)}
                  </>
                ) : (
                  <>
                    {m.mode === 'pool' ? 'Pool mining' : 'Solo mining'} · {m.threads} of {info.cpuCount} threads
                  </>
                )}
              </div>
              {miner?.error && <div className="error-text">{miner.error}</div>}
              <div className="row" style={{ marginTop: 8 }}>
                <Button variant={switchedOn ? 'danger' : 'violet'} size="lg" loading={busy} onClick={() => void toggle()} disabled={!payout && !switchedOn}>
                  {switchedOn ? <Square size={16} /> : <Play size={16} />}
                  {switchedOn ? 'Stop mining' : 'Start mining'}
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
            <h3>Estimated earnings</h3>
          </div>
          {settings.network !== 'mainnet' ? (
            <div className="muted small">Earnings estimates are shown on mainnet only — difficulty on test networks is artificial.</div>
          ) : estimate && estimate.basis !== 'none' ? (
            <div className="stack tight">
              <div className="hashrate-big" style={{ fontSize: 26 }}>
                {estimate.lbcPerDay > 0 ? `≈ ${estimate.lbcPerDay < 0.01 ? estimate.lbcPerDay.toExponential(2) : number(estimate.lbcPerDay, 3)} LBC/day` : '—'}
              </div>
              {estimate.fiatPerDay !== null && estimate.lbcPerDay > 0 && price && <div className="small text-2">≈ {formatFiat(estimate.fiatPerDay, price.currency)} per day</div>}
              <div className="kv" style={{ marginTop: 10 }}>
                <div className="k">Network hashrate</div>
                <div>{formatHashrate(estimate.networkHashrate)}</div>
                <div className="k">Block reward</div>
                <div>{number(estimate.blockReward)} LBC</div>
                <div className="k">Solo: one block every</div>
                <div>{daysText(estimate.daysPerBlock)}</div>
              </div>
              {estimate.lbcPerDay === 0 && <div className="hint">Start mining for a minute to measure your hashrate.</div>}
            </div>
          ) : (
            <div className="muted small">Estimates appear once the wallet knows the current network difficulty.</div>
          )}
          <div style={{ marginTop: 14 }}>
            <Callout tone="warn" title="Set realistic expectations">
              LBC is mined mostly by specialised hardware, so a CPU earns only a tiny amount. Mining here supports the network and is great for learning — keep an eye on electricity costs.
            </Callout>
          </div>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginTop: 16 }}>
        <div className="stat">
          <div className="k">
            <Gauge size={14} /> Average (1 min)
          </div>
          <div className="v">{formatHashrate(miner?.hashrateAvg ?? 0)}</div>
          <div className="s">{miner?.totalHashes ? `${compact(miner.totalHashes)} hashes total` : 'No hashes yet'}</div>
        </div>
        {m.mode === 'pool' ? (
          <div className="stat">
            <div className="k">
              <Trophy size={14} /> Shares
            </div>
            <div className="v">
              <span className="positive">{number(miner?.accepted ?? 0)}</span>
              <span className="muted" style={{ fontSize: 15 }}>
                {' '}
                / {number(miner?.rejected ?? 0)} rejected
              </span>
            </div>
            <div className="s">{miner?.lastShareAt ? `last ${relativeTime(miner.lastShareAt / 1000)}` : 'none yet'}</div>
          </div>
        ) : (
          <div className="stat">
            <div className="k">
              <Trophy size={14} /> Blocks found
            </div>
            <div className="v">{number(miner?.blocksFound ?? 0)}</div>
            <div className="s">solo mining pays the full reward</div>
          </div>
        )}
        <div className="stat">
          <div className="k">
            <Cpu size={14} /> {m.mode === 'pool' ? 'Share difficulty' : 'Threads'}
          </div>
          <div className="v">{m.mode === 'pool' ? (miner?.difficulty ? number(miner.difficulty, miner.difficulty < 10 ? 4 : 0) : '—') : (miner?.threads ?? m.threads)}</div>
          <div className="s">{m.mode === 'pool' ? 'set by the pool (vardiff)' : `${info.cpuCount} available`}</div>
        </div>
        <div className="stat">
          <div className="k">
            <Server size={14} /> Block height
          </div>
          <div className="v">{miner?.height ? number(miner.height) : overview?.tipHeight ? number(overview.tipHeight) : '—'}</div>
          <div className="s">{miner?.server ?? (m.mode === 'pool' ? m.poolUrl.replace(/^stratum\+\w+:\/\//, '') : 'your node')}</div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)', marginTop: 16 }}>
        <div className="card stack">
          <div className="card-header">
            <h3>Configuration</h3>
            <div className="spacer" />
            {active && <span className="small muted">Stop mining to change settings</span>}
          </div>
          <fieldset disabled={active} style={{ border: 'none', padding: 0, margin: 0 }} className="stack">
            <Field label="Mining mode">
              <Segmented
                value={m.mode}
                options={[
                  { value: 'pool', label: 'Pool (recommended)' },
                  { value: 'solo', label: 'Solo (own node)' },
                ]}
                onChange={(v) => setMining({ mode: v })}
              />
            </Field>

            {m.mode === 'pool' ? (
              <>
                <Field label="Pool">
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
                        {p.name}
                      </option>
                    ))}
                    <option value="custom">Custom pool…</option>
                  </select>
                </Field>
                {poolPreset === 'custom' && (
                  <Field label="Pool address" hint="stratum+tcp://host:port (use stratum+ssl:// for TLS). The pool must support the LBRY algorithm.">
                    <input className="input mono" value={m.poolUrl} onChange={(e) => setMining({ poolUrl: e.target.value })} placeholder="stratum+tcp://pool.example.com:3334" />
                  </Field>
                )}
                <div className="grid grid-2">
                  <Field label="Worker name">
                    <input className="input" value={m.workerName} maxLength={64} onChange={(e) => setMining({ workerName: e.target.value })} />
                  </Field>
                  <Field label="Pool password">
                    <input className="input" value={m.poolPassword} maxLength={200} onChange={(e) => setMining({ poolPassword: e.target.value })} />
                  </Field>
                </div>
              </>
            ) : (
              <Callout title="Solo mining needs your own LBRY node">
                The wallet asks your lbcd for block templates and keeps the whole block reward when it finds a block. Node: <span className="mono">{settings.lbcd.url || 'not configured'}</span>.{' '}
                <a onClick={() => navigate({ name: 'settings', tab: 'network' })}>Configure node</a>
              </Callout>
            )}

            <Field label="Payout address" hint={m.payoutAddress ? 'Custom payout address' : "Rewards are paid to this wallet's current receiving address."}>
              <div className="row">
                <div className="address-box" style={{ flex: 1, fontSize: 13, padding: '9px 12px' }}>
                  {payout ? <AddressText address={payout} /> : <span className="muted">Open a wallet or enter an address</span>}
                </div>
                {m.payoutAddress ? (
                  <Button size="sm" variant="ghost" onClick={() => setMining({ payoutAddress: '' })}>
                    <Wallet size={15} /> Use wallet
                  </Button>
                ) : null}
              </div>
              <input className="input mono" style={{ marginTop: 6 }} placeholder="Optional: pay out to a different address" value={m.payoutAddress} onChange={(e) => setMining({ payoutAddress: e.target.value.trim() })} />
            </Field>

            <Field label={`CPU threads: ${m.threads} of ${info.cpuCount}`} hint="Leave a core or two free to keep your computer responsive.">
              <input type="range" className="slider" min={1} max={info.cpuCount} value={m.threads} onChange={(e) => setMining({ threads: Number(e.target.value) })} />
            </Field>
            <div className="setting-row">
              <div className="text">
                <div className="title">Low priority</div>
                <div className="desc">Mining yields to anything else you're doing on this computer.</div>
              </div>
              <Toggle checked={m.lowPriority} onChange={(v) => setMining({ lowPriority: v })} label="Low priority" />
            </div>
            <div className="setting-row">
              <div className="text">
                <div className="title row">
                  <BatteryCharging size={15} /> Pause on battery
                </div>
                <div className="desc">Stops mining when a laptop is unplugged and resumes on AC power.</div>
              </div>
              <Toggle checked={m.pauseOnBattery} onChange={(v) => setMining({ pauseOnBattery: v })} label="Pause on battery" />
            </div>
            <div className="setting-row">
              <div className="text">
                <div className="title row">
                  <Moon size={15} /> Only when idle
                </div>
                <div className="desc">Mines after {m.idleMinutes} min without keyboard or mouse input and pauses the moment you're back.</div>
              </div>
              <Toggle checked={m.onlyWhenIdle} onChange={(v) => setMining({ onlyWhenIdle: v })} label="Only when idle" />
            </div>
            {m.onlyWhenIdle && (
              <Field label="Start mining after">
                <Segmented
                  value={String(m.idleMinutes)}
                  options={[1, 3, 5, 10, 15, 30].map((n) => ({ value: String(n), label: `${n} min` }))}
                  onChange={(v) => setMining({ idleMinutes: Number(v) })}
                />
              </Field>
            )}
          </fieldset>
        </div>

        <div className="stack">
          {m.mode === 'pool' && (
            <div className="card">
              <div className="card-header">
                <h3>Pool balance</h3>
              </div>
              {poolBalance ? (
                <div className="kv">
                  <div className="k">Unpaid</div>
                  <div className="strong">{number(poolBalance.balance + poolBalance.unpaid, 4)} LBC</div>
                  <div className="k">Paid (24 h)</div>
                  <div>{number(poolBalance.paid24h, 4)} LBC</div>
                  <div className="k">Paid (total)</div>
                  <div>{number(poolBalance.total, 4)} LBC</div>
                  {poolBalance.hashrate ? (
                    <>
                      <div className="k">Pool sees</div>
                      <div>{formatHashrate(poolBalance.hashrate)}</div>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="muted small">{m.poolApi ? 'No data from the pool yet for this address.' : 'This pool has no balance API configured.'}</div>
              )}
              <div className="hint" style={{ marginTop: 10 }}>
                Pools pay out automatically once your balance passes their minimum (10 LBC at LBRYPool).
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-header">
              <h3>Log</h3>
            </div>
            <div className="logbox mono selectable" ref={logRef}>
              {log.length === 0 ? (
                <div className="l muted">Miner output will appear here.</div>
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
