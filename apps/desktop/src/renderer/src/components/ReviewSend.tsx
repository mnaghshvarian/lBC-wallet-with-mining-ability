import { useState } from 'react';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import type { DraftView } from '../../../shared/api';
import { useApp, errorMessage } from '../store';
import { Button, Callout, CopyButton, Field, Modal, PasswordInput } from './ui';
import { AddressText, FiatValue } from './display';
import { lbc } from '../lib/format';

/** Review a prepared transaction, confirm with the password and broadcast it. */
export function ReviewSend({ draft, label, title, onClose, onSent }: { draft: DraftView; label?: string; title?: string; onClose: () => void; onSent?: (txid: string) => void }) {
  const settings = useApp((s) => s.settings)!;
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [txid, setTxid] = useState<string | null>(null);
  const needPassword = settings.requirePasswordToSend;

  const send = async () => {
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
      <Modal title="Transaction sent" onClose={onClose} icon={<CheckCircle2 size={22} color="var(--positive)" />} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <div className="stack">
          <div className="text-2">Your transaction was broadcast to the LBRY network. It usually confirms within a few minutes.</div>
          <Field label="Transaction ID">
            <div className="address-box mono selectable" style={{ fontSize: 13 }}>
              {txid}
            </div>
          </Field>
          <div className="row">
            <CopyButton text={txid} label="Copy ID" />
            {explorer && (
              <Button size="sm" onClick={() => void window.lbc.app.openExternal(explorer)}>
                <ExternalLink size={15} /> View in explorer
              </Button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  const isUnlock = draft.kind === 'unlock-supports';
  return (
    <Modal
      title={title ?? (isUnlock ? 'Unlock tips & supports' : 'Review payment')}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={needPassword && !password} onClick={() => void send()}>
            {isUnlock ? 'Unlock' : 'Send'} {lbc(isUnlock ? draft.recipients[0]!.value : draft.recipients[0]!.value)} LBC
          </Button>
        </>
      }
    >
      <div className="stack">
        {isUnlock ? (
          <div className="text-2">
            {draft.inputCount} tip/support output{draft.inputCount > 1 ? 's' : ''} will be returned to your spendable balance. This abandons those supports on LBRY (content you tipped loses that boost).
          </div>
        ) : (
          <div>
            <div className="label" style={{ marginBottom: 6 }}>
              To
            </div>
            <div className="address-box">
              <AddressText address={draft.recipients[0]!.address} />
            </div>
          </div>
        )}
        <div className="kv">
          <div className="k">{isUnlock ? 'You receive' : 'Amount'}</div>
          <div className="strong">
            {lbc(draft.recipients[0]!.value)} LBC <span className="muted small"><FiatValue dewies={draft.recipients[0]!.value} /></span>
          </div>
          <div className="k">Network fee</div>
          <div>
            {lbc(draft.fee)} LBC <span className="muted small">({draft.feePerByte} dewies/byte · {draft.size} bytes)</span>
          </div>
          {!isUnlock && (
            <>
              <div className="k">Total</div>
              <div className="strong">
                {lbc(draft.total)} LBC <span className="muted small"><FiatValue dewies={draft.total} /></span>
              </div>
            </>
          )}
          {BigInt(draft.change) > 0n && (
            <>
              <div className="k">Change</div>
              <div className="muted">{lbc(draft.change)} LBC returns to your wallet</div>
            </>
          )}
        </div>
        {needPassword && (
          <Field label="Wallet password" error={error || undefined}>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && password && void send()} autoFocus invalid={!!error} />
          </Field>
        )}
        {!needPassword && error && <Callout tone="danger">{error}</Callout>}
        {!isUnlock && <div className="hint">Double-check the address: LBC transactions cannot be reversed.</div>}
      </div>
    </Modal>
  );
}
