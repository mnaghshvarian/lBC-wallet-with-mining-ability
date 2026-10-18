import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ArrowRight, Plus, Trash2, XCircle } from 'lucide-react';
import type { SwapCodeView, SwapCoinName, SwapContractView, SwapStage, SwapView } from '@lbcwallet/services/api';
import { errorMessage, useApp, useT } from '../store';
import { Badge, Button, Callout, CopyButton, Field, PasswordInput, Segmented } from '../components/ui';
import { AddressText, QrCode } from '../components/display';
import { dateTime, lbc, list, parseLbc, relativeTime } from '../lib/format';
import type { Translate } from '../i18n';

/** "20 LBC" / "0.01 BTC" from an amount in the coin's smallest unit (both have 8 decimals). */
const coin = (units: string, c: SwapCoinName) => `${lbc(units)} ${c}`;
const amountOf = (s: Pick<SwapView, 'lbc' | 'btc'>, c: SwapCoinName) => (c === 'LBC' ? s.lbc : s.btc);

const DONE: SwapStage[] = ['completed', 'refunded', 'cancelled', 'failed'];

function stageTone(stage: SwapStage): 'green' | 'violet' | 'amber' | 'red' | 'blue' {
  if (stage === 'completed') return 'green';
  if (stage === 'failed') return 'red';
  if (stage === 'refund-waiting' || stage === 'refunding' || stage === 'refunded' || stage === 'cancelled') return 'amber';
  if (stage === 'lock' || stage === 'pay-btc') return 'violet';
  return 'blue';
}

/** The text that explains what is happening now and what to do. */
function stageText(t: Translate, s: SwapView): string {
  const params = { give: coin(amountOf(s, s.give), s.give), get: coin(amountOf(s, s.get), s.get), coin: s.give, other: s.get };
  switch (s.stage) {
    case 'lock':
      return t(s.role === 'starter' ? 'swap.stageText.lockStarter' : 'swap.stageText.lockJoiner', params);
    case 'send-lock':
      return t(s.role === 'starter' ? 'swap.stageText.sendLockStarter' : 'swap.stageText.sendLockJoiner', params);
    case 'checking':
      return t('swap.stageText.checking', { ...params, n: s.theirs?.confirmations ?? 0, required: s.theirs?.required ?? 0 });
    case 'refund-waiting':
      return t('swap.stageText.refund-waiting', { ...params, time: s.refundAt ? dateTime(s.refundAt) : '—' });
    default:
      return t(`swap.stageText.${s.stage}`, params);
  }
}

function problemText(t: Translate, p: NonNullable<SwapView['problem']>): string {
  const params: Record<string, string | number> = { ...(p.params ?? {}) };
  if (p.code === 'their-contract-invalid' && typeof params.reasons === 'string') {
    params.reasons = list(params.reasons.split(',').map((r) => t(`swap.reason.${r}`)));
  }
  if (p.code === 'underpaid') {
    params.paid = coin(String(params.paid ?? '0'), 'BTC');
    params.expected = coin(String(params.expected ?? '0'), 'BTC');
  }
  return t(`swap.problem.${p.code}`, params);
}

function ContractRow({ label, c }: { label: string; c: SwapContractView }) {
  const t = useT();
  return (
    <>
      <div className="k">{label}</div>
      <div className="stack tight" style={{ minWidth: 0 }}>
        <AddressText address={c.address} className="small" />
        <span className="small text-2">
          {c.value ? coin(c.value, c.coin) : '—'} · {t('swap.confirmations', { n: c.confirmations, required: c.required })}
        </span>
        <span className="small text-2">{t('swap.refundFrom', { time: dateTime(c.locktime) })}</span>
        {c.txid && <span className="mono small text-2 ellipsis">{c.txid}</span>}
      </div>
    </>
  );
}

function SwapDetail({ swap, onRemoved }: { swap: SwapView; onRemoved: () => void }) {
  const t = useT();
  const settings = useApp((s) => s.settings)!;
  const toast = useApp((s) => s.toast);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const give = coin(amountOf(swap, swap.give), swap.give);
  const get = coin(amountOf(swap, swap.get), swap.get);
  const needPassword = swap.give === 'LBC' && settings.requirePasswordToSend;

  return (
    <div className="card stack">
      <div className="card-header">
        <h3 className="row">
          {give} <ArrowRight size={16} /> {get}
        </h3>
        <div className="spacer" />
        <Badge tone={stageTone(swap.stage)}>{t(`swap.stage.${swap.stage}`)}</Badge>
      </div>
      <div className="text-2">{stageText(t, swap)}</div>
      {swap.problem && swap.problem.code !== 'cancelled' && (
        <Callout tone={swap.problem.code === 'explorer' ? 'info' : 'warn'}>{problemText(t, swap.problem)}</Callout>
      )}

      {swap.code && (
        <Field label={t('swap.codeLabel')} hint={t('swap.codeHint')}>
          <div className="address-box mono selectable" style={{ fontSize: 12, wordBreak: 'break-all' }}>
            {swap.code}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <CopyButton text={swap.code} label={t('swap.copyCode')} />
          </div>
        </Field>
      )}

      {swap.payTo && (
        <div className="row wrap" style={{ alignItems: 'flex-start', gap: 16 }}>
          <QrCode value={`bitcoin:${swap.payTo.address}?amount=${lbc(swap.payTo.amount).replace(/,/g, '')}`} size={160} />
          <div className="stack tight" style={{ flex: 1, minWidth: 200 }}>
            <div className="small text-2">{t('swap.payAddress')}</div>
            <div className="address-box mono selectable" style={{ fontSize: 13, wordBreak: 'break-all' }}>
              {swap.payTo.address}
            </div>
            <div className="row">
              <CopyButton text={swap.payTo.address} />
            </div>
            <div className="small text-2" style={{ marginTop: 8 }}>
              {t('swap.payAmount')}
            </div>
            <div className="strong">{coin(swap.payTo.amount, 'BTC')}</div>
            <div className="row">
              <CopyButton text={lbc(swap.payTo.amount).replace(/,/g, '')} />
            </div>
            <div className="hint">{t('swap.paying')}</div>
          </div>
        </div>
      )}

      {swap.expectsCode && (
        <Field label={t('swap.pasteLock')} error={error}>
          <textarea className="input mono" rows={3} value={code} onChange={(e) => setCode(e.target.value)} placeholder="lbcswap:…" spellCheck={false} />
          <div className="row" style={{ marginTop: 6 }}>
            <Button variant="primary" loading={busy} disabled={!code.trim()} onClick={() => void run(() => window.lbc.swap.accept({ code: code.trim() }).then(() => setCode('')))}>
              {t('swap.continue')}
            </Button>
          </div>
        </Field>
      )}

      {swap.stage === 'lock' && (
        <div className="stack tight">
          {needPassword && (
            <Field label={t('common.walletPassword')}>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <div className="row">
            <Button
              variant="violet"
              loading={busy}
              disabled={needPassword && !password}
              onClick={() =>
                void run(async () => {
                  await window.lbc.swap.lock({ id: swap.id, password: needPassword ? password : undefined });
                  setPassword('');
                })
              }
            >
              {swap.give === 'LBC' ? t('swap.lockLbc', { amount: give }) : t('swap.lockBtc')}
            </Button>
          </div>
          {error && !swap.expectsCode && <div className="error-text">{error}</div>}
        </div>
      )}

      <div className="row wrap">
        {swap.cancellable &&
          (confirmCancel ? (
            <>
              <span className="small text-2">{t('swap.cancelConfirm')}</span>
              <Button size="sm" variant="danger" loading={busy} onClick={() => void run(() => window.lbc.swap.cancel(swap.id))}>
                <XCircle size={15} /> {t('swap.cancel')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                {t('common.back')}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(true)}>
              <XCircle size={15} /> {t('swap.cancel')}
            </Button>
          ))}
        {DONE.includes(swap.stage) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void window.lbc.swap
                .remove(swap.id)
                .then(onRemoved)
                .catch((err) => toast({ kind: 'error', title: t('swap.title'), message: errorMessage(err) }))
            }
          >
            <Trash2 size={15} /> {t('swap.remove')}
          </Button>
        )}
      </div>

      <details>
        <summary className="small strong">{t('swap.details')}</summary>
        <div className="kv" style={{ marginTop: 10 }}>
          <div className="k">{t('swap.roleLabel')}</div>
          <div>{t(`swap.role.${swap.role}`)}</div>
          <div className="k">{t('swap.receiveTo')}</div>
          <div>
            <AddressText address={swap.receiveTo} className="small" />
          </div>
          <div className="k">{t('swap.refundTo')}</div>
          <div>
            <AddressText address={swap.refundTo} className="small" />
          </div>
          {swap.ours && <ContractRow label={t('swap.ours')} c={swap.ours} />}
          {swap.theirs && <ContractRow label={t('swap.theirs')} c={swap.theirs} />}
          {swap.claimTxid && (
            <>
              <div className="k">{t('swap.claimTx')}</div>
              <div className="mono small ellipsis">{swap.claimTxid}</div>
            </>
          )}
          {swap.refundTxid && (
            <>
              <div className="k">{t('swap.refundTx')}</div>
              <div className="mono small ellipsis">{swap.refundTxid}</div>
            </>
          )}
        </div>
        <div className="stack tight" style={{ marginTop: 10 }}>
          <div className="small strong">{t('swap.history')}</div>
          {swap.events
            .slice()
            .reverse()
            .map((e, i) => (
              <div key={i} className="small text-2">
                {relativeTime(e.at / 1000)} · {t(`swap.event.${e.code}`)}
              </div>
            ))}
        </div>
      </details>
    </div>
  );
}

function StartForm({ onDone }: { onDone: (s: SwapView) => void }) {
  const t = useT();
  const [give, setGive] = useState<SwapCoinName>('LBC');
  const [lbcText, setLbcText] = useState('');
  const [btcText, setBtcText] = useState('');
  const [btcAddress, setBtcAddress] = useState('');
  const [fee, setFee] = useState<{ satPerVbyte: number; claimSats: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void window.lbc.swap.btcFee().then((f) => alive && setFee(f));
    return () => {
      alive = false;
    };
  }, []);

  const parsed = useMemo(() => {
    try {
      return { lbc: parseLbc(lbcText), btc: parseLbc(btcText) };
    } catch {
      return null;
    }
  }, [lbcText, btcText]);
  const price = parsed && parsed.lbc > 0n && parsed.btc > 0n ? Number(parsed.btc) / Number(parsed.lbc) : null;

  const submit = async () => {
    if (!parsed) return;
    setBusy(true);
    setError('');
    try {
      onDone(await window.lbc.swap.start({ give, lbc: parsed.lbc.toString(), btc: parsed.btc.toString(), btcAddress: btcAddress.trim() }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <div className="card-header">
        <h3>{t('swap.start.title')}</h3>
      </div>
      <div className="hint">{t('swap.start.agreeFirst')}</div>
      <Field label={t('swap.start.direction')}>
        <Segmented
          value={give}
          options={[
            { value: 'LBC', label: t('swap.start.giveLbc') },
            { value: 'BTC', label: t('swap.start.giveBtc') },
          ]}
          onChange={setGive}
        />
      </Field>
      <div className="grid grid-2">
        <Field label={t('swap.start.lbcAmount')}>
          <input className="input" inputMode="decimal" value={lbcText} onChange={(e) => setLbcText(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label={t('swap.start.btcAmount')}>
          <input className="input" inputMode="decimal" value={btcText} onChange={(e) => setBtcText(e.target.value)} placeholder="0.00000000" />
        </Field>
      </div>
      {price !== null && <div className="small text-2">{t('swap.start.price', { price: price.toFixed(10).replace(/0+$/, ''), lbcPerBtc: Math.round(1 / price).toLocaleString('en-US') })}</div>}
      <Field label={give === 'LBC' ? t('swap.start.btcReceive') : t('swap.start.btcRefund')} hint={t('swap.start.btcAddressHint')}>
        <input className="input mono" value={btcAddress} onChange={(e) => setBtcAddress(e.target.value)} placeholder="bc1…" spellCheck={false} />
      </Field>
      {fee && <div className="small text-2">{t('swap.start.fee', { sats: Number(fee.claimSats).toLocaleString('en-US'), rate: fee.satPerVbyte })}</div>}
      {error && <div className="error-text">{error}</div>}
      <div className="row">
        <Button variant="primary" loading={busy} disabled={!parsed || !btcAddress.trim()} onClick={() => void submit()}>
          {t('swap.start.create')}
        </Button>
      </div>
    </div>
  );
}

function JoinForm({ onDone }: { onDone: (s: SwapView) => void }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<SwapCodeView | null>(null);
  const [inspectError, setInspectError] = useState('');
  const [btcAddress, setBtcAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const text = code.trim();
    setInfo(null);
    setInspectError('');
    if (!text) return;
    let alive = true;
    void window.lbc.swap
      .inspect(text)
      .then((v) => alive && setInfo(v))
      .catch((err) => alive && setInspectError(errorMessage(err)));
    return () => {
      alive = false;
    };
  }, [code]);

  const invite = info?.type === 'invite' ? info : null;
  const youGet: SwapCoinName | null = invite ? (invite.youGive === 'LBC' ? 'BTC' : 'LBC') : null;

  return (
    <div className="card stack">
      <div className="card-header">
        <h3>{t('swap.join.title')}</h3>
      </div>
      <Field label={t('swap.join.paste')} error={inspectError}>
        <textarea className="input mono" rows={3} value={code} onChange={(e) => setCode(e.target.value)} placeholder="lbcswap:…" spellCheck={false} />
      </Field>
      {info?.type === 'lock' && <Callout tone="warn">{t('swap.join.isLock')}</Callout>}
      {invite?.known && <Callout tone="warn">{t('swap.join.known')}</Callout>}
      {invite && !invite.known && youGet && (
        <>
          <Callout title={t('swap.join.summary', { give: coin(amountOf(invite, invite.youGive), invite.youGive), get: coin(amountOf(invite, youGet), youGet) })}>
            {t('swap.join.firstNote')}
          </Callout>
          <Field label={invite.youGive === 'BTC' ? t('swap.start.btcRefund') : t('swap.start.btcReceive')} hint={t('swap.start.btcAddressHint')}>
            <input className="input mono" value={btcAddress} onChange={(e) => setBtcAddress(e.target.value)} placeholder="bc1…" spellCheck={false} />
          </Field>
          {error && <div className="error-text">{error}</div>}
          <div className="row">
            <Button
              variant="primary"
              loading={busy}
              disabled={!btcAddress.trim()}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  onDone(await window.lbc.swap.join({ code: code.trim(), btcAddress: btcAddress.trim() }));
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('swap.join.join')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function Swap() {
  const t = useT();
  const [swaps, setSwaps] = useState<SwapView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'start' | 'join'>('list');

  useEffect(() => {
    let alive = true;
    void window.lbc.swap.list().then((list) => {
      if (!alive) return;
      setSwaps(list);
      setSelected((cur) => cur ?? list.find((s) => !DONE.includes(s.stage))?.id ?? null);
    });
    const off = window.lbc.on('swap:changed', (v) => setSwaps((list) => [v, ...list.filter((s) => s.id !== v.id)].sort((a, b) => b.createdAt - a.createdAt)));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const current = swaps.find((s) => s.id === selected) ?? null;
  const opened = (s: SwapView) => {
    setSwaps((list) => [s, ...list.filter((x) => x.id !== s.id)]);
    setSelected(s.id);
    setMode('list');
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t('swap.title')}</h1>
          <div className="sub">{t('swap.sub')}</div>
        </div>
        <div className="actions">
          <Button variant={mode === 'start' ? 'primary' : 'secondary'} onClick={() => setMode(mode === 'start' ? 'list' : 'start')}>
            <Plus size={16} /> {t('swap.newSwap')}
          </Button>
          <Button variant={mode === 'join' ? 'primary' : 'secondary'} onClick={() => setMode(mode === 'join' ? 'list' : 'join')}>
            <ArrowLeftRight size={16} /> {t('swap.joinSwap')}
          </Button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <div className="stack">
          {mode === 'start' && <StartForm onDone={opened} />}
          {mode === 'join' && <JoinForm onDone={opened} />}
          {mode === 'list' && current && <SwapDetail swap={current} onRemoved={() => setSelected(null)} />}
          {mode === 'list' && !current && (
            <Callout title={t('swap.how.title')}>
              <span className="row" style={{ alignItems: 'flex-start' }}>
                <ArrowLeftRight size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{t('swap.how.text')}</span>
              </span>
            </Callout>
          )}
          <Callout tone="warn" title={t('swap.safety.title')}>
            {t('swap.safety.text')}
          </Callout>
        </div>

        <div className="card">
          <div className="card-header">
            <h3>{t('swap.list')}</h3>
          </div>
          {swaps.length === 0 ? (
            <div className="muted small">{t('swap.none')}</div>
          ) : (
            <div className="stack tight">
              {swaps.map((s) => (
                <button
                  key={s.id}
                  className={`list-row ${s.id === selected && mode === 'list' ? 'active' : ''}`}
                  onClick={() => {
                    setSelected(s.id);
                    setMode('list');
                  }}
                  style={{ textAlign: 'start' }}
                >
                  <div className="stack tight" style={{ flex: 1, minWidth: 0 }}>
                    <span className="row strong">
                      {coin(amountOf(s, s.give), s.give)} <ArrowRight size={14} /> {coin(amountOf(s, s.get), s.get)}
                    </span>
                    <span className="small text-2">{relativeTime(s.createdAt / 1000)}</span>
                  </div>
                  <Badge tone={stageTone(s.stage)}>{t(`swap.stage.${s.stage}`)}</Badge>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
