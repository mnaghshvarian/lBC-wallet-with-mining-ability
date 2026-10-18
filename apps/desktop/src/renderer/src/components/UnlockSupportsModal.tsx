import { useEffect, useState } from 'react';
import type { DraftView } from '../../../shared/api';
import { errorMessage } from '../store';
import { Button, Callout, Modal, Spinner } from './ui';
import { ReviewSend } from './ReviewSend';

export function UnlockSupportsModal({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void window.lbc.wallet
      .prepareUnlock()
      .then(setDraft)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (draft) return <ReviewSend draft={draft} label="Unlocked tips & supports" onClose={onClose} />;
  return (
    <Modal title="Unlock tips & supports" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      {error ? (
        <Callout tone="warn">{error}</Callout>
      ) : (
        <div className="row">
          <Spinner /> Preparing transaction…
        </div>
      )}
    </Modal>
  );
}
