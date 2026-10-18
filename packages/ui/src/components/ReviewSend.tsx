import { useState } from 'react';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import type { DraftView } from '@lbcwallet/services/api';
import { useApp, useT, errorMessage } from '../store';
import { Button, Callout, CopyButton, Field, Modal, PasswordInput } from './ui';
import { AddressText, FiatValue } from './display';
import { lbc } from '../lib/format';

/** Review a prepared transaction, confirm with the password and broadcast it. */
export function ReviewSend({ draft, label, title, onClose, onSent }: { draft: DraftView; label?: string; title?: string; onClose: () => void; onSent?: (txid: string) => void }) {
  const t = useT();
  const settings = useApp((s) => s.settings)!;
  const overview = useApp((s) => s.overview);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [txid, setTxid] = useState<string | null>(null);
  // The keys stay in memory only when the wallet was opened with the setting off; otherwise sending needs the password, whatever the setting says now.
  const needPassword = settings.requirePasswordToSend || !overview?.keysInMemory;

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await window.lbc.wallet.send({ draftId: draft.id, password: needPassword ? password : undefined, label });
      setPassword('');
      setTxid(r.txid);
      onSent?.(r.txid);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (txid) {
    const explorer = settings.network === 'mainnet' && settings.explorerTxUrl ? settings.explorerTxUrl.replace('{txid}', txid) : null;
    return (
      <Modal
        title={t('review.sentTitle')}
        onClose={onClose}
        icon={<CheckCircle2 size={22} color="var(--positive)" />}
        footer={
          <Button variant="primary" onClick={onClose}>
            {t('common.done')}
          </Button>
        }
      >
        <div className="stack">
          <div className="text-2">{t('review.sentText')}</div>
          <Field label={t('review.txid')}>
            <div className="address-box mono selectable" style={{ fontSize: 13 }}>
              {txid}
            </div>
          </Field>
          <div className="row">
            <CopyButton text={txid} label={t('review.copyId')} />
            {explorer && (
              <Button size="sm" onClick={() => void window.lbc.app.openExternal(explorer)}>
                <ExternalLink size={15} /> {t('review.viewInExplorer')}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  const isUnlock = draft.kind === 'unlock-supports';
  const amount = lbc(draft.recipients[0]!.value);
  return (
    <Modal
      title={title ?? (isUnlock ? t('unlock.title') : t('review.title'))}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={needPassword && !password} onClick={() => void send()}>
            {isUnlock ? t('review.unlockButton', { amount }) : t('review.sendButton', { amount })}
          </Button>
        </>
      }
    >
      <div className="stack">
        {isUnlock ? (
          <div className="text-2">{t('unlock.explain', { count: draft.inputCount })}</div>
        ) : (
          <div>
            <div className="label" style={{ marginBottom: 6 }}>
              {t('review.to')}
            </div>
            <div className="address-box">
              <AddressText address={draft.recipients[0]!.address} />
            </div>
          </div>
        )}
        <div className="kv">
          <div className="k">{isUnlock ? t('review.youReceive') : t('review.amount')}</div>
          <div className="strong">
            {amount} LBC{' '}
            <span className="muted small">
              <FiatValue dewies={draft.recipients[0]!.value} />
            </span>
          </div>
          <div className="k">{t('review.fee')}</div>
          <div>
            {lbc(draft.fee)} LBC <span className="muted small">{t('review.feeDetail', { rate: draft.feePerByte, size: draft.size })}</span>
          </div>
          {!isUnlock && (
            <>
              <div className="k">{t('review.total')}</div>
              <div className="strong">
                {lbc(draft.total)} LBC{' '}
                <span className="muted small">
                  <FiatValue dewies={draft.total} />
                </span>
              </div>
            </>
          )}
          {BigInt(draft.change) > 0n && (
            <>
              <div className="k">{t('review.change')}</div>
              <div className="muted">{t('review.changeDetail', { amount: lbc(draft.change) })}</div>
            </>
          )}
        </div>
        {needPassword && (
          <Field label={t('common.walletPassword')} error={error || undefined}>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && password && void send()} autoFocus invalid={!!error} disabled={busy} />
          </Field>
        )}
        {!needPassword && error && <Callout tone="danger">{error}</Callout>}
        {!isUnlock && <div className="hint">{t('review.irreversible')}</div>}
      </div>
    </Modal>
  );
}
