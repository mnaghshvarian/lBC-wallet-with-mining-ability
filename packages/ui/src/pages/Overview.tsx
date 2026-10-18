import { useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Eye, EyeOff, Gift, Info, Pickaxe, RefreshCw } from 'lucide-react';
import { useApp, useT } from '../store';
import { Badge, Button, Empty, IconButton } from '../components/ui';
import { Amount, FiatValue } from '../components/display';
import { TxRow } from '../components/TxRow';
import { UnlockSupportsModal } from '../components/UnlockSupportsModal';
import { formatHashrate, lbc, number } from '../lib/format';
import type { TxListItem } from '@lbcwallet/services/api';

export function Overview() {
  const t = useT();
  const info = useApp((s) => s.info);
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
    void window.lbc.wallet.transactions().then((list) => alive && setTxs(list.slice(0, 6)));
    return () => {
      alive = false;
    };
  }, [version]);

  const syncing = overview.sync.state === 'syncing' || overview.sync.state === 'connecting';
  const mining = miner && miner.state !== 'stopped';
  const canMine = !!info?.capabilities.mining;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t('nav.overview')}</h1>
          <div className="sub">{overview.name}</div>
        </div>
        <div className="actions">
          {syncing && (
            <Badge tone="blue">
              <RefreshCw size={11} /> {t('overview.syncing')}
            </Badge>
          )}
          {overview.watchOnly && <Badge tone="amber">{t('walletKind.watch')}</Badge>}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
        <div className="card hero">
          <div className="balance-label">
            {t('overview.total')}
            <IconButton label={settings.hideBalances ? t('overview.showBalances') : t('overview.hideBalances')} onClick={() => void updateSettings({ hideBalances: !settings.hideBalances })} style={{ width: 28, height: 28 }}>
              {settings.hideBalances ? <EyeOff size={15} /> : <Eye size={15} />}
            </IconButton>
          </div>
          <div className="balance-big selectable">
            <bdi dir="ltr">{settings.hideBalances ? '••••••' : lbc(b.total, { decimals: 8 })}</bdi>
            <span className="unit">LBC</span>
          </div>
          <div className="balance-fiat">
            <FiatValue dewies={b.total} />
            {price && !settings.hideBalances && <span className="muted small"> · {t('overview.rate', { price: price.currency === 'BTC' ? `${price.price.toFixed(8)} BTC` : `${price.price.toPrecision(3)} ${price.currency}` })}</span>}
          </div>

          <div className="chips">
            <div className="chip">
              <div className="k">{t('overview.available')}</div>
              <div className="v">
                <Amount dewies={b.available} />
              </div>
            </div>
            {BigInt(b.pending) > 0n && (
              <div className="chip">
                <div className="k">{t('overview.incoming')}</div>
                <div className="v">
                  <Amount dewies={b.pending} />
                </div>
              </div>
            )}
            {BigInt(b.immature) > 0n && (
              <div className="chip">
                <div className="k" title={t('overview.maturingHint')}>
                  {t('overview.maturing')} <Info size={12} />
                </div>
                <div className="v">
                  <Amount dewies={b.immature} />
                </div>
              </div>
            )}
            {BigInt(b.supports) > 0n && (
              <div className="chip">
                <div className="k" title={t('overview.supportsHint')}>
                  {t('overview.supports')} <Info size={12} />
                </div>
                <div className="v row between">
                  <Amount dewies={b.supports} />
                  {!overview.watchOnly && (
                    <Button size="sm" variant="ghost" onClick={() => setUnlockOpen(true)}>
                      {t('overview.unlock')}
                    </Button>
                  )}
                </div>
              </div>
            )}
            {BigInt(b.claims) > 0n && (
              <div className="chip">
                <div className="k" title={t('overview.claimsHint')}>
                  {t('overview.claims')} <Info size={12} />
                </div>
                <div className="v">
                  <Amount dewies={b.claims} />
                </div>
              </div>
            )}
          </div>

          <div className="row" style={{ marginTop: 20 }}>
            <Button variant="primary" onClick={() => navigate({ name: 'send' })} disabled={overview.watchOnly}>
              <ArrowUpRight size={16} /> {t('nav.send')}
            </Button>
            <Button onClick={() => navigate({ name: 'receive' })}>
              <ArrowDownLeft size={16} /> {t('nav.receive')}
            </Button>
            {canMine && (
              <Button onClick={() => navigate({ name: 'mining' })}>
                <Pickaxe size={16} /> {t('overview.mine')}
              </Button>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-header">
              <h3>{t('nav.mining')}</h3>
              <div className="spacer" />
              {canMine && (mining ? <Badge tone="violet">{t('overview.active')}</Badge> : <Badge>{t('overview.idle')}</Badge>)}
            </div>
            {mining ? (
              <div className="stack tight">
                <div className="hashrate-big" style={{ fontSize: 26 }}>
                  {formatHashrate(miner!.hashrate)}
                </div>
                <div className="small muted">
                  {miner!.mode === 'pool' ? t('overview.sharesAccepted', { count: miner!.accepted }) : t('overview.blocksFound', { count: miner!.blocksFound })} · {t('overview.threads', { count: miner!.threads })}
                </div>
              </div>
            ) : (
              <div className="small text-2">{canMine ? t('overview.mineInvite') : t('overview.mineMobile')}</div>
            )}
            <Button size="sm" block style={{ marginTop: 14 }} onClick={() => navigate({ name: 'mining' })}>
              {canMine ? t('overview.openMining') : t('overview.openPoolStats')}
            </Button>
          </div>
          <div className="card">
            <h3>{t('overview.network')}</h3>
            <div className="kv">
              <div className="k">{t('overview.status')}</div>
              <div>{overview.backend.connected ? (syncing ? t('overview.syncing') : t('overview.synced')) : t('overview.offline')}</div>
              <div className="k">{t('overview.height')}</div>
              <div>{overview.tipHeight ? number(overview.tipHeight) : '—'}</div>
              <div className="k">{overview.backend.kind === 'lbcd' ? t('overview.node') : t('overview.hub')}</div>
              <div className="ellipsis">{overview.backend.kind === 'lbcd' && overview.backend.server?.startsWith('127.0.0.1') ? t('net.yourNode') : (overview.backend.server ?? '—')}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <h3>{t('overview.recent')}</h3>
          <div className="spacer" />
          <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'activity' })}>
            {t('overview.viewAll')}
          </Button>
        </div>
        {txs.length === 0 ? (
          <Empty icon={<Gift size={22} />} title={syncing ? t('overview.looking') : t('overview.noTx')}>
            {syncing ? t('overview.lookingText') : canMine ? t('overview.noTxText') : t('overview.noTxTextMobile')}
          </Empty>
        ) : (
          <div className="list">
            {txs.map((tx) => (
              <TxRow key={tx.txid} t={tx} onClick={() => navigate({ name: 'activity', txid: tx.txid })} />
            ))}
          </div>
        )}
      </div>

      {unlockOpen && <UnlockSupportsModal onClose={() => setUnlockOpen(false)} />}
    </>
  );
}

