import { useState } from 'react';
import { announce } from '../../components/Announcer';
import { Banner } from '../../components/Banner';
import { Button, type ButtonSize } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import type { OfflineDraftView } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { cx } from '../../utils/cx';
import styles from './offline.module.css';
import { mark, t } from '../../i18n';

type DraftKind = 'timer' | 'record' | 'unconfirmed' | 'draft';

function kindOf(draft: Pick<OfflineDraftView, 'status' | 'end'>): DraftKind {
  if (draft.status === 'Synced to 7pace') return 'record';
  if (draft.status === 'Check 7pace before retrying') return 'unconfirmed';
  return draft.end ? 'draft' : 'timer';
}

/** English (`mark`), translated where shown. */
const WORDING: Record<DraftKind, { title: string; action: string; opens: string; cancel: string; done: string }> = {
  timer: {
    title: mark('Delete this local timer?'),
    action: mark('Delete timer'),
    opens: mark('Delete timer…'),
    cancel: mark('Keep timer'),
    done: mark('Local timer deleted.'),
  },
  record: {
    title: mark('Delete this local record?'),
    action: mark('Delete record'),
    opens: mark('Delete record…'),
    cancel: mark('Keep record'),
    done: mark('Local record deleted.'),
  },
  unconfirmed: {
    title: mark('Delete this unconfirmed draft?'),
    action: mark('Delete draft'),
    opens: mark('Delete draft…'),
    cancel: mark('Keep draft'),
    done: mark('Draft deleted.'),
  },
  draft: {
    title: mark('Delete this draft?'),
    action: mark('Delete draft'),
    opens: mark('Delete draft…'),
    cancel: mark('Keep draft'),
    done: mark('Draft deleted.'),
  },
};

function description(kind: DraftKind, name: string): string {
  switch (kind) {
    case 'timer':
      return t('“{name}” is not saved and not uploaded to 7pace. This can’t be undone.', { name });
    case 'record':
      return t('Only the copy of “{name}” on this device is deleted. The entry stays in 7pace.', { name });
    case 'unconfirmed':
      // The upload's outcome is unknown: 7pace may have the entry. Deleting never touches 7pace.
      return t(
        'The upload of “{name}” wasn’t confirmed, so 7pace may already have it. Only the draft on this device is deleted; check 7pace for the entry. This can’t be undone.',
        { name },
      );
    case 'draft':
      return t('“{name}” is not uploaded to 7pace. This can’t be undone.', { name });
  }
}

/** The button label that opens the confirmation: "Delete timer…", "Delete draft…". */
export function deleteDraftLabel(draft: Pick<OfflineDraftView, 'status' | 'end'>): string {
  return t(WORDING[kindOf(draft)].opens);
}

/**
 * Moves focus after a deletion, once the confirmation (and an editor around it) has closed: a
 * deleted draft takes its row and the button that had focus with it, and an open dialog's focus
 * trap would pull earlier focus back in. Waits two frames, past React Aria's own restore.
 */
export function focusAfterDelete(target: () => HTMLElement | null | undefined) {
  const later = (step: () => void) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(step) : setTimeout(step, 16));
  later(() => later(() => target()?.focus()));
}

export interface DeleteDraftDialogProps {
  /** The draft to delete; `null` closes the dialog. */
  draft: Pick<OfflineDraftView, 'id' | 'status' | 'end'> | null;
  /** How the draft is named in the question ("#4821 · Checkout …"). */
  name: string;
  onClose: () => void;
  /** After the engine removed the draft (the dialog closes itself first). */
  onDeleted?: () => void;
}

/**
 * Confirms deleting an offline draft (`offline.remove`): a running local timer, a stopped draft
 * or the local record of an uploaded one. Nothing in 7pace changes. A failure stays in the
 * dialog so it can be retried or cancelled.
 */
export function DeleteDraftDialog({ draft, name, onClose, onDeleted }: DeleteDraftDialogProps) {
  const remove = useAction();
  // Keeps the wording while the dialog closes.
  const [last, setLast] = useState(draft);
  if (draft && draft !== last) setLast(draft);
  const subject = draft ?? last;
  const kind = subject ? kindOf(subject) : 'draft';
  const wording = WORDING[kind];
  return (
    <Dialog
      isOpen={draft !== null}
      onOpenChange={(open) => {
        if (open) return;
        remove.clearError();
        onClose();
      }}
      role="alertdialog"
      size="small"
      title={t(wording.title)}
      description={description(kind, name)}
      cancelLabel={t(wording.cancel)}
      primaryAction={{
        label: t(wording.action),
        variant: 'destructive',
        isPending: remove.pending,
        onAction: () => {
          if (!draft || remove.pending) return;
          void remove.run({ type: 'offline.remove', draftId: draft.id }).then((result) => {
            if (!result.ok) return;
            onClose();
            announce(t(wording.done));
            onDeleted?.();
          });
        },
      }}
    >
      {remove.error ? <Banner tone="error">{remove.error.message}</Banner> : null}
    </Dialog>
  );
}

export interface DeleteDraftButtonProps {
  draft: Pick<OfflineDraftView, 'id' | 'status' | 'end'>;
  /** How the draft is named in the question and the button's accessible name. */
  name: string;
  /** The visible label; defaults to "Delete draft…" (or timer, record). */
  label?: string;
  isDisabled?: boolean;
  size?: ButtonSize;
  className?: string;
  onDeleted?: () => void;
}

/** A "Delete draft…" button with its confirmation, for any offline draft. */
export function DeleteDraftButton({ draft, name, label, isDisabled = false, size = 'small', className, onDeleted }: DeleteDraftButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const visible = label ?? deleteDraftLabel(draft);
  return (
    <>
      <Button
        size={size}
        variant="plain"
        className={cx(styles.danger, className)}
        isDisabled={isDisabled}
        onPress={() => setConfirming(true)}
        aria-label={`${visible.replace(/…$/, '')}, ${name}`}
      >
        {visible}
      </Button>
      <DeleteDraftDialog draft={confirming ? draft : null} name={name} onClose={() => setConfirming(false)} onDeleted={onDeleted} />
    </>
  );
}
