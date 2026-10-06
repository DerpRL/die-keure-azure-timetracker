import type { ReactNode } from 'react';
import { Heading, type HeadingLevel } from '../../components/Card';
import { WarningIcon } from '../../components/icons';
import type { WorkLogConflict, WorkLogDraft, WorkLogPlan } from '../../ipc/contract';
import { formatDateTime, logEnd, logStart, parseInstant, ticketPrefix } from '../../features/ticketContext/format';
import { cx } from '../../utils/cx';
import { formatShortDuration } from '../../utils/duration';
import styles from './TimeEditor.module.css';

function draftStart(draft: WorkLogDraft): Date | null {
  return parseInstant(draft.start);
}

function draftEnd(draft: WorkLogDraft): Date | null {
  const start = draftStart(draft);
  return start ? new Date(start.getTime() + draft.seconds * 1000) : null;
}

function rangeText(start: Date | null, end: Date | null): string {
  const seconds = start && end ? (end.getTime() - start.getTime()) / 1000 : 0;
  return `${formatDateTime(start)} → ${formatDateTime(end)} · ${formatShortDuration(seconds)}`;
}

interface Interval {
  start: Date | null;
  end: Date | null;
}

function Bar({ interval, bounds, tone }: { interval: Interval; bounds: { lower: number; upper: number }; tone: 'before' | 'after' }) {
  if (!interval.start || !interval.end) return null;
  const span = Math.max(1, bounds.upper - bounds.lower);
  const left = ((interval.start.getTime() - bounds.lower) / span) * 100;
  const width = Math.max(0.5, ((interval.end.getTime() - interval.start.getTime()) / span) * 100);
  return (
    <div className={styles.barTrack} aria-hidden="true">
      <div className={cx(styles.bar, tone === 'before' ? styles.barBefore : styles.barAfter)} style={{ left: `${left}%`, width: `${width}%` }} />
    </div>
  );
}

function PreviewRow({
  label,
  interval,
  bounds,
  tone,
}: {
  label: string;
  interval: Interval;
  bounds: { lower: number; upper: number };
  tone: 'before' | 'after';
}) {
  return (
    <li className={styles.previewRow}>
      <span className={styles.previewLabel}>{label}</span>
      <Bar interval={interval} bounds={bounds} tone={tone} />
      <span className={styles.caption}>{rangeText(interval.start, interval.end)}</span>
    </li>
  );
}

/** "Before → after" for a correction (1.14 `CorrectionPlanPreview`). */
export function CorrectionPlanPreview({ plan, headingLevel = 3 }: { plan: WorkLogPlan; headingLevel?: HeadingLevel }) {
  const before = plan.before.map((log) => ({ log, interval: { start: logStart(log), end: logEnd(log) } }));
  const after = plan.desired.map((draft) => ({ draft, interval: { start: draftStart(draft), end: draftEnd(draft) } }));
  const times = [...before.map((row) => row.interval), ...after.map((row) => row.interval)]
    .flatMap((interval) => [interval.start?.getTime(), interval.end?.getTime()])
    .filter((value): value is number => typeof value === 'number');
  const bounds = { lower: Math.min(...times), upper: Math.max(...times) };
  const beforeTotal = plan.before.reduce((sum, log) => sum + log.length, 0);
  const afterTotal = plan.desired.reduce((sum, draft) => sum + draft.seconds, 0);
  const nextLevel = Math.min(6, headingLevel + 1) as HeadingLevel;
  return (
    <div className={styles.group}>
      <div>
        <Heading level={headingLevel} className={styles.groupTitle}>
          Before → after
        </Heading>
        <p className={styles.caption}>Review every affected interval before applying this correction.</p>
      </div>
      <Heading level={nextLevel} className={styles.subTitle}>
        {`Before · ${formatShortDuration(beforeTotal)}`}
      </Heading>
      <ul role="list" className={styles.previewList}>
        {before.map(({ log, interval }) => (
          <PreviewRow
            key={log.id}
            label={`${ticketPrefix(log.workItemId)}${log.comment?.trim() || 'Tracked time'}`}
            interval={interval}
            bounds={bounds}
            tone="before"
          />
        ))}
      </ul>
      <Heading level={nextLevel} className={styles.subTitle}>
        {`After · ${formatShortDuration(afterTotal)}`}
      </Heading>
      <ul role="list" className={styles.previewList}>
        {after.map(({ draft, interval }, index) => (
          <PreviewRow
            key={`${draft.existingId ?? 'new'}-${index}`}
            label={`${ticketPrefix(draft.ticketId)}${draft.comment?.trim() || 'Tracked time'}`}
            interval={interval}
            bounds={bounds}
            tone="after"
          />
        ))}
      </ul>
      <p className={styles.caption}>You can undo this correction from Recent edits. Overlap warnings do not block saving.</p>
    </div>
  );
}

/** "Result" with the total and each entry the change leaves behind. */
export function PlanResult({ plan, headingLevel = 3, children }: { plan: WorkLogPlan; headingLevel?: HeadingLevel; children?: ReactNode }) {
  const total = plan.desired.reduce((sum, draft) => sum + draft.seconds, 0);
  return (
    <div className={styles.group}>
      <div>
        <Heading level={headingLevel} className={styles.groupTitle}>
          Result
        </Heading>
        <p className={styles.caption}>{`Total: ${formatShortDuration(total)}`}</p>
      </div>
      <ul role="list" className={styles.resultList}>
        {plan.desired.map((draft, index) => (
          <li key={`${draft.existingId ?? 'new'}-${index}`} className={styles.resultRow}>
            <span className={styles.resultTitle}>
              {`${draft.ticketId ? `#${draft.ticketId}` : 'No Azure ticket'} · ${formatShortDuration(draft.seconds)}`}
            </span>
            <span>{`${formatDateTime(draftStart(draft))} → ${formatDateTime(draftEnd(draft))}`}</span>
            <span className={styles.caption}>{`Billable: ${formatShortDuration(draft.billableSeconds)}`}</span>
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}

/** Overlapping entries for a proposed or saved change (1.14 `overlapNotice`). */
export function OverlapNotice({
  conflicts,
  issue,
  saved = false,
}: {
  conflicts: readonly WorkLogConflict[];
  issue: string | null;
  saved?: boolean;
}) {
  return (
    <div className={styles.notice}>
      {conflicts.length > 0 ? (
        <>
          <p className={styles.noticeTitle}>
            <WarningIcon className={styles.warningIcon} />
            {saved ? 'Saved with overlapping time' : 'Overlapping time'}
          </p>
          <ul role="list" className={styles.resultList}>
            {conflicts.map((conflict) => (
              <li key={conflict.id} className={styles.resultRow}>
                <span className={styles.resultTitle}>{`${ticketPrefix(conflict.ticketId)}${conflict.title}`}</span>
                <span className={styles.caption}>
                  {`${formatDateTime(parseInstant(conflict.start))} → ${
                    conflict.active ? 'still running' : formatDateTime(parseInstant(conflict.end))
                  } · ${formatShortDuration(conflict.overlap)} overlap`}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {issue ? (
        <p className={styles.noticeTitle}>
          <WarningIcon className={styles.warningIcon} />
          {issue}
        </p>
      ) : null}
      <p className={styles.caption}>
        {saved
          ? conflicts.length === 0
            ? 'Your changes were saved. Check nearby entries in 7pace if needed.'
            : 'Your changes were saved. Overlapping entries were kept.'
          : 'Overlaps are informational and do not block saving.'}
      </p>
    </div>
  );
}
