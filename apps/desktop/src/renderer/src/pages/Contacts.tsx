import { useEffect, useState } from 'react';
import { ArrowUpRight, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useApp, errorMessage } from '../store';
import { Button, Empty, Field, IconButton, Modal } from '../components/ui';
import { AddressText } from '../components/display';
import type { Contact } from '../../../shared/api';

export function Contacts() {
  const navigate = useApp((s) => s.navigate);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editing, setEditing] = useState<Partial<Contact> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void window.lbc.wallet.contacts().then(setContacts);
  }, []);

  const save = async () => {
    setError('');
    try {
      setContacts(await window.lbc.wallet.saveContact({ id: editing!.id, name: editing!.name ?? '', address: editing!.address ?? '', note: editing!.note }));
      setEditing(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Contacts</h1>
          <div className="sub">Saved addresses, encrypted inside this wallet.</div>
        </div>
        <div className="actions">
          <Button variant="primary" onClick={() => setEditing({})}>
            <Plus size={16} /> Add contact
          </Button>
        </div>
      </div>
      <div className="card">
        {contacts.length === 0 ? (
          <Empty icon={<Users size={22} />} title="No contacts yet">
            Save addresses you pay often — exchanges, friends, your mining rig.
          </Empty>
        ) : (
          <div className="list">
            {contacts.map((c) => (
              <div key={c.id} className="list-row" style={{ cursor: 'default' }}>
                <div className="wallet-avatar">{c.name.slice(0, 1).toUpperCase()}</div>
                <div className="tx-main">
                  <div className="tx-title">{c.name}</div>
                  <div className="tx-sub">
                    <AddressText address={c.address} />
                  </div>
                  {c.note && <div className="small muted">{c.note}</div>}
                </div>
                <Button size="sm" onClick={() => navigate({ name: 'send', to: c.address })}>
                  <ArrowUpRight size={15} /> Send
                </Button>
                <IconButton label="Edit" onClick={() => setEditing(c)}>
                  <Pencil size={15} />
                </IconButton>
                <IconButton label="Delete" onClick={async () => setContacts(await window.lbc.wallet.deleteContact(c.id))}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <Modal
          title={editing.id ? 'Edit contact' : 'New contact'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void save()} disabled={!editing.name?.trim() || !editing.address?.trim()}>
                Save
              </Button>
            </>
          }
        >
          <div className="stack">
            <Field label="Name">
              <input className="input" value={editing.name ?? ''} maxLength={80} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </Field>
            <Field label="LBC address" error={error || undefined}>
              <input className="input mono" value={editing.address ?? ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} spellCheck={false} />
            </Field>
            <Field label="Note (optional)">
              <input className="input" value={editing.note ?? ''} maxLength={500} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
