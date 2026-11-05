import { useState } from 'react';
import { announce } from '../../components/Announcer';
import { Banner } from '../../components/Banner';
import { Button, type ButtonSize } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import type { OfflineDraftView } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { cx } from '../../utils/cx';
import styles from './offline.module.css';

type DraftKind = 'timer' | 'record' | 'unconfirmed' | 'draft';

function kindOf(draft: Pick<OfflineDraftView, 'status' | 'end'>): DraftKind {
  if (draft.status === 'Synced to 7pace') return 'record';
  if (draft.status === 'Check 7pace before retrying') return 'unconfirmed';
  return draft.end ? 'draft' : 'timer';
}

const WORDING: Record<DraftKind, { title: string; action: string; cancel: string; done: string }> = {
  timer: { title: 'Delete this local timer?', action: 'Delete timer', cancel: 'Keep timer', done: 'Local timer deleted.' },
  record: { title: 'Delete this local record?', action: 'Delete record', cancel: 'Keep record', done: 'Local record deleted.' },
  unconfirmed: { title: 'Delete this unconfirmed draft?', action: 'Delete draft', cancel: 'Keep draft', done: 'Draft deleted.' },
  draft: { title: 'Delete this draft?', action: 'Delete draft', cancel: 'Keep draft', done: 'Draft deleted.' },
};

function description(kind: DraftKind, name: string): string {
  switch (kind) {
    case 'timer':
      return `“${name}” is not saved and not uploaded to 7pace. This can’t be undone.`;
    case 'record':
      return `Only the copy of “${name}” on this device is deleted. The entry stays in 7pace.`;
    case 'unconfirmed':
      // The upload's outcome is unknown: 7pace may have the entry. Deleting never touches 7pace.
      return `The upload of “${name}” wasn’t confirmed, so 7pace may already have it. Only the draft on this device is deleted; check 7pace for the entry. This can’t be undone.`;
    case 'draft':
      return `“${name}” is not uploaded to 7pace. This can’t be undone.`;
  }
}

/** The button label that opens the confirmation: "Delete timer…", "Delete draft…". */
export function deleteDraftLabel(draft: Pick<OfflineDraftView, 'status' | 'end'>): string {
  return `${WORDING[kindOf(draft)].action}…`;
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
      title={wording.title}
      description={description(kind, name)}
      cancelLabel={wording.cancel}
      primaryAction={{
        label: wording.action,
        variant: 'destructive',
        isPending: remove.pending,
        onAction: () => {
          if (!draft || remove.pending) return;
          void remove.run({ type: 'offline.remove', draftId: draft.id }).then((result) => {
            if (!result.ok) return;
            onClose();
            announce(wording.done);
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
