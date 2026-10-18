import { useEffect, useMemo, useState } from 'react';
import { Download, ExternalLink, ListX, Search } from 'lucide-react';
import { useApp, errorMessage } from '../store';
import { Badge, Button, CopyButton, Drawer, Empty, Field, Segmented } from '../components/ui';
import { AddressText } from '../components/display';
import { ConfirmationBadge, TxRow } from '../components/TxRow';
import { dateTime, lbc, number, txTitle } from '../lib/format';
import type { TxDetailView, TxListItem } from '../../../shared/api';

type Filter = 'all' | 'in' | 'out' | 'mining' | 'tips';

function matches(t: TxListItem, f: Filter): boolean {
  switch (f) {
    case 'all':
      return true;
    case 'in':
      return t.type === 'receive' || t.type === 'unlock';
    case 'out':
      return t.type === 'send' || t.type === 'tip-out';
    case 'mining':
      return t.type === 'mining';
    case 'tips':
      return t.type === 'tip-in' || t.type === 'tip-out' || t.type === 'support' || t.type === 'unlock' || t.type === 'claim';
  }
}

export function ActivityPage({ openTxid }: { openTxid?: string }) {
  const version = useApp((s) => s.version);
  const toast = useApp((s) => s.toast);
  const [txs, setTxs] = useState<TxListItem[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(openTxid ?? null);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    let alive = true;
    void window.lbc.wallet.transactions().then((t) => alive && setTxs(t));
    return () => {
      alive = false;
    };
  }, [version]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (txs ?? []).filter((t) => matches(t, filter)).filter((t) => !q || t.txid.includes(q) || (t.counterparty ?? '').toLowerCase().includes(q) || (t.label ?? '').toLowerCase().includes(q));
  }, [txs, filter, query]);

  const exportCsv = async () => {
    try {
      const r = await window.lbc.wallet.exportCsv();
      if (r.saved) toast({ kind: 'confirmed', title: 'Exported', message: r.path });
    } catch (err) {
      toast({ kind: 'error', title: 'Export failed', message: errorMessage(err) });
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Activity</h1>
          <div className="sub">{txs ? `${number(txs.length)} transactions` : 'Loading…'}</div>
        </div>
        <div className="actions">
          <Button size="sm" onClick={() => void exportCsv()} disabled={!txs?.length}>
            <Download size={15} /> Export CSV
          </Button>
        </div>
      </div>

      <div className="card">
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <Segmented
            value={filter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'in', label: 'Received' },
              { value: 'out', label: 'Sent' },
              { value: 'mining', label: 'Mining' },
              { value: 'tips', label: 'Tips & claims' },
            ]}
            onChange={setFilter}
          />
          <div className="spacer" />
          <div className="input-wrap" style={{ width: 280 }}>
            <Search size={15} style={{ position: 'absolute', left: 12, color: 'var(--text-3)' }} />
            <input className="input" style={{ paddingLeft: 34, height: 36 }} placeholder="Search txid, address or note" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        {txs && shown.length === 0 ? (
          <Empty icon={<ListX size={22} />} title="Nothing here">
            {txs.length === 0 ? 'Transactions will appear once you receive or mine LBC.' : 'No transactions match this filter.'}
          </Empty>
        ) : (
          <div className="list">
            {shown.slice(0, limit).map((t) => (
              <TxRow key={t.txid} t={t} onClick={() => setSelected(t.txid)} />
            ))}
          </div>
        )}
        {shown.length > limit && (
          <div className="center" style={{ marginTop: 10 }}>
            <Button size="sm" onClick={() => setLimit(limit + 200)}>
              Show more
            </Button>
          </div>
        )}
      </div>

      {selected && <TxDrawer txid={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function TxDrawer({ txid, onClose }: { txid: string; onClose: () => void }) {
  const version = useApp((s) => s.version);
  const [tx, setTx] = useState<TxDetailView | null | undefined>(undefined);
  const [label, setLabel] = useState('');

  useEffect(() => {
    let alive = true;
    void window.lbc.wallet.transaction(txid).then((t) => {
      if (!alive) return;
      setTx(t);
      setLabel(t?.label ?? '');
    });
    return () => {
      alive = false;
    };
  }, [txid, version]);

  if (tx === undefined) return null;
  if (tx === null) {
    return (
      <Drawer title="Transaction" onClose={onClose}>
        <div className="muted">Transaction not found in this wallet.</div>
      </Drawer>
    );
  }
  const amount = BigInt(tx.amount);
  return (
    <Drawer title={txTitle(tx.type, tx.counterparty)} onClose={onClose}>
      <div className="stack">
        <div>
          <div className={`balance-big ${amount > 0n ? 'positive' : amount < 0n ? 'negative' : ''}`} style={{ fontSize: 30 }}>
            {lbc(tx.amount, { sign: true })}
            <span className="unit">LBC</span>
          </div>
          <div className="row">
            <ConfirmationBadge t={tx} maturity={100} />
            {tx.verified === false && <Badge tone="red">Verification failed</Badge>}
          </div>
        </div>

        <div className="kv">
          <div className="k">Date</div>
          <div>{dateTime(tx.time)}</div>
          <div className="k">Status</div>
          <div>{tx.status === 'pending' ? 'Waiting for confirmation' : `${number(tx.confirmations)} confirmations`}</div>
          {tx.height > 0 && (
            <>
              <div className="k">Block</div>
              <div>#{number(tx.height)}</div>
            </>
          )}
          {tx.fee !== null && (
            <>
              <div className="k">Fee</div>
              <div>{lbc(tx.fee)} LBC</div>
            </>
          )}
          <div className="k">Size</div>
          <div>{number(tx.size)} bytes</div>
          <div className="k">Transaction ID</div>
          <div className="mono small break selectable">{tx.txid}</div>
        </div>

        <div className="row">
          <CopyButton text={tx.txid} label="Copy ID" />
          {tx.explorerUrl && (
            <Button size="sm" onClick={() => void window.lbc.app.openExternal(tx.explorerUrl!)}>
              <ExternalLink size={15} /> Explorer
            </Button>
          )}
        </div>

        <Field label="Note">
          <input className="input" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} onBlur={() => void window.lbc.wallet.setLabel(tx.txid, label)} placeholder="Add a private note" />
        </Field>

        <div>
          <div className="label" style={{ marginBottom: 8 }}>
            Inputs ({tx.inputs.length || 'coinbase'})
          </div>
          {tx.inputs.length === 0 && <div className="small muted">Newly minted coins (block reward)</div>}
          <div className="stack tight">
            {tx.inputs.map((i) => (
              <div key={`${i.txid}:${i.vout}`} className="row between small">
                <span className="ellipsis">{i.address ? <AddressText address={i.address} short /> : <span className="mono muted">{i.txid.slice(0, 12)}…:{i.vout}</span>}</span>
                <span className="row">
                  {i.mine && <Badge tone="green">yours</Badge>}
                  <span className="nowrap">{i.value !== null ? `${lbc(i.value)} LBC` : '—'}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="label" style={{ marginBottom: 8 }}>
            Outputs ({tx.outputs.length})
          </div>
          <div className="stack tight">
            {tx.outputs.map((o) => (
              <div key={o.vout} className="row between small">
                <span className="ellipsis">
                  {o.address ? <AddressText address={o.address} short /> : <span className="muted">Data output</span>}
                  {o.kind !== 'standard' && o.kind !== 'other' && (
                    <span style={{ marginLeft: 6 }}>
                      <Badge tone="amber">{o.kind}{o.claimName ? `: ${o.claimName}` : ''}</Badge>
                    </span>
                  )}
                </span>
                <span className="row">
                  {o.mine && <Badge tone={o.change ? 'blue' : 'green'}>{o.change ? 'change' : 'yours'}</Badge>}
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
