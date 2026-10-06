import type { ZonedDateTime } from '@internationalized/date';
import { useState } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Heading } from '../../components/Card';
import { TimeField } from '../../components/DateFields';
import { Dialog } from '../../components/Dialog';
import { SuccessIcon, WarningIcon } from '../../components/icons';
import { ProgressBar } from '../../components/Progress';
import type { CorrectionChoices, TimeCorrectionIssue, WorkItemsSlice, WorkLog } from '../../ipc/contract';
import { formatDayComplete, formatTimeRange, parseInstant, secondsBetween, toZoned } from '../../features/ticketContext/format';
import { useAction } from '../../state/hooks';
import { formatShortDuration } from '../../utils/duration';
import { CORRECTION_OPTIONS, correctionIssueId } from './labels';
import styles from './TimeEditor.module.css';

function entryTitle(log: WorkLog, items: WorkItemsSlice | undefined): string {
  const ticket = typeof log.workItemId === 'number' && log.workItemId > 0 ? log.workItemId : null;
  const name =
    ticket !== null ? `#${ticket} · ${items?.[String(ticket)]?.title ?? 'Azure task'}` : log.comment?.trim() || 'Tracked time';
  return `${name} · ${log.activityType?.name ?? 'Activity'}`;
}

function midpoint(issue: TimeCorrectionIssue): ZonedDateTime | null {
  const start = parseInstant(issue.start);
  const end = parseInstant(issue.end);
  if (!start || !end) return null;
  return toZoned(new Date((start.getTime() + end.getTime()) / 2).toISOString());
}

function IssueCard({
  issue,
  options,
  items,
  disabled,
  onPrepare,
}: {
  issue: TimeCorrectionIssue;
  /** The options with a valid plan (from the engine). */
  options: readonly string[];
  items: WorkItemsSlice | undefined;
  disabled: boolean;
  onPrepare: (option: string, boundary?: string) => void;
}) {
  const [boundary, setBoundary] = useState<ZonedDateTime | null>(() => midpoint(issue));
  const offered = (option: string) => !disabled && options.includes(option);
  const seconds = secondsBetween(issue.start, issue.end);
  const gap = issue.kind === 'gap';
  const title = `${gap ? 'Possible gap' : 'Overlapping time'} · ${formatShortDuration(seconds)}`;
  return (
    <li className={styles.issueCard}>
      <Heading level={3} className={styles.issueTitle}>
        <WarningIcon className={styles.warningIcon} />
        {title}
      </Heading>
      <p className={styles.mono}>{formatTimeRange(parseInstant(issue.start), parseInstant(issue.end))}</p>
      {issue.earlier ? <p>{`Earlier: ${entryTitle(issue.earlier, items)}`}</p> : null}
      {issue.later ? <p>{`Later: ${entryTitle(issue.later, items)}`}</p> : null}
      {gap ? (
        <div className={styles.actions}>
          <Button isDisabled={!offered(CORRECTION_OPTIONS.extendEarlier)} onPress={() => onPrepare(CORRECTION_OPTIONS.extendEarlier)}>
            Extend earlier task…
          </Button>
          <Button isDisabled={!offered(CORRECTION_OPTIONS.startLaterEarlier)} onPress={() => onPrepare(CORRECTION_OPTIONS.startLaterEarlier)}>
            Start later task earlier…
          </Button>
        </div>
      ) : (
        <>
          <div className={styles.actions}>
            <Button isDisabled={!offered(CORRECTION_OPTIONS.removeFromEarlier)} onPress={() => onPrepare(CORRECTION_OPTIONS.removeFromEarlier)}>
              Remove overlap from earlier…
            </Button>
            <Button isDisabled={!offered(CORRECTION_OPTIONS.removeFromLater)} onPress={() => onPrepare(CORRECTION_OPTIONS.removeFromLater)}>
              Remove overlap from later…
            </Button>
          </div>
          <div className={styles.boundaryRow}>
            <TimeField
              label="Shared boundary"
              value={boundary}
              onChange={setBoundary}
              minValue={toZoned(issue.start) ?? undefined}
              maxValue={toZoned(issue.end) ?? undefined}
              hourCycle={24}
              hideTimeZone
              isDisabled={!offered(CORRECTION_OPTIONS.boundary)}
            />
            <Button
              isDisabled={!offered(CORRECTION_OPTIONS.boundary) || !boundary}
              onPress={() => {
                if (boundary) onPrepare(CORRECTION_OPTIONS.boundary, boundary.toAbsoluteString());
              }}
            >
              Preview boundary…
            </Button>
          </div>
          <p className={styles.caption}>
            A trim keeps work before and after the overlap. A shared boundary assigns the first part to the earlier task and the rest to the
            later one. Options that would remove a whole entry are unavailable.
          </p>
        </>
      )}
    </li>
  );
}

export interface CorrectionsSheetProps {
  day: string;
  issues: readonly TimeCorrectionIssue[];
  /** Per issue, in the same order: its id and the options with a valid plan. */
  choices: readonly CorrectionChoices[];
  loading: boolean;
  issue: string | null;
  working: boolean;
  busy: boolean;
  items: WorkItemsSlice | undefined;
}

/** Gaps & overlaps for the editor's day (1.14 `TimeCorrectionReview`), open while `corrections.show`. */
export function CorrectionsSheet({ day, issues, choices, loading, issue, working, busy, items }: CorrectionsSheetProps) {
  const close = useAction();
  const refresh = useAction();
  const prepare = useAction();
  const disabled = working || busy;
  const failure = issue ?? prepare.error?.message ?? refresh.error?.message ?? null;
  return (
    <Dialog
      isOpen
      onOpenChange={() => {}}
      onCancel={() => {
        if (!working) void close.run({ type: 'timeEditor.showCorrections', show: false });
      }}
      title="Gaps & overlaps"
      description={formatDayComplete(day)}
      presentation="sheet"
      size="large"
      cancelLabel="Done"
      secondaryActions={
        <Button
          isPending={refresh.pending}
          isDisabled={loading || disabled}
          onPress={() => void refresh.run({ type: 'timeEditor.loadCorrections' })}
        >
          Refresh review
        </Button>
      }
    >
      <div className={styles.sheetBody}>
        <p className={styles.caption}>
          Gaps may be lunch, breaks or leave. Choose only the corrections you want; each action opens a preview and can be undone after
          saving.
        </p>
        {loading ? <ProgressBar label="Checking recorded time…" isIndeterminate /> : null}
        {failure ? <Banner tone="warning">{failure}</Banner> : null}
        {!loading && !issue && issues.length === 0 ? (
          <div role="status" className={styles.group}>
            <p className={styles.success}>
              <SuccessIcon className={styles.successIcon} />
              No gaps or overlaps found in the elapsed workday.
            </p>
            <p className={styles.caption}>
              Gaps use the minimum duration configured in Day review. A day without entries has no neighboring task to extend.
            </p>
          </div>
        ) : null}
        {issues.length > 0 ? (
          <ul role="list" className={styles.issueList} aria-label="Gaps and overlaps">
            {issues.map((entry, index) => {
              const choice = choices[index];
              const issueId = choice?.issueId ?? correctionIssueId(entry);
              return (
                <IssueCard
                  key={issueId}
                  issue={entry}
                  options={choice?.options ?? []}
                  items={items}
                  disabled={disabled}
                  onPrepare={(option, boundary) =>
                    void prepare.run(
                      boundary === undefined
                        ? { type: 'timeEditor.prepareCorrection', issueId, option }
                        : { type: 'timeEditor.prepareCorrection', issueId, option, boundary },
                    )
                  }
                />
              );
            })}
          </ul>
        ) : null}
        <p className={styles.caption}>Overlap warnings still allow ordinary edits.</p>
      </div>
    </Dialog>
  );
}
