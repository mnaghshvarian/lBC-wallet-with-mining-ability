import { useEffect, useMemo, useState } from 'react';
import { BookUser, CheckCircle2, ClipboardPaste, SlidersHorizontal } from 'lucide-react';
import { useApp, errorMessage } from '../store';
import { Button, Callout, Field, IconButton, Modal } from '../components/ui';
import { Amount } from '../components/display';
import { ReviewSend } from '../components/ReviewSend';
import { formatFiat, parseLbc, shortAddress, lbc } from '../lib/format';
import type { Contact, DraftView } from '../../../shared/api';

export function Send({ initialTo }: { initialTo?: string }) {
  const overview = useApp((s) => s.overview)!;
  const settings = useApp((s) => s.settings)!;
  const price = useApp((s) => s.price);
  const [to, setTo] = useState(initialTo ?? '');
  const [amount, setAmount] = useState('');
  const [max, setMax] = useState(false);
  const [label, setLabel] = useState('');
  const [feeRate, setFeeRate] = useState(settings.feePerByte);
  const [showFee, setShowFee] = useState(false);
  const [addrState, setAddrState] = useState<{ valid: boolean; error?: string; mine?: boolean } | null>(null);
  const [preview, setPreview] = useState<DraftView | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [review, setReview] = useState<DraftView | null>(null);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.lbc.wallet.contacts().then(setContacts);
  }, []);

  // Validate the address as the user types.
  useEffect(() => {
    const value = to.trim();
    if (!value) return setAddrState(null);
    let alive = true;
    const t = setTimeout(() => void window.lbc.wallet.validateAddress(value).then((r) => alive && setAddrState(r)), 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [to]);

  const amountKey = max ? '\u0000max' : amount;
  const parsed = useMemo(() => {
    if (max) return { ok: true as const, dewies: 'max' as const };
    if (!amount.trim()) return null;
    try {
      const v = parseLbc(amount);
      if (v <= 0n) return { ok: false as const, error: 'Enter an amount greater than zero' };
      return { ok: true as const, dewies: v.toString() };
    } catch (err) {
      return { ok: false as const, error: errorMessage(err) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountKey]);

  // Live fee preview.
  useEffect(() => {
    setPreview(null);
    setPreviewError('');
    if (!addrState?.valid || !parsed?.ok) return;
    let alive = true;
    const t = setTimeout(() => {
      window.lbc.wallet
        .prepareSend({ address: to.trim(), amount: parsed.dewies, feePerByte: feeRate })
        .then((d) => {
          if (!alive) return;
          setPreview(d);
          if (max) setAmount(lbc(d.recipients[0]!.value).replace(/,/g, ''));
        })
        .catch((err) => alive && setPreviewError(errorMessage(err)));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [addrState, parsed, feeRate, to, max, overview.balance.available]);

  const fiatEquivalent = useMemo(() => {
    if (!price || !parsed?.ok || parsed.dewies === 'max') return null;
    return formatFiat((Number(parsed.dewies) / 1e8) * price.price, price.currency);
  }, [parsed, price]);

  const canReview = !!addrState?.valid && !!parsed?.ok && !!preview && !previewError;

  const openReview = async () => {
    setBusy(true);
    try {
      const d = await window.lbc.wallet.prepareSend({ address: to.trim(), amount: parsed!.ok ? (parsed as { dewies: string }).dewies : '0', feePerByte: feeRate });
      setReview(d);
    } catch (err) {
      setPreviewError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setTo('');
    setAmount('');
    setMax(false);
    setLabel('');
    setPreview(null);
  };

  if (overview.watchOnly) {
    return (
      <>
        <div className="page-header">
          <h1>Send</h1>
        </div>
        <Callout tone="warn" title="Watch-only wallet">
          This wallet only has the public key, so it can't sign transactions. Restore it from its recovery phrase or xprv to send.
        </Callout>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Send LBC</h1>
          <div className="sub">
            Available: <Amount dewies={overview.balance.available} />
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
        <div className="card stack">
          <Field
            label="Recipient address"
            error={addrState && !addrState.valid ? addrState.error : undefined}
            hint={addrState?.valid ? (addrState.mine ? 'This is one of your own addresses.' : undefined) : 'An LBC address starts with “b” (or “r”).'}
          >
            <div className="input-wrap">
              <input
                className={`input mono ${addrState && !addrState.valid ? 'invalid' : ''}`}
                style={{ paddingRight: 84 }}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="bXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                spellCheck={false}
                autoFocus={!initialTo}
              />
              <div className="input-suffix">
                {addrState?.valid && <CheckCircle2 size={16} color="var(--positive)" />}
                <IconButton
                  label="Paste"
                  onClick={async () => setTo(await window.lbc.app.paste())}
                >
                  <ClipboardPaste size={16} />
                </IconButton>
                <IconButton label="Contacts" onClick={() => setContactsOpen(true)}>
                  <BookUser size={16} />
                </IconButton>
              </div>
            </div>
          </Field>

          <Field label="Amount" error={parsed && !parsed.ok ? parsed.error : undefined} hint={fiatEquivalent ? `≈ ${fiatEquivalent}` : undefined}>
            <div className="input-wrap">
              <input
                className={`input amount-input has-suffix ${parsed && !parsed.ok ? 'invalid' : ''}`}
                value={amount}
                inputMode="decimal"
                placeholder="0.00"
                onChange={(e) => {
                  setMax(false);
                  setAmount(e.target.value.replace(/[^0-9.,]/g, ''));
                }}
              />
              <div className="input-suffix">
                <span className="unit">LBC</span>
                <Button size="sm" variant={max ? 'primary' : 'secondary'} onClick={() => setMax(!max)}>
                  Max
                </Button>
              </div>
            </div>
          </Field>

          <Field label="Note (optional, only stored in this wallet)">
            <input className="input" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Rent, Tip for @creator" />
          </Field>

          <div className="row between small">
            <span className="text-2">
              Network fee: {preview ? `${lbc(preview.fee)} LBC` : '—'} <span className="muted">({feeRate} dewies/byte)</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setShowFee(!showFee)}>
              <SlidersHorizontal size={14} /> Fee
            </Button>
          </div>
          {showFee && (
            <div className="card tight stack">
              <Field label={`Fee rate: ${feeRate} dewies per byte`} hint="LBC blocks are rarely full; the default (50) confirms quickly. The network minimum is 1.">
                <input type="range" className="slider" min={1} max={200} value={feeRate} onChange={(e) => setFeeRate(Number(e.target.value))} />
              </Field>
            </div>
          )}

          {previewError && <Callout tone="warn">{previewError}</Callout>}

          <div className="row">
            <div className="spacer" />
            <Button variant="ghost" onClick={reset}>
              Clear
            </Button>
            <Button variant="primary" size="lg" disabled={!canReview} loading={busy} onClick={() => void openReview()}>
              Review
            </Button>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h3>Summary</h3>
            <div className="kv">
              <div className="k">To</div>
              <div className="mono ellipsis">{addrState?.valid ? shortAddress(to.trim(), 10, 8) : '—'}</div>
              <div className="k">Amount</div>
              <div>{preview ? `${lbc(preview.recipients[0]!.value)} LBC` : '—'}</div>
              <div className="k">Fee</div>
              <div>{preview ? `${lbc(preview.fee)} LBC` : '—'}</div>
              <div className="k">Total</div>
              <div className="strong">{preview ? `${lbc(preview.total)} LBC` : '—'}</div>
            </div>
          </div>
          <Callout title="Sending is final">Transactions can't be reversed. Always verify the first and last characters of the address.</Callout>
        </div>
      </div>

      {contactsOpen && (
        <Modal title="Choose a contact" onClose={() => setContactsOpen(false)}>
          {contacts.length === 0 ? (
            <div className="muted">No contacts yet. Add them on the Contacts page.</div>
          ) : (
            <div className="list">
              {contacts.map((c) => (
                <div
                  key={c.id}
                  className="list-row"
                  onClick={() => {
                    setTo(c.address);
                    setContactsOpen(false);
                  }}
                >
                  <div className="wallet-avatar">{c.name.slice(0, 1).toUpperCase()}</div>
                  <div className="tx-main">
                    <div className="tx-title">{c.name}</div>
                    <div className="tx-sub mono">{shortAddress(c.address, 12, 8)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {review && (
        <ReviewSend
          draft={review}
          label={label || undefined}
          onClose={() => setReview(null)}
          onSent={() => {
            reset();
          }}
        />
      )}
    </>
  );
}
