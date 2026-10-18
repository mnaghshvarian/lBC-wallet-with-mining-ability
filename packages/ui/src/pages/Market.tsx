import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Clock, Globe2, Handshake, Plus, Radio, Scale, ShieldOff, Trash2, UserX, XCircle } from 'lucide-react';
import { btcForLbc, parseLbc } from '@lbcwallet/core/ui';
import { MARKET_TERMS_VERSION, type MarketOfferView, type MarketPriceView, type MarketTradeView, type MarketView, type MyOfferView, type SwapCoinName, type SwapView } from '@lbcwallet/services/api';
import { errorMessage, useApp, useT } from '../store';
import { Badge, Button, Callout, Field, Modal, Segmented, Spinner } from '../components/ui';
import { formatFiat, lbc, number, relativeTime, significant } from '../lib/format';
import type { Translate } from '../i18n';
import { SwapDetail } from './Swap';

/** "20 LBC" / "0.01 BTC" from an amount in the coin's smallest unit (both have 8 decimals). */
const coin = (units: string | bigint, c: SwapCoinName) => `${lbc(units)} ${c}`;
const LBC_UNITS = 100_000_000n;
/** Smallest swap: below these, network fees eat too much (the services check the same). */
const MIN_LBC = 10n * LBC_UNITS;
const MIN_BTC = 20_000n;

const offerTerms = (o: Pick<MarketOfferView, 'lbc' | 'btc' | 'give'>) => ({ lbc: BigInt(o.lbc), btc: BigInt(o.btc), give: o.give });

/** A price in satoshis per LBC as typed ("2.05"), as an exact fraction. */
function parsePrice(text: string): { num: bigint; den: bigint } | null {
  const m = /^\s*(\d{1,9})(?:[.,](\d{1,8}))?\s*$/.exec(text);
  if (!m) return null;
  const frac = m[2] ?? '';
  const num = BigInt(m[1]! + frac);
  const den = 10n ** BigInt(frac.length);
  return num > 0n ? { num, den } : null;
}

/** Satoshis for `dewies` at a price in satoshis per LBC (rounded to the nearest satoshi). */
function satsAt(dewies: bigint, price: { num: bigint; den: bigint }): bigint {
  const d = price.den * LBC_UNITS;
  return (dewies * price.num + d / 2n) / d;
}

function tradeTone(status: MarketTradeView['status']): 'green' | 'violet' | 'amber' | 'red' | 'blue' {
  if (status === 'done') return 'green';
  if (status === 'swapping') return 'violet';
  if (status === 'waiting' || status === 'invited') return 'blue';
  return 'amber';
}

// ---------------------------------------------------------------- the warning

const WARNINGS = [
  { key: 'notExchange', icon: Handshake },
  { key: 'settlement', icon: ShieldOff },
  { key: 'online', icon: Clock },
  { key: 'strangers', icon: UserX },
  { key: 'relays', icon: Globe2 },
  { key: 'law', icon: Scale },
] as const;

const CHECKS = ['checkStrangers', 'checkRisk'] as const;

/** Shown before the order board is used for the first time. */
function MarketWarning() {
  const t = useT();
  const updateSettings = useApp((s) => s.updateSettings);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  return (
    <div className="card stack" style={{ maxWidth: 820 }}>
      <h2 className="row" style={{ margin: 0 }}>
        <AlertTriangle size={22} color="var(--warning)" aria-hidden /> {t('market.warning.title')}
      </h2>
      <p className="text-2" style={{ margin: 0 }}>
        {t('market.warning.lead')}
      </p>
      <div className="terms">
        {WARNINGS.map(({ key, icon: Icon }) => (
          <section key={key} className="terms-section">
            <h3>
              <Icon size={17} aria-hidden /> {t(`market.warning.${key}.title`)}
            </h3>
            <p>{t(`market.warning.${key}.text`)}</p>
          </section>
        ))}
      </div>
      <div className="stack tight">
        {CHECKS.map((c) => (
          <label key={c} className="check-row">
            <input type="checkbox" checked={!!checked[c]} onChange={(e) => setChecked({ ...checked, [c]: e.target.checked })} />
            <span>{t(`market.warning.${c}`)}</span>
          </label>
        ))}
      </div>
      <div className="row">
        <div className="spacer" />
        <Button
          variant="primary"
          size="lg"
          loading={busy}
          disabled={!CHECKS.every((c) => checked[c])}
          onClick={() => {
            setBusy(true);
            void updateSettings({ acceptedMarketTerms: MARKET_TERMS_VERSION }).finally(() => setBusy(false));
          }}
        >
          {t('market.warning.accept')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- reference price

function PriceCard({ price, unavailable }: { price: MarketPriceView | null; unavailable: boolean }) {
  const t = useT();
  const [amount, setAmount] = useState('10000');
  const dewies = useMemo(() => {
    try {
      return parseLbc(amount);
    } catch {
      return null;
    }
  }, [amount]);
  const n = dewies === null ? null : Number(dewies) / 1e8;
  return (
    <div className="card stack">
      <div className="card-header">
        <h3>{t('market.price.title')}</h3>
        <div className="spacer" />
        {price && <span className="small text-2">{t('market.price.source', { source: price.source, time: relativeTime(price.updatedAt / 1000) })}</span>}
      </div>
      {!price ? (
        unavailable ? (
          <div className="small text-2">{t('market.price.unavailable')}</div>
        ) : (
          <div className="row small text-2">
            <Spinner /> {t('market.price.loading')}
          </div>
        )
      ) : (
        <>
          <div className="row wrap" style={{ gap: 18 }}>
            <div className="stack tight">
              <span className="small text-2">{t('market.price.oneLbc')}</span>
              <span className="strong">{formatFiat(price.usd, 'USD')}</span>
            </div>
            <div className="stack tight">
              <span className="small text-2">{t('market.price.inBtc')}</span>
              <span className="strong">{t('market.sats', { n: significant(price.sats, 3) })}</span>
            </div>
            {price.xmr !== null && (
              <div className="stack tight">
                <span className="small text-2">{t('market.price.inXmr')}</span>
                <span className="strong">{significant(price.xmr, 3)} XMR</span>
              </div>
            )}
          </div>
          <Field label={t('market.price.convert')}>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          {n !== null && n > 0 && (
            <div className="small text-2">
              {t('market.price.converted', {
                lbc: number(n, 2),
                btc: significant((n * price.sats) / 1e8, 4),
                xmr: price.xmr !== null ? significant(n * price.xmr, 4) : '—',
                usd: formatFiat(n * price.usd, 'USD'),
              })}
            </div>
          )}
          <div className="hint">{t('market.price.hint')}</div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the board

function premiumBadge(t: Translate, premium: number | null, side: 'buy' | 'sell') {
  if (premium === null) return null;
  // Buying, cheaper is better; selling, higher is better.
  const good = side === 'buy' ? premium <= 0 : premium >= 0;
  const text = premium >= 0 ? t('market.above', { pct: number(premium, 1) }) : t('market.below', { pct: number(-premium, 1) });
  return <Badge tone={Math.abs(premium) < 1 ? 'blue' : good ? 'green' : 'amber'}>{text}</Badge>;
}

function Board({ view, side, onTake }: { view: MarketView; side: 'buy' | 'sell'; onTake: (o: MarketOfferView) => void }) {
  const t = useT();
  // Buying LBC means taking offers that give LBC.
  const offers = view.offers.filter((o) => (side === 'buy' ? o.give === 'LBC' : o.give === 'BTC'));
  const connected = view.relays.filter((r) => r.state === 'open').length;
  return (
    <>
      <div className="row small text-2">
        <Radio size={14} aria-hidden /> {t('market.relays', { n: connected, total: view.relays.length })}
        {!view.loaded && connected > 0 && <Spinner />}
      </div>
      {offers.length === 0 ? (
        <div className="muted small">{!view.loaded ? t('market.loading') : side === 'buy' ? t('market.noSellers') : t('market.noBuyers')}</div>
      ) : (
        <div className="table-wrap">
          <table className="table offer-table">
            <thead>
              <tr>
                <th>{t('market.col.price')}</th>
                <th>{t('market.col.available')}</th>
                <th>{t('market.col.total')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.key}>
                  <td data-label={t('market.col.price')}>
                    <div className="stack tight">
                      <span className="strong">{t('market.sats', { n: significant(o.price, 4) })}</span>
                      {premiumBadge(t, o.premium, side)}
                    </div>
                  </td>
                  <td data-label={t('market.col.available')}>
                    <div className="stack tight">
                      <span>{coin(o.left, 'LBC')}</span>
                      <span className="small text-2">{t('market.from', { min: coin(o.min, 'LBC') })}</span>
                    </div>
                  </td>
                  <td data-label={t('market.col.total')}>
                    <div className="stack tight">
                      <span>{coin(btcForLbc(offerTerms(o), BigInt(o.left)), 'BTC')}</span>
                      <span className="small text-2">{relativeTime(o.createdAt)}</span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'end' }}>
                    {o.mine ? (
                      <Badge tone="violet">{t('market.yours')}</Badge>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => onTake(o)}>
                        {side === 'buy' ? t('market.buy') : t('market.sell')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- taking an offer

function TakeDialog({ offer, view, swaps, onClose }: { offer: MarketOfferView; view: MarketView; swaps: SwapView[]; onClose: () => void }) {
  const t = useT();
  const overview = useApp((s) => s.overview)!;
  const [amount, setAmount] = useState(lbc(offer.left).replace(/,/g, ''));
  const [btcAddress, setBtcAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tradeId, setTradeId] = useState<string | null>(null);
  const youGive: SwapCoinName = offer.give === 'LBC' ? 'BTC' : 'LBC';
  const dewies = useMemo(() => {
    try {
      return parseLbc(amount);
    } catch {
      return null;
    }
  }, [amount]);
  const btc = dewies !== null && dewies > 0n ? btcForLbc(offerTerms(offer), dewies) : null;
  const inRange = dewies !== null && dewies >= BigInt(offer.min) && dewies <= BigInt(offer.left);
  const trade = tradeId ? view.trades.find((x) => x.id === tradeId) : undefined;
  const swap = trade?.swapId ? swaps.find((s) => s.id === trade.swapId) : undefined;

  const take = async () => {
    if (dewies === null) return;
    setBusy(true);
    setError('');
    try {
      const r = await window.lbc.market.take({ key: offer.key, lbc: dewies.toString(), btcAddress: btcAddress.trim() });
      setTradeId(r.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const give = youGive === 'LBC' ? coin(dewies ?? 0n, 'LBC') : coin(btc ?? 0n, 'BTC');
  const get = youGive === 'LBC' ? coin(btc ?? 0n, 'BTC') : coin(dewies ?? 0n, 'LBC');

  return (
    <Modal title={offer.give === 'LBC' ? t('market.take.buyTitle') : t('market.take.sellTitle')} onClose={onClose} wide>
      <div className="stack">
        {!trade ? (
          <>
            <div className="small text-2">
              {t('market.take.offer', { price: t('market.sats', { n: significant(offer.price, 4) }), min: coin(offer.min, 'LBC'), max: coin(offer.left, 'LBC') })}
            </div>
            <Field label={t('market.take.amount')} error={dewies !== null && dewies > 0n && !inRange ? t('market.take.range', { min: coin(offer.min, 'LBC'), max: coin(offer.left, 'LBC') }) : undefined}>
              <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </Field>
            {btc !== null && inRange && (
              <Callout title={t('market.take.summary', { give, get })}>
                {youGive === 'LBC' ? t('market.take.firstLbc', { give }) : t('market.take.firstBtc', { give })}
              </Callout>
            )}
            {youGive === 'LBC' && dewies !== null && BigInt(overview.balance.available) < dewies && <Callout tone="warn">{t('market.take.notEnough', { available: coin(overview.balance.available, 'LBC') })}</Callout>}
            <Field label={youGive === 'BTC' ? t('swap.start.btcRefund') : t('swap.start.btcReceive')} hint={t('swap.start.btcAddressHint')}>
              <input className="input mono" value={btcAddress} onChange={(e) => setBtcAddress(e.target.value)} placeholder="bc1…" spellCheck={false} />
            </Field>
            {(btc ?? 0n) < MIN_BTC && inRange && <Callout tone="warn">{t('market.take.tooSmall')}</Callout>}
            {error && <div className="error-text">{error}</div>}
            <div className="row">
              <div className="spacer" />
              <Button variant="ghost" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" loading={busy} disabled={!inRange || !btcAddress.trim()} onClick={() => void take()}>
                {offer.give === 'LBC' ? t('market.take.buy', { amount: coin(dewies ?? 0n, 'LBC') }) : t('market.take.sell', { amount: coin(dewies ?? 0n, 'LBC') })}
              </Button>
            </div>
          </>
        ) : trade.status === 'waiting' ? (
          <div className="stack">
            <div className="row">
              <Spinner /> <span>{t('market.trade.waiting')}</span>
            </div>
            {trade.unsent && <div className="small text-2">{t('market.trade.unsent')}</div>}
          </div>
        ) : swap ? (
          <SwapDetail swap={swap} onRemoved={onClose} automatic />
        ) : (
          <Callout tone="warn">{tradeStatusText(t, trade)}</Callout>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- posting an offer

function PostDialog({ price, onClose }: { price: MarketPriceView | null; onClose: () => void }) {
  const t = useT();
  const overview = useApp((s) => s.overview)!;
  const [side, setSide] = useState<'sell' | 'buy'>('sell');
  const [amount, setAmount] = useState('');
  const [priceText, setPriceText] = useState(price ? significant(price.sats, 3).replace(/,/g, '') : '');
  const [minText, setMinText] = useState('');
  const [btcAddress, setBtcAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const give: SwapCoinName = side === 'sell' ? 'LBC' : 'BTC';

  const dewies = useMemo(() => {
    try {
      return parseLbc(amount);
    } catch {
      return null;
    }
  }, [amount]);
  const p = parsePrice(priceText);
  const btc = dewies !== null && dewies > 0n && p ? satsAt(dewies, p) : null;
  // The smallest part, by default the smallest amount a swap is worth at this price.
  const autoMin = useMemo(() => {
    if (!p || !dewies || dewies <= 0n) return null;
    const forBtc = (MIN_BTC * p.den * LBC_UNITS + p.num - 1n) / p.num;
    const rounded = ((forBtc > MIN_LBC ? forBtc : MIN_LBC) + LBC_UNITS - 1n) / LBC_UNITS * LBC_UNITS;
    return rounded > dewies ? dewies : rounded;
  }, [p?.num, p?.den, dewies]);
  const min = useMemo(() => {
    if (!minText.trim()) return autoMin;
    try {
      return parseLbc(minText);
    } catch {
      return null;
    }
  }, [minText, autoMin]);
  const premium = price && p ? ((Number(p.num) / Number(p.den)) / price.sats - 1) * 100 : null;
  const ready = dewies !== null && dewies > 0n && btc !== null && btc > 0n && min !== null && min > 0n && min <= dewies && !!btcAddress.trim();

  const post = async () => {
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      await window.lbc.market.post({ give, lbc: dewies!.toString(), btc: btc!.toString(), min: min!.toString(), btcAddress: btcAddress.trim() });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('market.post.title')} onClose={onClose} wide>
      <div className="stack">
        <Field label={t('market.post.side')}>
          <Segmented
            value={side}
            options={[
              { value: 'sell', label: t('market.post.sell') },
              { value: 'buy', label: t('market.post.buy') },
            ]}
            onChange={setSide}
          />
        </Field>
        <div className="grid grid-2">
          <Field label={t('market.post.amount')} hint={side === 'sell' ? t('market.post.available', { amount: coin(overview.balance.available, 'LBC') }) : undefined}>
            <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>
          <Field
            label={t('market.post.price')}
            hint={
              price ? (
                <button className="link" type="button" onClick={() => setPriceText(significant(price.sats, 3).replace(/,/g, ''))}>
                  {t('market.post.useMarket', { price: t('market.sats', { n: significant(price.sats, 3) }), source: price.source })}
                </button>
              ) : undefined
            }
          >
            <input className="input" inputMode="decimal" value={priceText} onChange={(e) => setPriceText(e.target.value)} placeholder="2.0" />
          </Field>
        </div>
        <Field label={t('market.post.min')} hint={autoMin !== null ? t('market.post.minHint', { amount: coin(autoMin, 'LBC') }) : undefined}>
          <input className="input" inputMode="decimal" value={minText} onChange={(e) => setMinText(e.target.value)} placeholder={autoMin !== null ? lbc(autoMin).replace(/,/g, '') : '0.00'} />
        </Field>
        <Field label={side === 'sell' ? t('swap.start.btcReceive') : t('swap.start.btcRefund')} hint={t('swap.start.btcAddressHint')}>
          <input className="input mono" value={btcAddress} onChange={(e) => setBtcAddress(e.target.value)} placeholder="bc1…" spellCheck={false} />
        </Field>
        {dewies !== null && btc !== null && btc > 0n && (
          <Callout title={side === 'sell' ? t('market.post.summarySell', { lbc: coin(dewies, 'LBC'), btc: coin(btc, 'BTC') }) : t('market.post.summaryBuy', { lbc: coin(dewies, 'LBC'), btc: coin(btc, 'BTC') })}>
            <span className="stack tight">
              {premium !== null && <span>{premium >= 0 ? t('market.post.above', { pct: number(premium, 1) }) : t('market.post.below', { pct: number(-premium, 1) })}</span>}
              {price && <span>{t('market.post.worth', { usd: formatFiat((Number(dewies) / 1e8) * price.usd, 'USD') })}</span>}
              <span>{side === 'sell' ? t('market.post.howSell') : t('market.post.howBuy')}</span>
            </span>
          </Callout>
        )}
        <Callout tone="warn">{t('market.post.stayOnline')}</Callout>
        {error && <div className="error-text">{error}</div>}
        <div className="row">
          <div className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={() => void post()}>
            {t('market.post.post')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- your offers and trades

function MyOffers({ offers }: { offers: MyOfferView[] }) {
  const t = useT();
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState<string | null>(null);
  if (offers.length === 0) return null;
  return (
    <div className="card stack">
      <div className="card-header">
        <h3>{t('market.mine.title')}</h3>
      </div>
      {offers.map((o) => (
        <div key={o.id} className="list-row" style={{ alignItems: 'flex-start' }}>
          <div className="stack tight" style={{ flex: 1, minWidth: 0 }}>
            <span className="strong">
              {o.give === 'LBC' ? t('market.mine.selling', { lbc: coin(o.lbc, 'LBC') }) : t('market.mine.buying', { lbc: coin(o.lbc, 'LBC') })} · {t('market.sats', { n: significant(o.price, 4) })}
            </span>
            <span className="small text-2">
              {t('market.mine.left', { left: coin(o.left, 'LBC') })}
              {o.running > 0 && ` · ${t('market.mine.running', { count: o.running })}`}
            </span>
            {o.status === 'open' && (
              <span className="small text-2">{o.relays > 0 ? t('market.mine.onRelays', { count: o.relays, time: relativeTime(o.publishedAt) }) : t('market.mine.notYet')}</span>
            )}
          </div>
          <div className="stack tight" style={{ alignItems: 'flex-end' }}>
            <Badge tone={o.status === 'open' ? 'green' : 'amber'}>{t(`market.mine.status.${o.status}`)}</Badge>
            {o.status === 'open' && (
              <Button
                size="sm"
                variant="ghost"
                loading={busy === o.id}
                onClick={() => {
                  setBusy(o.id);
                  void window.lbc.market
                    .withdraw(o.id)
                    .catch((err) => toast({ kind: 'error', title: t('market.title'), message: errorMessage(err) }))
                    .finally(() => setBusy(null));
                }}
              >
                <XCircle size={15} /> {t('market.mine.withdraw')}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function tradeStatusText(t: Translate, trade: MarketTradeView): string {
  const params = { lbc: coin(trade.lbc, 'LBC'), btc: coin(trade.btc, 'BTC') };
  if (trade.status === 'declined') return t(`market.trade.declined.${trade.reason ?? 'closed'}`, params);
  return t(`market.trade.${trade.status}`, params);
}

function Trades({ trades, swaps }: { trades: MarketTradeView[]; swaps: SwapView[] }) {
  const t = useT();
  const toast = useApp((s) => s.toast);
  if (trades.length === 0) return null;
  return (
    <div className="card stack">
      <div className="card-header">
        <h3>{t('market.trades.title')}</h3>
      </div>
      {trades.map((trade) => {
        const swap = trade.swapId ? swaps.find((s) => s.id === trade.swapId) : undefined;
        const running = trade.status === 'waiting' || trade.status === 'invited' || trade.status === 'swapping';
        return (
          <div key={trade.id} className="stack tight" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div className="row wrap">
              <span className="row strong">
                {coin(trade.give === 'LBC' ? trade.lbc : trade.btc, trade.give)} <ArrowRight size={14} /> {coin(trade.get === 'LBC' ? trade.lbc : trade.btc, trade.get)}
              </span>
              <span className="small text-2">{relativeTime(trade.createdAt / 1000)}</span>
              <div className="spacer" />
              <Badge tone={tradeTone(trade.status)}>{t(`market.trade.status.${trade.status}`)}</Badge>
            </div>
            {trade.status === 'swapping' && swap ? (
              <SwapDetail swap={swap} onRemoved={() => undefined} automatic />
            ) : (
              <div className="small text-2">{tradeStatusText(t, trade)}</div>
            )}
            {trade.unsent && <div className="small text-2">{t('market.trade.unsent')}</div>}
            {!running && (
              <div className="row">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void window.lbc.market.dismiss(trade.id).catch((err) => toast({ kind: 'error', title: t('market.title'), message: errorMessage(err) }))}
                >
                  <Trash2 size={15} /> {t('market.trade.dismiss')}
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- the page

export function Market() {
  const t = useT();
  const settings = useApp((s) => s.settings)!;
  const accepted = settings.acceptedMarketTerms === MARKET_TERMS_VERSION;
  const [view, setView] = useState<MarketView | null>(null);
  const [swaps, setSwaps] = useState<SwapView[]>([]);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [taking, setTaking] = useState<MarketOfferView | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!accepted) return;
    let alive = true;
    // Asking again now and then keeps the board connected while this page is open.
    const load = () =>
      window.lbc.market.view().then(
        (v) => {
          if (!alive) return;
          setView(v);
          setError('');
        },
        (err) => alive && setError(errorMessage(err)),
      );
    void load();
    const timer = setInterval(() => void load(), 60_000);
    const offMarket = window.lbc.on('market:changed', (v) => alive && setView(v));
    void window.lbc.swap.list().then((list) => alive && setSwaps(list));
    const offSwap = window.lbc.on('swap:changed', (v) => setSwaps((list) => [v, ...list.filter((s) => s.id !== v.id)]));
    return () => {
      alive = false;
      clearInterval(timer);
      offMarket();
      offSwap();
    };
  }, [accepted]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t('market.title')}</h1>
          <div className="sub">{t('market.sub')}</div>
        </div>
        {accepted && (
          <div className="actions">
            <Button variant="primary" onClick={() => setPosting(true)}>
              <Plus size={16} /> {t('market.postOffer')}
            </Button>
          </div>
        )}
      </div>

      {!accepted ? (
        <MarketWarning />
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
          <div className="stack">
            <div className="card stack">
              <div className="card-header">
                <h3>{t('market.board')}</h3>
                <div className="spacer" />
                <Segmented
                  value={side}
                  options={[
                    { value: 'buy', label: t('market.buyLbc') },
                    { value: 'sell', label: t('market.sellLbc') },
                  ]}
                  onChange={setSide}
                />
              </div>
              {error && <Callout tone="warn">{error}</Callout>}
              {view ? <Board view={view} side={side} onTake={setTaking} /> : <Spinner />}
            </div>
            {view && <Trades trades={view.trades} swaps={swaps} />}
            <Callout tone="info" title={t('market.otherCoins.title')}>
              {t('market.otherCoins.text')}
            </Callout>
          </div>
          <div className="stack">
            <PriceCard price={view?.price ?? null} unavailable={!!view?.priceUnavailable} />
            {view && <MyOffers offers={view.mine} />}
            <Callout tone="warn" title={t('market.safety.title')}>
              {t('market.safety.text')}
            </Callout>
          </div>
        </div>
      )}

      {taking && view && <TakeDialog offer={taking} view={view} swaps={swaps} onClose={() => setTaking(null)} />}
      {posting && <PostDialog price={view?.price ?? null} onClose={() => setPosting(false)} />}
    </>
  );
}
