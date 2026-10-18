import { useEffect, useState } from 'react';
import { ArrowUpRight, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useApp, useT, errorMessage } from '../store';
import { Button, Empty, Field, IconButton, Modal } from '../components/ui';
import { AddressText } from '../components/display';
import type { Contact } from '@lbcwallet/services/api';

export function Contacts() {
  const t = useT();
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
          <h1>{t('nav.contacts')}</h1>
          <div className="sub">{t('contacts.sub')}</div>
        </div>
        <div className="actions">
          <Button variant="primary" onClick={() => setEditing({})}>
            <Plus size={16} /> {t('contacts.add')}
          </Button>
        </div>
      </div>
      <div className="card">
        {contacts.length === 0 ? (
          <Empty icon={<Users size={22} />} title={t('contacts.empty')}>
            {t('contacts.emptyText')}
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
                  <ArrowUpRight size={15} /> {t('nav.send')}
                </Button>
                <IconButton label={t('common.edit')} onClick={() => setEditing(c)}>
                  <Pencil size={15} />
                </IconButton>
                <IconButton label={t('common.delete')} onClick={async () => setContacts(await window.lbc.wallet.deleteContact(c.id))}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <Modal
          title={editing.id ? t('contacts.editTitle') : t('contacts.newTitle')}
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" onClick={() => void save()} disabled={!editing.name?.trim() || !editing.address?.trim()}>
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div className="stack">
            <Field label={t('contacts.name')}>
              <input className="input" value={editing.name ?? ''} maxLength={80} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </Field>
            <Field label={t('contacts.address')} error={error || undefined}>
              <input className="input mono" value={editing.address ?? ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} spellCheck={false} />
            </Field>
            <Field label={t('contacts.note')}>
              <input className="input" value={editing.note ?? ''} maxLength={500} onChange={(e) => setEditing({ ...editing, note: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
