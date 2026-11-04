import { useState } from 'react';
import { announce } from '../../components/Announcer';
import { Button, type ButtonSize } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { useAction } from '../../state/hooks';
import { cx } from '../../utils/cx';
import styles from './tracking.module.css';

export interface DeleteLocalTimerProps {
  /** The running local timer's draft (`offline.active.id`, `tracking.local.draftId`). */
  draftId: string;
  isDisabled?: boolean;
  size?: ButtonSize;
  className?: string;
}

/**
 * "Delete timer…" for the running local (offline) timer: after a confirmation the draft is
 * removed without saving its time. Nothing in 7pace changes. Used on Offline drafts, the
 * Overview and the tray panel.
 */
export function DeleteLocalTimer({ draftId, isDisabled = false, size, className }: DeleteLocalTimerProps) {
  const remove = useAction();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        variant="plain"
        size={size}
        className={cx(styles.danger, className)}
        isDisabled={isDisabled}
        onPress={() => {
          remove.clearError();
          setConfirming(true);
        }}
      >
        Delete timer…
      </Button>
      <Dialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        role="alertdialog"
        size="small"
        title="Delete this local timer?"
        description="Its time is not saved and not uploaded to 7pace. Your 7pace timer is not changed."
        cancelLabel="Keep timer"
        primaryAction={{
          label: 'Delete timer',
          variant: 'destructive',
          isPending: remove.pending,
          onAction: () =>
            void remove.run({ type: 'offline.remove', draftId }).then((result) => {
              setConfirming(false);
              if (result.ok) announce('Local timer deleted.');
            }),
        }}
      />
      {remove.error ? (
        <p role="alert" className={styles.warning}>
          {remove.error.message}
        </p>
      ) : null}
    </>
  );
}
