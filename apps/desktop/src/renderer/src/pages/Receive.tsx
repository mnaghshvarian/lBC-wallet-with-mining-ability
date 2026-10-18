import { useEffect, useState } from 'react';
import { Copy, Pencil, RefreshCw } from 'lucide-react';
import { useApp, errorMessage } from '../store';
import { Badge, Button, Callout, CopyButton, Field, IconButton, Modal, Segmented } from '../components/ui';
import { AddressText, Amount, QrCode } from '../components/display';
import type { AddressView } from '../../../shared/api';

export function Receive() {
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
      if (r.atLimit) toast({ kind: 'error', title: 'Address limit reached', message: 'You already have 20 unused addresses. Use one of them first so a restore can still find all your funds.' });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not create address', message: errorMessage(err) });
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Receive LBC</h1>
          <div className="sub">Share this address or QR code with the sender.</div>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 28, alignItems: 'flex-start' }}>
          <QrCode value={address} />
          <div className="stack" style={{ flex: 1, minWidth: 0 }}>
            <div className="row">
              <div className="label">Your receiving address</div>
              {current?.label && <Badge tone="blue">{current.label}</Badge>}
            </div>
            <div className="address-box">
              <AddressText address={address} />
            </div>
            <div className="row wrap">
              <CopyButton text={address} label="Copy address" />
              <Button size="sm" onClick={() => void newAddress()}>
                <RefreshCw size={15} /> New address
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
                  <Pencil size={15} /> Label
                </Button>
              )}
            </div>
            <Callout>
              Use a fresh address for each payment for better privacy — all of your addresses stay valid forever. Mining payouts and tips sent here appear automatically.
            </Callout>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <h3>Addresses</h3>
          <div className="spacer" />
          <Segmented
            value={filter}
            options={[
              { value: 'receive', label: 'Receiving' },
              { value: 'change', label: 'Change' },
            ]}
            onChange={setFilter}
          />
        </div>
        {shown.length === 0 ? (
          <div className="muted small">No addresses with activity yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Address</th>
                <th>Label</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
                <th style={{ textAlign: 'right' }}>Txs</th>
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
                      <span style={{ marginLeft: 8 }}>
                        <Badge tone="green">Current</Badge>
                      </span>
                    )}
                  </td>
                  <td className="ellipsis" style={{ maxWidth: 180 }}>
                    {a.label ?? <span className="muted">—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Amount dewies={a.balance} decimals={4} />
                  </td>
                  <td style={{ textAlign: 'right' }}>{a.txCount}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 2 }}>
                      <IconButton label="Copy" onClick={() => void window.lbc.app.copy(a.address).then(() => toast({ kind: 'confirmed', title: 'Address copied' }))}>
                        <Copy size={15} />
                      </IconButton>
                      <IconButton
                        label="Edit label"
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
          title="Address label"
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  await window.lbc.wallet.setLabel(editing.address, labelText);
                  setEditing(null);
                }}
              >
                Save
              </Button>
            </>
          }
        >
          <div className="stack">
            <div className="mono small break muted">{editing.address}</div>
            <Field label="Label (only visible to you)">
              <input className="input" value={labelText} maxLength={200} onChange={(e) => setLabelText(e.target.value)} autoFocus placeholder="e.g. Mining payouts" />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
