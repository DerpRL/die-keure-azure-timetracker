import { useId, useState } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card, Heading } from '../../components/Card';
import { Dialog } from '../../components/Dialog';
import { SuccessIcon, WarningIcon } from '../../components/icons';
import type { ActivityType, OfflineReview } from '../../ipc/contract';
import { formatClockTimeWithSeconds, formatDateTime, formatDayShort, parseInstant, ticketPrefix } from '../../features/ticketContext/format';
import { useAction } from '../../state/hooks';
import { formatClock, formatShortDuration } from '../../utils/duration';
import { draftTitle } from './labels';
import styles from './OfflineDrafts.module.css';

function preciseTime(value: string | null | undefined): string {
  const date = parseInstant(value);
  return date ? `${formatDayShort(date)}, ${formatClockTimeWithSeconds(date)}` : 'Running';
}

export interface ReviewCardProps {
  review: OfflineReview;
  activities: readonly ActivityType[];
  disabled: boolean;
}

/** The result of `offline.review`: overlaps, matching entries and the upload (1.14 `reviewCard`). */
export function ReviewCard({ review, activities, disabled }: ReviewCardProps) {
  const upload = useAction();
  const link = useAction();
  const retry = useAction();
  const [confirmUpload, setConfirmUpload] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const headingId = useId();
  const { draft, conflicts, overlapIssue, matches } = review;
  const activity = activities.find((entry) => entry.id === draft.activityId)?.name;
  const start = parseInstant(draft.start);
  const end = parseInstant(draft.end);
  const seconds = start && end ? (end.getTime() - start.getTime()) / 1000 : 0;
  const clean = conflicts.length === 0 && !overlapIssue;
  const uploadLabel = clean ? 'Upload draft to 7pace' : 'Upload with overlap warning';
  const sending = draft.status === 'Check 7pace before retrying';
  const failure = upload.error ?? link.error ?? retry.error ?? null;

  return (
    <Card as="section" aria-labelledby={headingId} className={styles.review}>
      <Heading level={2} id={headingId} className={styles.sectionTitle}>
        {`Review ${draftTitle(draft)}`}
      </Heading>
      <p className={styles.caption}>Uploads belong to your currently signed-in 7pace account.</p>
      <p>{`Activity: ${activity ?? 'Choose an activity by editing this draft'}`}</p>
      <p className={styles.mono}>{`${preciseTime(draft.start)} → ${preciseTime(draft.end)}`}</p>
      <p>{`${draft.billable ? 'Billable' : 'Non-billable'} · ${formatClock(seconds)}`}</p>
      {draft.comment ? <p className={styles.caption}>{draft.comment}</p> : null}

      <div role="status" className={styles.reviewResult}>
        {overlapIssue ? (
          <p className={styles.warningLine}>
            <WarningIcon className={styles.warningIcon} />
            {`Overlap check incomplete: ${overlapIssue}`}
          </p>
        ) : null}
        {conflicts.length > 0 ? (
          <>
            <p className={styles.warningLine}>
              <WarningIcon className={styles.warningIcon} />
              Overlapping time · uploading is still allowed
            </p>
            <ul role="list" className={styles.conflicts}>
              {conflicts.map((conflict) => (
                <li key={conflict.id}>
                  {`${ticketPrefix(conflict.ticketId)}${conflict.title} · ${formatDateTime(parseInstant(conflict.start))} → ${formatDateTime(
                    parseInstant(conflict.end),
                  )} · ${formatShortDuration(conflict.overlap)}${conflict.active ? ' · timer running' : ''}`}
                </li>
              ))}
            </ul>
          </>
        ) : !overlapIssue ? (
          <p className={styles.successLine}>
            <SuccessIcon className={styles.successIcon} />
            No overlapping entries found
          </p>
        ) : null}
      </div>

      {matches.length > 0 ? (
        <>
          <p>Matching entries already exist. Link the correct entry to resolve this draft without adding more time.</p>
          <div className={styles.actions}>
            {matches.map((log) => (
              <Button
                key={log.id}
                isDisabled={disabled}
                isPending={link.pending}
                onPress={() => void link.run({ type: 'offline.link', logId: log.id })}
              >
                {`Link existing entry ${log.id}`}
              </Button>
            ))}
          </div>
        </>
      ) : sending ? (
        <>
          <p className={styles.warningLine}>
            <WarningIcon className={styles.warningIcon} />
            The previous upload may have reached 7pace. No matching entry was found. Check 7pace manually before allowing a retry.
          </p>
          <div className={styles.actions}>
            <Button isDisabled={disabled} onPress={() => setConfirmRetry(true)}>
              I checked 7pace…
            </Button>
          </div>
        </>
      ) : (
        <div className={styles.actions}>
          <Button variant="primary" isDisabled={disabled} onPress={() => setConfirmUpload(true)}>
            {uploadLabel}
          </Button>
        </div>
      )}
      {failure ? <Banner tone="error">{failure.message}</Banner> : null}

      <Dialog
        isOpen={confirmUpload}
        onOpenChange={setConfirmUpload}
        role="alertdialog"
        size="small"
        title="Upload this draft to 7pace?"
        description={`A ${formatShortDuration(seconds)} entry is created in your 7pace account${
          draft.ticketId ? ` for #${draft.ticketId}` : ''
        }. If the upload is interrupted, the draft stays locked until you check 7pace.`}
        primaryAction={{
          label: uploadLabel,
          isDisabled: disabled,
          isPending: upload.pending,
          onAction: () => {
            void upload.run({ type: 'offline.upload' }).then(() => setConfirmUpload(false));
          },
        }}
      />
      <Dialog
        isOpen={confirmRetry}
        onOpenChange={setConfirmRetry}
        role="alertdialog"
        size="small"
        title="Allow another review?"
        description="Only unlock this draft after checking 7pace and confirming that the upload did not create an entry."
        primaryAction={{
          label: 'I checked 7pace — allow another review',
          isDisabled: disabled,
          isPending: retry.pending,
          onAction: () => {
            void retry.run({ type: 'offline.allowRetryAfterManualCheck' }).then(() => setConfirmRetry(false));
          },
        }}
      />
    </Card>
  );
}
