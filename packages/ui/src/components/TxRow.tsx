import { ArrowDownLeft, ArrowUpRight, Gift, Pickaxe, Repeat, ShieldCheck, Unlock as UnlockIcon, FileText, Clock } from 'lucide-react';
import type { TxListItem } from '@lbcwallet/services/api';
import { relativeTime, txTitle, lbc, fiat } from '../lib/format';
import { useApp, useT } from '../store';

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

export function ConfirmationBadge({ t: tx, maturity }: { t: TxListItem; maturity?: number }) {
  const t = useT();
  if (tx.status === 'pending') {
    return (
      <span className="badge amber">
        <Clock size={11} /> {t('badge.pending')}
      </span>
    );
  }
  if (tx.type === 'mining' && maturity && tx.confirmations < maturity) {
    return <span className="badge violet">{t('badge.maturesIn', { count: maturity - tx.confirmations })}</span>;
  }
  if (tx.confirmations < 6) return <span className="badge blue">{t('badge.confirmations', { count: tx.confirmations })}</span>;
  return tx.verified ? (
    <span className="badge green" title={t('badge.verifiedHint')}>
      <ShieldCheck size={11} /> {t('badge.verified')}
    </span>
  ) : (
    <span className="badge green">{t('badge.confirmed')}</span>
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
        <div className={amount > 0n ? 'positive' : amount < 0n ? 'negative' : ''}>{hide ? '••••••' : <><bdi dir="ltr">{lbc(t.amount, { sign: true })}</bdi> LBC</>}</div>
        {f && !hide && <div className="fiat">{f}</div>}
      </div>
    </div>
  );
}
