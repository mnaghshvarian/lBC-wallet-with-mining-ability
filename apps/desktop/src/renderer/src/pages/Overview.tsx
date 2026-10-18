import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Eye, EyeOff, Gift, Info, Pickaxe, RefreshCw } from 'lucide-react';
import { useApp } from '../store';
import { Badge, Button, Empty, IconButton } from '../components/ui';
import { Amount, FiatValue } from '../components/display';
import { TxRow } from '../components/TxRow';
import { UnlockSupportsModal } from '../components/UnlockSupportsModal';
import { formatHashrate, lbc, number } from '../lib/format';
import type { TxListItem } from '../../../shared/api';

export function Overview() {
  const overview = useApp((s) => s.overview)!;
  const settings = useApp((s) => s.settings)!;
  const version = useApp((s) => s.version);
  const miner = useApp((s) => s.miner);
  const price = useApp((s) => s.price);
  const navigate = useApp((s) => s.navigate);
  const updateSettings = useApp((s) => s.updateSettings);
  const [txs, setTxs] = useState<TxListItem[]>([]);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const b = overview.balance;

  useEffect(() => {
    let alive = true;
    void window.lbc.wallet.transactions().then((t) => alive && setTxs(t.slice(0, 6)));
    return () => {
      alive = false;
    };
  }, [version]);

  const syncing = overview.sync.state === 'syncing' || overview.sync.state === 'connecting';
  const mining = miner && miner.state !== 'stopped';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Overview</h1>
          <div className="sub">{overview.name}</div>
        </div>
        <div className="actions">
          {syncing && (
            <Badge tone="blue">
              <RefreshCw size={11} /> Syncing
            </Badge>
          )}
          {overview.watchOnly && <Badge tone="amber">Watch-only</Badge>}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <div className="card hero">
          <div className="balance-label">
            Total balance
            <IconButton label={settings.hideBalances ? 'Show balances' : 'Hide balances'} onClick={() => void updateSettings({ hideBalances: !settings.hideBalances })} style={{ width: 28, height: 28 }}>
              {settings.hideBalances ? <EyeOff size={15} /> : <Eye size={15} />}
            </IconButton>
          </div>
          <div className="balance-big selectable">
            {settings.hideBalances ? '••••••' : lbc(b.total, { decimals: 8 })}
            <span className="unit">LBC</span>
          </div>
          <div className="balance-fiat">
            <FiatValue dewies={b.total} />
            {price && !settings.hideBalances && <span className="muted small"> · 1 LBC = {price.currency === 'BTC' ? `${price.price.toFixed(8)} BTC` : `${price.price.toPrecision(3)} ${price.currency}`}</span>}
          </div>

          <div className="chips">
            <div className="chip">
              <div className="k">Available</div>
              <div className="v">
                <Amount dewies={b.available} />
              </div>
            </div>
            {BigInt(b.pending) > 0n && (
              <div className="chip">
                <div className="k">Incoming (unconfirmed)</div>
                <div className="v">
                  <Amount dewies={b.pending} />
                </div>
              </div>
            )}
            {BigInt(b.immature) > 0n && (
              <div className="chip">
                <div className="k" title="Block rewards can be spent after 100 confirmations">
                  Maturing mining rewards <Info size={12} />
                </div>
                <div className="v">
                  <Amount dewies={b.immature} />
                </div>
              </div>
            )}
            {BigInt(b.supports) > 0n && (
              <div className="chip">
                <div className="k" title="LBC locked in tips and supports. Unlock to make it spendable.">
                  Tips &amp; supports <Info size={12} />
                </div>
                <div className="v row between">
                  <Amount dewies={b.supports} />
                  {!overview.watchOnly && (
                    <Button size="sm" variant="ghost" onClick={() => setUnlockOpen(true)}>
                      Unlock
                    </Button>
                  )}
                </div>
              </div>
            )}
            {BigInt(b.claims) > 0n && (
              <div className="chip">
                <div className="k" title="Deposits backing your channels and published content. Manage them in Odysee or LBRY Desktop.">
                  In claims <Info size={12} />
                </div>
                <div className="v">
                  <Amount dewies={b.claims} />
                </div>
              </div>
            )}
          </div>

          <div className="row" style={{ marginTop: 20 }}>
            <Button variant="primary" onClick={() => navigate({ name: 'send' })} disabled={overview.watchOnly}>
              <ArrowUpRight size={16} /> Send
            </Button>
            <Button onClick={() => navigate({ name: 'receive' })}>
              <ArrowDownLeft size={16} /> Receive
            </Button>
            <Button onClick={() => navigate({ name: 'mining' })}>
              <Pickaxe size={16} /> Mine
            </Button>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-header">
              <h3>Mining</h3>
              <div className="spacer" />
              {mining ? <Badge tone="violet">Active</Badge> : <Badge>Idle</Badge>}
            </div>
            {mining ? (
              <div className="stack tight">
                <div className="hashrate-big" style={{ fontSize: 26 }}>
                  {formatHashrate(miner!.hashrate)}
                </div>
                <div className="small muted">
                  {miner!.mode === 'pool' ? `${miner!.accepted} shares accepted` : `${miner!.blocksFound} blocks found`} · {miner!.threads} threads
                </div>
              </div>
            ) : (
              <div className="small text-2">Put your CPU to work mining LBC — pool or solo.</div>
            )}
            <Button size="sm" block style={{ marginTop: 14 }} onClick={() => navigate({ name: 'mining' })}>
              Open mining
            </Button>
          </div>
          <div className="card">
            <h3>Network</h3>
            <div className="kv">
              <div className="k">Status</div>
              <div>{overview.backend.connected ? (syncing ? 'Syncing' : 'Synced') : 'Offline'}</div>
              <div className="k">Block height</div>
              <div>{overview.tipHeight ? number(overview.tipHeight) : '—'}</div>
              <div className="k">{overview.backend.kind === 'lbcd' ? 'Node' : 'Hub'}</div>
              <div className="ellipsis">{overview.backend.server ?? '—'}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <h3>Recent activity</h3>
          <div className="spacer" />
          <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'activity' })}>
            View all
          </Button>
        </div>
        {txs.length === 0 ? (
          <Empty icon={<Gift size={22} />} title={syncing ? 'Looking for transactions…' : 'No transactions yet'}>
            {syncing ? 'Your history appears here once the wallet has synced.' : 'Receive LBC or start mining to see activity here.'}
          </Empty>
        ) : (
          <div className="list">
            {txs.map((t) => (
              <TxRow key={t.txid} t={t} onClick={() => navigate({ name: 'activity', txid: t.txid })} />
            ))}
          </div>
        )}
      </div>

      {unlockOpen && <UnlockSupportsModal onClose={() => setUnlockOpen(false)} />}
    </>
  );
}

