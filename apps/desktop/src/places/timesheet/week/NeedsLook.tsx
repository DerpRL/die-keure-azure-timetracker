import { useId } from 'react';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { dayToDate, formatClockTime } from '../../../features/ticketContext/format';
import { useAction, useSlice } from '../../../state/hooks';
import { formatShortDuration } from '../../../utils/duration';
import type { WeekBlock, WeekDay } from './weekModel';
import styles from './week.module.css';

function clock(time: number): string {
  return formatClockTime(new Date(time));
}

function label(block: WeekBlock): string {
  return block.ticketId !== null ? `#${block.ticketId}` : block.title;
}

export interface NeedsLookProps {
  day: WeekDay;
  /** Opens the day in the Day view with Gaps & overlaps. */
  onFix: () => void;
  onOpenDrafts: () => void;
  onSelect: (block: WeekBlock) => void;
}

/**
 * "Monday needs a look" (2.2 Timesheet): the day's overlaps, possible gaps, long entries and
 * drafts not uploaded yet, each with the step that deals with it, and Mark … reviewed for days
 * before today. Suggestions only: nothing changes without the Day view's confirmed corrections.
 */
export function NeedsLook({ day, onFix, onOpenDrafts, onSelect }: NeedsLookProps) {
  const review = useSlice('dayReview');
  const mark = useAction();
  const headingId = useId();
  const weekday = dayToDate(day.key).toLocaleDateString('en-GB', { weekday: 'long' });
  const reviewed = review?.selectedDay === day.key && !!review.record?.reviewedAt;
  const byId = new Map(day.blocks.map((block) => [block.id, block]));
  const gapSeconds = day.gaps.reduce((sum, gap) => sum + (gap.end - gap.start) / 1000, 0);
  const draftSeconds = day.drafts.reduce((sum, block) => sum + (block.end - block.start) / 1000, 0);

  return (
    <Card as="section" aria-labelledby={headingId} className={styles.card}>
      <h2 id={headingId} className={styles.cardTitle}>
        {`${weekday} needs a look`}
      </h2>
      <ul role="list" className={styles.lookList}>
        {day.overlaps.map((overlap) => {
          const earlier = byId.get(overlap.earlierId);
          const later = byId.get(overlap.laterId);
          return (
            <li key={`${overlap.earlierId}-${overlap.laterId}`} className={styles.lookItem}>
              <span>
                <span className={styles.bad}>Overlap</span>
                {` ${clock(overlap.start)} – ${clock(overlap.end)}`}
                {earlier && later ? ` · ${label(earlier)} and ${label(later)}` : null}
              </span>
              <Button size="small" onPress={onFix} aria-label={`Fix overlap at ${clock(overlap.start)}`}>
                Fix
              </Button>
            </li>
          );
        })}
        {day.gaps.length > 0 ? (
          <li className={styles.lookItem}>
            <span>
              <span className={styles.strong}>{day.gaps.length === 1 ? '1 gap' : `${day.gaps.length} gaps`}</span>
              {` · ${formatShortDuration(gapSeconds)} without an entry`}
            </span>
            <Button size="small" onPress={onFix} aria-label="Fill gaps">
              Fill
            </Button>
          </li>
        ) : null}
        {day.longEntries.map((block) => (
          <li key={`long-${block.id}`} className={styles.lookItem}>
            <span>
              <span className={styles.strong}>Long entry</span>
              {` · ${label(block)} ${clock(block.start)} – ${clock(block.end)}`}
            </span>
            <Button size="small" onPress={() => onSelect(block)} aria-label={`Check long entry ${label(block)}`}>
              Check
            </Button>
          </li>
        ))}
        {day.drafts.length > 0 ? (
          <li className={styles.lookItem}>
            <span>
              <span className={styles.accentText}>{day.drafts.length === 1 ? '1 draft' : `${day.drafts.length} drafts`}</span>
              {day.drafts.length === 1
                ? ` · ${clock(day.drafts[0]!.start)} – ${clock(day.drafts[0]!.end)} not uploaded`
                : ` · ${formatShortDuration(draftSeconds)} not uploaded`}
            </span>
            <Button size="small" variant="primary" onPress={onOpenDrafts} aria-label="Review drafts">
              Review
            </Button>
          </li>
        ) : null}
      </ul>
      {!day.isToday && !day.isFuture ? (
        reviewed ? (
          <Badge tone="success">{`${weekday} reviewed`}</Badge>
        ) : (
          <Button fullWidth isPending={mark.pending} onPress={() => void mark.run({ type: 'dayReview.markReviewed', day: day.key })}>
            {`Mark ${weekday} reviewed`}
          </Button>
        )
      ) : null}
      {mark.error ? <Banner tone="error">{mark.error.message}</Banner> : null}
    </Card>
  );
}
