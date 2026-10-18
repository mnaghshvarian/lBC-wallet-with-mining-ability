import { useEffect, useState } from 'react';
import type { DraftView } from '@lbcwallet/services/api';
import { errorMessage, useT } from '../store';
import { Button, Callout, Modal, Spinner } from './ui';
import { ReviewSend } from './ReviewSend';

export function UnlockSupportsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void window.lbc.wallet
      .prepareUnlock()
      .then(setDraft)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (draft) return <ReviewSend draft={draft} label={t('tx.unlock')} onClose={onClose} />;
  return (
    <Modal title={t('unlock.title')} onClose={onClose} footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      {error ? (
        <Callout tone="warn">{error}</Callout>
      ) : (
        <div className="row">
          <Spinner /> {t('unlock.preparing')}
        </div>
      )}
    </Modal>
  );
}
