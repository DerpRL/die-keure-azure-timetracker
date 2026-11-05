import { useId, type CSSProperties } from 'react';
import { Card } from '../../../components/Card';
import { ActivityLegend, ActivitySwatch, activityColor, activityColorIndex, useActivityColors } from '../../../features/activity';
import { TicketLink } from '../../../features/ticketContext/TicketLink';
import type { WeeklySummary, WeeklySummaryDay } from '../../../ipc/contract';
import { formatShortDuration } from '../../../utils/duration';
import styles from './WeeklyReport.module.css';

/** Heat level of a day against its own target (or 8 hours on a day without one). */
export function dayLevel(day: WeeklySummaryDay): 0 | 1 | 2 | 3 | 4 {
  if (!(day.seconds > 0)) return 0;
  const share = day.seconds / (day.targetSeconds > 0 ? day.targetSeconds : 8 * 3600);
  if (share < 0.25) return 1;
  if (share < 0.6) return 2;
  if (share < 1) return 3;
  return 4;
}

function weekday(iso: string, style: 'short' | 'long'): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { weekday: style });
}

/**
 * "Week so far" next to the draft (2.0 redesign): the week's total against its target split by
 * activity, the tickets in order of time, and one tile per day. Everything here is in the draft
 * too; the panel is a quick check of what the text is based on.
 */
export function WeekSoFar({ summary }: { summary: WeeklySummary }) {
  const headingId = useId();
  const colors = useActivityColors(summary.activities.flatMap((activity) => (activity.activityId ? [activity.activityId] : [])));
  const { totalSeconds, targetSeconds } = summary;
  const scale = Math.max(targetSeconds, totalSeconds, 1);
  const parts = summary.activities.filter((activity) => activity.seconds > 0);
  const barLabel = [
    targetSeconds > 0
      ? `${formatShortDuration(totalSeconds)} of ${formatShortDuration(targetSeconds)}`
      : formatShortDuration(totalSeconds),
    ...parts.map((activity) => `${activity.name} ${formatShortDuration(activity.seconds)}`),
  ].join(', ');

  return (
    <Card as="aside" aria-labelledby={headingId} className={styles.summary}>
      <div>
        <h2 id={headingId} className={styles.summaryTitle}>
          Week so far
        </h2>
        <p className={styles.caption}>What the draft is based on.</p>
      </div>

      <div className={styles.summaryTotal}>
        <p className={styles.totalLine}>
          <span className={styles.total}>{formatShortDuration(totalSeconds)}</span>
          {targetSeconds > 0 ? <span className={styles.caption}>{`of ${formatShortDuration(targetSeconds)}`}</span> : null}
        </p>
        <div className={styles.bar} role="img" aria-label={barLabel}>
          {parts.map((activity) => (
            <span
              key={activity.activityId ?? 'none'}
              style={{ width: `${(activity.seconds / scale) * 100}%`, background: activityColor(colors, activity.activityId) }}
            />
          ))}
        </div>
        <ActivityLegend
          items={parts.map((activity) => ({
            id: activity.activityId ?? 'none',
            name: activity.name,
            colorIndex: activityColorIndex(colors, activity.activityId),
          }))}
        />
      </div>

      {summary.tickets.length > 0 ? (
        <ul role="list" aria-label="Time per ticket" className={styles.tickets}>
          {summary.tickets.map((ticket) => (
            <li key={ticket.ticketId ?? 'none'} className={styles.ticketRow}>
              <ActivitySwatch colorIndex={activityColorIndex(colors, ticket.activityId)} />
              <span className={styles.ticketText}>
                {ticket.ticketId !== null ? (
                  <>
                    <TicketLink ticketId={ticket.ticketId} compact />
                    {` ${ticket.title ?? 'Azure ticket'}`}
                  </>
                ) : (
                  <>
                    {ticket.title ?? 'Work without an Azure ticket'}
                    <span className={styles.noTicket}> · no ticket</span>
                  </>
                )}
              </span>
              <span className={styles.ticketTime}>{formatShortDuration(ticket.seconds)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.caption}>No recorded time in this week yet.</p>
      )}

      <ul role="list" aria-label="Time per day" className={styles.days}>
        {summary.days.map((day) => (
          <li key={day.date} className={styles.day} aria-label={`${weekday(day.date, 'long')} ${day.seconds > 0 ? formatShortDuration(day.seconds) : 'no time'}`}>
            <span className={styles.dayName} aria-hidden="true">
              {weekday(day.date, 'short')}
            </span>
            <span className={styles.dayTile} style={{ '--level': `var(--heat-${dayLevel(day)})` } as CSSProperties} aria-hidden="true" />
            <span className={day.seconds > 0 ? styles.dayTime : styles.dayNone} aria-hidden="true">
              {day.seconds > 0
                ? // "7h 15m" wraps between hours and minutes in a narrow tile, never inside them.
                  formatShortDuration(day.seconds)
                    .split(' ')
                    .map((part) => <span key={part} className={styles.dayPart}>{part}</span>)
                : '–'}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
