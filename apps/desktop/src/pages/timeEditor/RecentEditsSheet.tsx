import { useState } from 'react';
import { Badge } from '../../components/Badge';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Heading } from '../../components/Card';
import { Dialog } from '../../components/Dialog';
import { ExternalLinkIcon, SuccessIcon, WarningIcon } from '../../components/icons';
import type { WorkLogChange } from '../../ipc/contract';
import { formatDateTime, formatInstant, parseInstant, ticketPrefix } from '../../features/ticketContext/format';
import { isOpenableUrl, openExternalUrl } from '../../features/ticketContext/native';
import { useAction } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import { STATUS_LABELS } from './labels';
import styles from './TimeEditor.module.css';

const PAGE_SIZE = 20;

function ChangeCard({
  change,
  requiresReview,
  disabled,
  workspaceUrl,
  onUndo,
}: {
  change: WorkLogChange;
  requiresReview: boolean;
  disabled: boolean;
  workspaceUrl: string | null;
  onUndo: (change: WorkLogChange) => void;
}) {
  const acknowledge = useAction();
  const [openFailure, setOpenFailure] = useState<string | null>(null);
  const status = STATUS_LABELS[change.status];
  const needsReview = change.status === 'needsReview' || change.status === 'applying';
  const created = change.after.filter((after) => !change.before.some((before) => before.id === after.id));
  return (
    <li className={needsReview ? `${styles.changeCard} ${styles.changeNeedsReview}` : styles.changeCard}>
      <div className={styles.changeHeader}>
        <Heading level={3} className={styles.groupTitle}>
          {change.title}
        </Heading>
        <span className={styles.caption}>{formatInstant(change.date)}</span>
      </div>
      <div>
        <Badge tone={status.tone} icon={needsReview ? WarningIcon : change.status === 'complete' ? SuccessIcon : undefined}>
          {status.label}
        </Badge>
      </div>
      {change.detail ? <p className={styles.selectable}>{change.detail}</p> : null}
      <details className={styles.disclosure}>
        <summary>Affected entries</summary>
        <ul role="list" className={styles.disclosureList}>
          {change.before.map((entry) => (
            <li key={entry.id} className={styles.selectable}>
              {`${ticketPrefix(entry.workItemId)}${entry.timestamp} · ${formatShortDuration(entry.length)}`}
              <br />
              <span className={styles.caption}>{entry.id}</span>
            </li>
          ))}
          {created.map((entry) => (
            <li key={`created-${entry.id}`} className={styles.selectable}>
              {`Created: ${entry.id}`}
            </li>
          ))}
          {change.before.length === 0 && created.length === 0 ? <li className={styles.caption}>No entries recorded.</li> : null}
        </ul>
      </details>
      <details className={styles.disclosure}>
        <summary>Planned result</summary>
        <ul role="list" className={styles.disclosureList}>
          {change.desired.map((draft, index) => {
            const start = parseInstant(draft.start);
            const end = start ? new Date(start.getTime() + draft.seconds * 1000) : null;
            return (
              <li key={`${draft.existingId ?? 'new'}-${index}`} className={styles.selectable}>
                {`${draft.ticketId ? `#${draft.ticketId} · ` : 'No Azure ticket · '}${formatDateTime(start)} → ${formatDateTime(end)}${
                  draft.comment ? ` · ${draft.comment}` : ''
                }`}
              </li>
            );
          })}
          {change.desired.length === 0 ? <li className={styles.caption}>No planned entries recorded.</li> : null}
        </ul>
      </details>
      {change.status === 'complete' ? (
        <div className={styles.actions}>
          <Button isDisabled={requiresReview || disabled} onPress={() => onUndo(change)}>
            Undo…
          </Button>
        </div>
      ) : null}
      {needsReview ? (
        <>
          <p className={styles.caption}>
            Compare the affected entries in 7pace before acknowledging. This acknowledgment does not undo or retry anything.
          </p>
          <div className={styles.actions}>
            {workspaceUrl && isOpenableUrl(workspaceUrl) ? (
              <Button
                variant="plain"
                trailingIcon={ExternalLinkIcon}
                onPress={() => {
                  setOpenFailure(null);
                  openExternalUrl(workspaceUrl).catch((error: unknown) => setOpenFailure(error instanceof Error ? error.message : String(error)));
                }}
              >
                Open 7pace
              </Button>
            ) : null}
            <Button
              variant="primary"
              isDisabled={disabled}
              isPending={acknowledge.pending}
              onPress={() => void acknowledge.run({ type: 'timeEditor.acknowledge', changeId: change.id })}
            >
              I checked the entries in 7pace
            </Button>
          </div>
          {acknowledge.error ? <Banner tone="error">{acknowledge.error.message}</Banner> : null}
          {openFailure ? <Banner tone="warning">{openFailure}</Banner> : null}
        </>
      ) : null}
    </li>
  );
}

export interface RecentEditsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  changes: readonly WorkLogChange[];
  requiresReview: boolean;
  journalIssue: string | null;
  disabled: boolean;
  device: string;
  workspaceUrl: string | null;
}

/** The recovery journal, newest first (1.14 `recentEdits`). */
export function RecentEditsSheet({ isOpen, onClose, changes, requiresReview, journalIssue, disabled, device, workspaceUrl }: RecentEditsSheetProps) {
  const undo = useAction();
  const [visible, setVisible] = useState(PAGE_SIZE);
  const shown = changes.slice(0, visible);
  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Recent edits"
      description={`Changes made on ${device}, for this 7pace workspace.`}
      presentation="sheet"
      size="large"
      cancelLabel="Done"
    >
      <div className={styles.sheetBody}>
        {requiresReview ? (
          <Banner tone="warning" title="A change needs review" live="off">
            Check the entries of the change marked “Needs review” in 7pace, then acknowledge it. Other edits are blocked until then.
          </Banner>
        ) : null}
        {journalIssue ? (
          <Banner tone="warning" live="off">
            {journalIssue}
          </Banner>
        ) : null}
        {undo.error ? <Banner tone="error">{undo.error.message}</Banner> : null}
        {changes.length === 0 ? (
          <p className={styles.caption}>Your confirmed edits, splits and merges will appear here.</p>
        ) : (
          <ol role="list" className={styles.changeList}>
            {shown.map((change) => (
              <ChangeCard
                key={change.id}
                change={change}
                requiresReview={requiresReview}
                disabled={disabled}
                workspaceUrl={workspaceUrl}
                onUndo={(record) => {
                  void undo.run({ type: 'timeEditor.beginUndo', changeId: record.id }).then((result) => {
                    if (result.ok) onClose();
                  });
                }}
              />
            ))}
          </ol>
        )}
        {changes.length > shown.length ? (
          <div className={styles.actions}>
            <span className={styles.caption}>{`Showing ${shown.length} of ${changes.length} changes`}</span>
            <Button onPress={() => setVisible((count) => count + PAGE_SIZE)}>Show more</Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
