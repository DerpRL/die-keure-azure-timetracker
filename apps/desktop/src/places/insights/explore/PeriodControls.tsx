import type { CalendarDate } from '@internationalized/date';
import { SpinnerIcon } from '../../../components/icons';
import { mark, t } from '../../../i18n';
import type { StatisticsPeriod, StatisticsSlice } from '../../../ipc/contract';
import { calendarDate, syncedLabel } from './format';
import styles from './Statistics.module.css';

/** Typing a date waits this long before the engine loads its period. */
export const JUMP_DEBOUNCE_MS = 400;

export const PERIODS: ReadonlyArray<{ id: StatisticsPeriod; label: string }> = [
  { id: 'day', label: mark('Day') },
  { id: 'week', label: mark('Week') },
  { id: 'month', label: mark('Month') },
  { id: 'year', label: mark('Year') },
];

/** The last day of the range is today or later: there is no later period to show yet (1.14). */
export function isCurrentOrFuture(slice: StatisticsSlice, now: CalendarDate): boolean {
  const last = calendarDate(new Date(Date.parse(slice.range.end) - 1000));
  return last.compare(now) >= 0;
}

/** Sync time and the loading and analysing indicators, announced politely as they change. */
export function SyncStatus({ slice }: { slice: StatisticsSlice }) {
  const busy = slice.loading
    ? slice.analysis
      ? t('Refreshing worklogs…')
      : t('Loading your recorded time…')
    : slice.analyzing
      ? t('Updating…')
      : null;
  return (
    // A span: it sits inside the header's subtitle paragraph.
    <span className={styles.syncStatus} role="status">
      {busy ? (
        <span className={styles.busy}>
          <SpinnerIcon className={styles.spinner} />
          {busy}
        </span>
      ) : null}
      {slice.syncedAt ? <span className={styles.synced}>{t('Synced {time}', { time: syncedLabel(slice.syncedAt) })}</span> : null}
    </span>
  );
}
