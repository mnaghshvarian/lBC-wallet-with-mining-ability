import { ArrowDownLeft, ArrowUpRight, Gift, Pickaxe, Repeat, ShieldCheck, Unlock as UnlockIcon, FileText, Clock } from 'lucide-react';
import type { TxListItem } from '../../../shared/api';
import { relativeTime, txTitle, lbc, fiat } from '../lib/format';
import { useApp } from '../store';

export function txIcon(t: TxListItem) {
  switch (t.type) {
    case 'receive':
      return { cls: 'in', icon: <ArrowDownLeft size={18} /> };
    case 'send':
      return { cls: 'out', icon: <ArrowUpRight size={18} /> };
    case 'mining':
      return { cls: 'mine', icon: <Pickaxe size={18} /> };
    case 'tip-in':
    case 'tip-out':
    case 'support':
      return { cls: 'tip', icon: <Gift size={18} /> };
    case 'unlock':
      return { cls: 'in', icon: <UnlockIcon size={18} /> };
    case 'claim':
      return { cls: '', icon: <FileText size={18} /> };
    default:
      return { cls: '', icon: <Repeat size={18} /> };
  }
}

export function ConfirmationBadge({ t, maturity }: { t: TxListItem; maturity?: number }) {
  if (t.status === 'pending') {
    return (
      <span className="badge amber">
        <Clock size={11} /> Pending
      </span>
    );
  }
  if (t.type === 'mining' && maturity && t.confirmations < maturity) {
    return <span className="badge violet">Matures in {maturity - t.confirmations}</span>;
  }
  if (t.confirmations < 6) return <span className="badge blue">{t.confirmations} conf.</span>;
  return t.verified ? (
    <span className="badge green" title="Merkle proof checked against a proof-of-work header">
      <ShieldCheck size={11} /> Verified
    </span>
  ) : (
    <span className="badge green">Confirmed</span>
  );
}

export function TxRow({ t, onClick }: { t: TxListItem; onClick: () => void }) {
  const hide = useApp((s) => s.settings?.hideBalances ?? false);
  const price = useApp((s) => s.price);
  const { cls, icon } = txIcon(t);
  const amount = BigInt(t.amount);
  const f = fiat(amount < 0n ? -amount : amount, price);
  return (
    <div className="list-row" onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <div className={`tx-icon ${cls}`}>{icon}</div>
      <div className="tx-main">
        <div className="tx-title ellipsis">{t.label || txTitle(t.type, t.counterparty)}</div>
        <div className="tx-sub">
          <span>{relativeTime(t.time)}</span>
          <ConfirmationBadge t={t} maturity={100} />
        </div>
      </div>
      <div className="tx-amount">
        <div className={amount > 0n ? 'positive' : amount < 0n ? 'negative' : ''}>{hide ? '••••••' : `${lbc(t.amount, { sign: true })} LBC`}</div>
        {f && !hide && <div className="fiat">{f}</div>}
      </div>
    </div>
  );
}
