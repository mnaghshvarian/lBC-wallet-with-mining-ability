import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useApp, useT } from '../store';
import { fiat, lbc, shortAddress } from '../lib/format';

/** LBC amount that respects "hide balances", with optional fiat line. */
export function Amount({ dewies, sign, showFiat, className = '', decimals }: { dewies: string; sign?: boolean; showFiat?: boolean; className?: string; decimals?: number }) {
  const hide = useApp((s) => s.settings?.hideBalances ?? false);
  const price = useApp((s) => s.price);
  if (hide) return <span className={className}>••••••</span>;
  const f = showFiat ? fiat(dewies, price) : null;
  return (
    <span className={className}>
      <bdi dir="ltr">{lbc(dewies, { sign, decimals })}</bdi> LBC
      {f && <span className="fiat"> · {f}</span>}
    </span>
  );
}

export function FiatValue({ dewies }: { dewies: string }) {
  const hide = useApp((s) => s.settings?.hideBalances ?? false);
  const price = useApp((s) => s.price);
  const f = fiat(dewies, price);
  if (!f) return null;
  return <span>{hide ? '••••' : f}</span>;
}

export function AddressText({ address, short, className = '' }: { address: string; short?: boolean; className?: string }) {
  return (
    <span className={`mono selectable ${className}`} title={address}>
      {short ? shortAddress(address) : address}
    </span>
  );
}

export function QrCode({ value, size = 196 }: { value: string; size?: number }) {
  const t = useT();
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    void QRCode.toDataURL(value, { margin: 0, width: size * 2, errorCorrectionLevel: 'M', color: { dark: '#0a0f1e', light: '#ffffff' } }).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return <div className="qr">{src ? <img src={src} alt={t('receive.qrAlt', { address: value })} style={{ width: size, height: size }} /> : <div style={{ width: size, height: size }} />}</div>;
}

export function Sparkline({ points, height = 64 }: { points: { t: number; v: number }[]; height?: number }) {
  const t = useT();
  const width = 600;
  const path = useMemo(() => {
    if (points.length < 2) return null;
    const t0 = points[0]!.t;
    const t1 = points[points.length - 1]!.t;
    const max = Math.max(...points.map((p) => p.v), 1);
    const xy = points.map((p) => [((p.t - t0) / Math.max(1, t1 - t0)) * width, height - 4 - (p.v / max) * (height - 10)] as const);
    const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    return { line, area: `${line} L${width},${height} L0,${height} Z` };
  }, [points, height]);
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      {path ? (
        <>
          <path className="area" d={path.area} />
          <path className="line" d={path.line} vectorEffect="non-scaling-stroke" />
        </>
      ) : (
        <text x={width / 2} y={height / 2 + 4} textAnchor="middle" fill="var(--text-3)" fontSize="13">
          {t('mining.historyEmpty')}
        </text>
      )}
    </svg>
  );
}
