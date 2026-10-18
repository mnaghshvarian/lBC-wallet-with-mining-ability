import { useEffect, useState } from 'react';
import { Copy, Pencil, RefreshCw } from 'lucide-react';
import { useApp, useT, errorMessage } from '../store';
import { Badge, Button, Callout, CopyButton, Field, IconButton, Modal, Segmented } from '../components/ui';
import { AddressText, Amount, QrCode } from '../components/display';
import type { AddressView } from '@lbcwallet/services/api';

export function Receive() {
  const t = useT();
  const overview = useApp((s) => s.overview)!;
  const version = useApp((s) => s.version);
  const toast = useApp((s) => s.toast);
  const [addresses, setAddresses] = useState<AddressView[]>([]);
  const [filter, setFilter] = useState<'receive' | 'change'>('receive');
  const [editing, setEditing] = useState<AddressView | null>(null);
  const [labelText, setLabelText] = useState('');
  const address = overview.receiveAddress;

  useEffect(() => {
    let alive = true;
    void window.lbc.wallet.addresses().then((a) => alive && setAddresses(a));
    return () => {
      alive = false;
    };
  }, [version, address]);

  const current = addresses.find((a) => a.address === address);
  const shown = addresses.filter((a) => (filter === 'receive' ? a.chain === 0 : a.chain === 1)).filter((a) => a.used || a.label || a.address === address);

  const newAddress = async () => {
    try {
      const r = await window.lbc.wallet.newAddress();
      if (r.atLimit) toast({ kind: 'error', title: t('receive.limitTitle'), message: t('receive.limitText') });
    } catch (err) {
      toast({ kind: 'error', title: t('receive.newFailed'), message: errorMessage(err) });
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t('receive.title')}</h1>
          <div className="sub">{t('receive.sub')}</div>
        </div>
      </div>

      <div className="card">
        <div className="row receive-hero" style={{ gap: 28, alignItems: 'flex-start' }}>
          <QrCode value={address} />
          <div className="stack" style={{ flex: 1, minWidth: 0 }}>
            <div className="row">
              <div className="label">{t('receive.yourAddress')}</div>
              {current?.label && <Badge tone="blue">{current.label}</Badge>}
            </div>
            <div className="address-box">
              <AddressText address={address} />
            </div>
            <div className="row wrap">
              <CopyButton text={address} label={t('receive.copyAddress')} />
              <Button size="sm" onClick={() => void newAddress()}>
                <RefreshCw size={15} /> {t('receive.newAddress')}
              </Button>
              {current && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(current);
                    setLabelText(current.label ?? '');
                  }}
                >
                  <Pencil size={15} /> {t('receive.label')}
                </Button>
              )}
            </div>
            <Callout>{t('receive.privacyTip')}</Callout>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <h3>{t('receive.addresses')}</h3>
          <div className="spacer" />
          <Segmented
            value={filter}
            options={[
              { value: 'receive', label: t('receive.receiving') },
              { value: 'change', label: t('review.change') },
            ]}
            onChange={setFilter}
          />
        </div>
        {shown.length === 0 ? (
          <div className="muted small">{t('receive.none')}</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('receive.address')}</th>
                <th>{t('receive.label')}</th>
                <th style={{ textAlign: 'end' }}>{t('receive.balance')}</th>
                <th style={{ textAlign: 'end' }}>{t('receive.txs')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.address}>
                  <td className="muted">{a.index}</td>
                  <td>
                    <AddressText address={a.address} short />
                    {a.address === address && (
                      <span style={{ marginInlineStart: 8 }}>
                        <Badge tone="green">{t('receive.current')}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="ellipsis" style={{ maxWidth: 180 }}>
                    {a.label ?? <span className="muted">—</span>}
                  </td>
                  <td style={{ textAlign: 'end' }}>
                    <Amount dewies={a.balance} decimals={4} />
                  </td>
                  <td style={{ textAlign: 'end' }}>{a.txCount}</td>
                  <td style={{ textAlign: 'end' }}>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                      <IconButton label={t('common.copy')} onClick={() => void window.lbc.app.copy(a.address).then(() => toast({ kind: 'confirmed', title: t('receive.copied') }))}>
                        <Copy size={15} />
                      </IconButton>
                      <IconButton
                        label={t('receive.editLabel')}
                        onClick={() => {
                          setEditing(a);
                          setLabelText(a.label ?? '');
                        }}
                      >
                        <Pencil size={15} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <Modal
          title={t('receive.labelTitle')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  await window.lbc.wallet.setLabel(editing.address, labelText);
                  setEditing(null);
                }}
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div className="stack">
            <div className="mono small break muted">{editing.address}</div>
            <Field label={t('receive.labelField')}>
              <input className="input" value={labelText} maxLength={200} onChange={(e) => setLabelText(e.target.value)} autoFocus placeholder={t('receive.labelPlaceholder')} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
