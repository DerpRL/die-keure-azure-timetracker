import { useId, useMemo } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ActivitySwatch } from '../../features/activity';
import { TicketLink } from '../../features/ticketContext/TicketLink';
import type { ReviewSession, WorkItemsSlice } from '../../ipc/contract';
import { formatShortDuration } from '../../utils/duration';
import { useOpenDayInTimesheet } from './DayCheck';
import { plural, ticketRows } from './model';
import styles from './today.module.css';

/** "Time per ticket" of a reviewed day, most time first, with the way to edit its entries. */
export function TimePerTicket({
  day,
  sessions,
  items,
  colorOf,
}: {
  day: string;
  sessions: readonly ReviewSession[];
  items: WorkItemsSlice | undefined;
  colorOf: (activity: string) => number;
}) {
  const headingId = useId();
  const rows = useMemo(() => ticketRows(sessions, items), [sessions, items]);
  const openDay = useOpenDayInTimesheet();
  const tickets = rows.filter((row) => row.ticketId !== null).length;
  return (
    <Card as="section" padding="none" aria-labelledby={headingId} className={styles.flush}>
      <div className={styles.flushHeadStacked}>
        <h2 id={headingId} className={styles.cardTitle}>
          Time per ticket
        </h2>
        <p className={styles.caption}>
          {sessions.length === 0 ? 'No entries recorded for this day.' : `${plural(sessions.length, 'entry', 'entries')} · ${plural(tickets, 'ticket', 'tickets')}`}
        </p>
      </div>
      {rows.length > 0 ? (
        <ul role="list" aria-label="Time per ticket" className={styles.rows}>
          {rows.map((row) => (
            <li key={row.id} className={styles.ticketRow}>
              <ActivitySwatch colorIndex={colorOf(row.activity)} />
              <span className={styles.ellipsis}>
                {row.ticketId !== null ? <TicketLink ticketId={row.ticketId} title={row.title} /> : row.title}
              </span>
              <span className={styles.duration}>{formatShortDuration(row.seconds)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {openDay ? (
        <div className={styles.rowsFootPadded}>
          <Button size="small" fullWidth onPress={() => openDay(day)}>
            Edit entries in Timesheet
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
