import { getLocalTimeZone, today, type CalendarDate } from '@internationalized/date';
import { useState } from 'react';
import { IconButton, Button } from '../../components/Button';
import { DatePicker } from '../../components/DateFields';
import { ChevronLeftIcon, ChevronRightIcon, RefreshIcon, SpinnerIcon } from '../../components/icons';
import { SegmentedControl } from '../../components/Segmented';
import type { StatisticsPeriod, StatisticsSlice } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { calendarDate, rangeTitle, syncedLabel } from './format';
import styles from './Statistics.module.css';

export const PERIODS: ReadonlyArray<{ id: StatisticsPeriod; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

/** The last day of the range is today or later: there is no later period to show yet (1.14). */
export function isCurrentOrFuture(slice: StatisticsSlice, now: CalendarDate): boolean {
  const last = calendarDate(new Date(Date.parse(slice.range.end) - 1000));
  return last.compare(now) >= 0;
}

/**
 * Period selector and navigation (1.14 `controls`): Day/Week/Month/Year, "Current week",
 * previous and next, the range title and "Jump to".
 */
export function PeriodControls({ slice }: { slice: StatisticsSlice }) {
  const navigate = useAction();
  const { run } = navigate;
  const now = today(getLocalTimeZone());
  // The picker shows the day the user jumped to while it lies in the shown range, else the
  // range's first day. Only a draft: the range itself comes from the engine.
  const [jumped, setJumped] = useState<CalendarDate | null>(null);
  const start = calendarDate(slice.range.start);
  const last = calendarDate(new Date(Date.parse(slice.range.end) - 1000));
  const shown = jumped && jumped.compare(start) >= 0 && jumped.compare(last) <= 0 ? jumped : start;
  const atLatest = isCurrentOrFuture(slice, now);

  return (
    <div className={styles.controls}>
      <div className={styles.controlRow}>
        <SegmentedControl
          label="Period"
          hideLabel
          options={PERIODS}
          selectedKey={slice.period}
          onSelectionChange={(period) => void run({ type: 'statistics.setPeriod', period })}
        />
        <Button onPress={() => void run({ type: 'statistics.current' })}>{`Current ${slice.period}`}</Button>
      </div>
      <div className={styles.controlRow}>
        <div className={styles.rangeNavigator}>
          <IconButton
            label="Previous period"
            icon={ChevronLeftIcon}
            variant="secondary"
            onPress={() => void run({ type: 'statistics.move', amount: -1 })}
          />
          <p className={styles.rangeTitle} aria-live="polite" aria-atomic="true">
            {rangeTitle(slice.period, slice.range)}
          </p>
          <IconButton
            label="Next period"
            icon={ChevronRightIcon}
            variant="secondary"
            isDisabled={atLatest}
            onPress={() => void run({ type: 'statistics.move', amount: 1 })}
          />
        </div>
        <DatePicker<CalendarDate>
          label="Jump to"
          className={styles.jumpTo}
          value={shown}
          maxValue={now}
          onChange={(value) => {
            if (!value || value.compare(now) > 0) return;
            setJumped(value);
            void run({ type: 'statistics.jumpTo', date: value.toString() });
          }}
        />
      </div>
      {navigate.error ? (
        <p role="alert" className={styles.inlineError}>
          {navigate.error.message}
        </p>
      ) : null}
      <SyncStatus slice={slice} />
    </div>
  );
}

/** Sync time and the loading and analysing indicators, announced politely as they change. */
export function SyncStatus({ slice }: { slice: StatisticsSlice }) {
  const busy = slice.loading
    ? slice.analysis
      ? 'Refreshing worklogs…'
      : 'Loading your recorded time…'
    : slice.analyzing
      ? 'Updating…'
      : null;
  return (
    <p className={styles.syncStatus} role="status">
      {busy ? (
        <span className={styles.busy}>
          <SpinnerIcon className={styles.spinner} />
          {busy}
        </span>
      ) : null}
      {slice.syncedAt ? (
        <span className={styles.synced}>
          <RefreshIcon className={styles.inlineIcon} />
          {`Synced ${syncedLabel(slice.syncedAt)}`}
        </span>
      ) : null}
    </p>
  );
}
