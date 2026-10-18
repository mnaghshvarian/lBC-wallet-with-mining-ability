import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, ListX, Search } from 'lucide-react';
import { useApp, useT, errorMessage } from '../store';
import { Badge, Button, CopyButton, Drawer, Empty, Field, Segmented } from '../components/ui';
import { AddressText } from '../components/display';
import { ConfirmationBadge, TxRow } from '../components/TxRow';
import { dateTime, lbc, number, txTitle } from '../lib/format';
import type { TxDetailView, TxListItem } from '@lbcwallet/services/api';

type Filter = 'all' | 'in' | 'out' | 'mining' | 'tips';

function matches(tx: TxListItem, f: Filter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'in':
      return tx.type === 'receive' || tx.type === 'unlock';
    case 'out':
      return tx.type === 'send' || tx.type === 'tip-out';
    case 'mining':
      return tx.type === 'mining';
    case 'tips':
      return tx.type === 'tip-in' || tx.type === 'tip-out' || tx.type === 'support' || tx.type === 'unlock' || tx.type === 'claim';
  }
}

export function ActivityPage({ openTxid }: { openTxid?: string }) {
  const t = useT();
  const version = useApp((s) => s.version);
  const toast = useApp((s) => s.toast);
  const [txs, setTxs] = useState<TxListItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(openTxid ?? null);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    let alive = true;
    void window.lbc.wallet.transactions().then((list) => alive && setTxs(list));
    return () => {
      alive = false;
    };
  }, [version]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (txs ?? []).filter((tx) => matches(tx, filter)).filter((tx) => !q || tx.txid.includes(q) || (tx.counterparty ?? '').toLowerCase().includes(q) || (tx.label ?? '').toLowerCase().includes(q));
  }, [txs, filter, query]);

  const exportCsv = async () => {
    try {
      const r = await window.lbc.wallet.exportCsv();
      if (r.saved) toast({ kind: 'confirmed', title: t('activity.exported'), message: r.path });
    } catch (err) {
      toast({ kind: 'error', title: t('activity.exportFailed'), message: errorMessage(err) });
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t('nav.activity')}</h1>
          <div className="sub">{txs ? t('activity.count', { count: txs.length, n: number(txs.length) }) : t('common.loading')}</div>
        </div>
        <div className="actions">
          <Button size="sm" onClick={() => void exportCsv()} disabled={!txs?.length}>
            <Download size={15} /> {t('activity.export')}
          </Button>
        </div>
      </div>

      <div className="card">
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <Segmented
            value={filter}
            options={[
              { value: 'all', label: t('activity.all') },
              { value: 'in', label: t('tx.receive') },
              { value: 'out', label: t('tx.send') },
              { value: 'mining', label: t('nav.mining') },
              { value: 'tips', label: t('activity.tips') },
            ]}
            onChange={setFilter}
          />
          <div className="spacer" />
          <div className="input-wrap search-box">
            <Search size={15} className="search-icon" />
            <input className="input" style={{ paddingInlineStart: 34, height: 36 }} placeholder={t('activity.search')} aria-label={t('activity.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        {txs && shown.length === 0 ? (
          <Empty icon={<ListX size={22} />} title={t('activity.nothing')}>
            {txs.length === 0 ? t('activity.nothingYet') : t('activity.noMatch')}
          </Empty>
        ) : (
          <div className="list">
            {shown.slice(0, limit).map((tx) => (
              <TxRow key={tx.txid} t={tx} onClick={() => setSelected(tx.txid)} />
            ))}
          </div>
        )}
        {shown.length > limit && (
          <div className="center" style={{ marginTop: 10 }}>
            <Button size="sm" onClick={() => setLimit(limit + 200)}>
              {t('activity.showMore')}
            </Button>
          </div>
        )}
      </div>

      {selected && <TxDrawer txid={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function TxDrawer({ txid, onClose }: { txid: string; onClose: () => void }) {
  const t = useT();
  const version = useApp((s) => s.version);
  const [tx, setTx] = useState<TxDetailView | null | undefined>(undefined);
  const [label, setLabel] = useState('');

  useEffect(() => {
    let alive = true;
    void window.lbc.wallet.transaction(txid).then((detail) => {
      if (!alive) return;
      setTx(detail);
      setLabel(detail?.label ?? '');
    });
    return () => {
      alive = false;
    };
  }, [txid, version]);

  if (tx === undefined) return null;
  if (tx === null) {
    return (
      <Drawer title={t('activity.transaction')} onClose={onClose}>
        <div className="muted">{t('activity.notFound')}</div>
      </Drawer>
    );
  }
  const amount = BigInt(tx.amount);
  return (
    <Drawer title={txTitle(tx.type, tx.counterparty)} onClose={onClose}>
      <div className="stack">
        <div>
          <div className={`balance-big ${amount > 0n ? 'positive' : amount < 0n ? 'negative' : ''}`} style={{ fontSize: 30 }}>
            <bdi dir="ltr">{lbc(tx.amount, { sign: true })}</bdi>
            <span className="unit">LBC</span>
          </div>
          <div className="row">
            <ConfirmationBadge t={tx} maturity={100} />
            {tx.verified === false && <Badge tone="red">{t('activity.verifyFailed')}</Badge>}
          </div>
        </div>

        <div className="kv">
          <div className="k">{t('activity.date')}</div>
          <div>{dateTime(tx.time)}</div>
          <div className="k">{t('overview.status')}</div>
          <div>{tx.status === 'pending' ? t('activity.waiting') : t('activity.confirmations', { count: tx.confirmations, n: number(tx.confirmations) })}</div>
          {tx.status !== 'pending' && (
            <>
              <div className="k">{t('activity.proof')}</div>
              <div>{tx.verified === true ? t('activity.proofOk') : tx.verified === false ? t('activity.proofBad') : t('activity.proofPending')}</div>
            </>
          )}
          {tx.height > 0 && (
            <>
              <div className="k">{t('activity.block')}</div>
              <div>#{number(tx.height)}</div>
            </>
          )}
          {tx.fee !== null && (
            <>
              <div className="k">{t('send.fee')}</div>
              <div>{lbc(tx.fee)} LBC</div>
            </>
          )}
          <div className="k">{t('activity.size')}</div>
          <div>{t('activity.bytes', { count: tx.size, n: number(tx.size) })}</div>
          <div className="k">{t('review.txid')}</div>
          <div className="mono small break selectable">{tx.txid}</div>
        </div>

        <div className="row">
          <CopyButton text={tx.txid} label={t('review.copyId')} />
          {tx.explorerUrl && (
            <Button size="sm" onClick={() => void window.lbc.app.openExternal(tx.explorerUrl!)}>
              <ExternalLink size={15} /> {t('activity.explorer')}
            </Button>
          )}
        </div>

        <Field label={t('activity.note')}>
          <input className="input" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} onBlur={() => void window.lbc.wallet.setLabel(tx.txid, label)} placeholder={t('activity.notePlaceholder')} />
        </Field>

        <div>
          <div className="label" style={{ marginBottom: 8 }}>
            {tx.inputs.length ? t('activity.inputs', { count: tx.inputs.length }) : t('activity.inputsCoinbase')}
          </div>
          {tx.inputs.length === 0 && <div className="small muted">{t('activity.coinbase')}</div>}
          <div className="stack tight">
            {tx.inputs.map((i) => (
              <div key={`${i.txid}:${i.vout}`} className="row between small">
                <span className="ellipsis">{i.address ? <AddressText address={i.address} short /> : <span className="mono muted">{i.txid.slice(0, 12)}…:{i.vout}</span>}</span>
                <span className="row">
                  {i.mine && <Badge tone="green">{t('activity.yours')}</Badge>}
                  <span className="nowrap">{i.value !== null ? `${lbc(i.value)} LBC` : '—'}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="label" style={{ marginBottom: 8 }}>
            {t('activity.outputs', { count: tx.outputs.length })}
          </div>
          <div className="stack tight">
            {tx.outputs.map((o) => (
              <div key={o.vout} className="row between small">
                <span className="ellipsis">
                  {o.address ? <AddressText address={o.address} short /> : <span className="muted">{t('activity.dataOutput')}</span>}
                  {o.kind !== 'standard' && o.kind !== 'other' && (
                    <span style={{ marginInlineStart: 6 }}>
                      <Badge tone="amber">
                        {t(`activity.outputKind.${o.kind}`)}
                        {o.claimName ? `: ${o.claimName}` : ''}
                      </Badge>
                    </span>
                  )}
                </span>
                <span className="row">
                  {o.mine && <Badge tone={o.change ? 'blue' : 'green'}>{o.change ? t('activity.changeBadge') : t('activity.yours')}</Badge>}
                  <span className="nowrap">{lbc(o.value)} LBC</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
