import { useId } from 'react';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { dayToDate, formatClockTime } from '../../../features/ticketContext/format';
import { useAction, useSlice } from '../../../state/hooks';
import { formatShortDuration } from '../../../utils/duration';
import { dateFormat, t, tn } from '../../../i18n';
import type { WeekBlock, WeekDay } from './weekModel';
import styles from './week.module.css';

function clock(time: number): string {
  return formatClockTime(new Date(time));
}

/** A sentence that starts with a weekday: Dutch weekday names are lowercase. */
function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
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
  const weekday = dateFormat({ weekday: 'long' }).format(dayToDate(day.key));
  const reviewed = review?.selectedDay === day.key && !!review.record?.reviewedAt;
  const byId = new Map(day.blocks.map((block) => [block.id, block]));
  const gapSeconds = day.gaps.reduce((sum, gap) => sum + (gap.end - gap.start) / 1000, 0);
  const draftSeconds = day.drafts.reduce((sum, block) => sum + (block.end - block.start) / 1000, 0);

  return (
    <Card as="section" aria-labelledby={headingId} className={styles.card}>
      <h2 id={headingId} className={styles.cardTitle}>
        {capitalize(t('{weekday} needs a look', { weekday }))}
      </h2>
      <ul role="list" className={styles.lookList}>
        {day.overlaps.map((overlap) => {
          const earlier = byId.get(overlap.earlierId);
          const later = byId.get(overlap.laterId);
          return (
            <li key={`${overlap.earlierId}-${overlap.laterId}`} className={styles.lookItem}>
              <span>
                <span className={styles.bad}>{t('Overlap')}</span>
                {` ${clock(overlap.start)} – ${clock(overlap.end)}`}
                {earlier && later ? ` · ${t('{earlier} and {later}', { earlier: label(earlier), later: label(later) })}` : null}
              </span>
              <Button size="small" onPress={onFix} aria-label={t('Fix overlap at {time}', { time: clock(overlap.start) })}>
                {t('Fix')}
              </Button>
            </li>
          );
        })}
        {day.gaps.length > 0 ? (
          <li className={styles.lookItem}>
            <span>
              <span className={styles.strong}>{tn(day.gaps.length, '{count} gap', '{count} gaps')}</span>
              {` · ${t('{duration} without an entry', { duration: formatShortDuration(gapSeconds) })}`}
            </span>
            <Button size="small" onPress={onFix} aria-label={t('Fill gaps')}>
              {t('Fill')}
            </Button>
          </li>
        ) : null}
        {day.longEntries.map((block) => (
          <li key={`long-${block.id}`} className={styles.lookItem}>
            <span>
              <span className={styles.strong}>{t('Long entry')}</span>
              {` · ${label(block)} ${clock(block.start)} – ${clock(block.end)}`}
            </span>
            <Button size="small" onPress={() => onSelect(block)} aria-label={t('Check long entry {title}', { title: label(block) })}>
              {t('Check')}
            </Button>
          </li>
        ))}
        {day.drafts.length > 0 ? (
          <li className={styles.lookItem}>
            <span>
              <span className={styles.accentText}>{tn(day.drafts.length, '{count} draft', '{count} drafts')}</span>
              {day.drafts.length === 1
                ? ` · ${t('{start} – {end} not uploaded', { start: clock(day.drafts[0]!.start), end: clock(day.drafts[0]!.end) })}`
                : ` · ${t('{duration} not uploaded', { duration: formatShortDuration(draftSeconds) })}`}
            </span>
            <Button size="small" variant="primary" onPress={onOpenDrafts} aria-label={t('Review drafts')}>
              {t('Review')}
            </Button>
          </li>
        ) : null}
      </ul>
      {!day.isToday && !day.isFuture ? (
        reviewed ? (
          <Badge tone="success">{capitalize(t('{weekday} reviewed', { weekday }))}</Badge>
        ) : (
          <Button fullWidth isPending={mark.pending} onPress={() => void mark.run({ type: 'dayReview.markReviewed', day: day.key })}>
            {t('Mark {weekday} reviewed', { weekday })}
          </Button>
        )
      ) : null}
      {mark.error ? <Banner tone="error">{mark.error.message}</Banner> : null}
    </Card>
  );
}
