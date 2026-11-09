import { getLocalTimeZone, today, type CalendarDate } from '@internationalized/date';
import { useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '../../components/Button';
import { DatePicker } from '../../components/DateFields';
import { ChevronLeftIcon, ChevronRightIcon, RefreshIcon } from '../../components/icons';
import { SegmentedControl } from '../../components/Segmented';
import { t } from '../../i18n';
import type { StatisticsSlice } from '../../ipc/contract';
import { PlaceHeader } from '../../layout/Place';
import { REFRESH_SHORTCUT } from '../../layout/PageHeader';
import { useStuck } from '../../layout/useStuck';
import { ActivityFilter, TicketFilter } from './explore/Filters';
import { calendarDate, currentPeriodLabel, rangeTitle } from './explore/format';
import { isCurrentOrFuture, JUMP_DEBOUNCE_MS, PERIODS, SyncStatus } from './explore/PeriodControls';
import { useRefreshShortcut } from '../../shortcuts/hooks';
import { useAction } from '../../state/hooks';
import styles from './insights.module.css';

/**
 * The Insights header (2.2 "S3 · Insights"): previous / next period and the range as the view's
 * title; Day / Week / Month / Year, the activity and ticket filters, "Jump to" and Refresh on the
 * right. "Current week" appears next to the title once you moved away from it.
 */
export function InsightsHeader({ slice }: { slice: StatisticsSlice | undefined }) {
  const navigate = useAction();
  const refresh = useAction();
  const { run } = navigate;
  const now = today(getLocalTimeZone());
  const [jumped, setJumped] = useState<{ date: CalendarDate; range: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const configured = slice?.configured ?? false;
  const refreshing = slice?.loading ?? false;
  const doRefresh = () => void refresh.run({ type: 'statistics.refresh' });
  useRefreshShortcut(doRefresh, { isDisabled: !slice || !configured || refreshing, label: t('Refresh statistics') });
  const [stickyRef, stuck] = useStuck<HTMLDivElement>();

  if (!slice) return <PlaceHeader title={t('Insights')} />;

  // The picker is a draft: it shows the typed day until the range moves elsewhere (Previous,
  // Next, Current), then the first day of the engine's range.
  const start = calendarDate(slice.range.start);
  const last = calendarDate(new Date(Date.parse(slice.range.end) - 1000));
  const keepsDraft =
    !!jumped && (jumped.range === slice.range.start || (jumped.date.compare(start) >= 0 && jumped.date.compare(last) <= 0));
  const shown = keepsDraft && jumped ? jumped.date : start;
  const atLatest = isCurrentOrFuture(slice, now);
  const jumpTo = (value: CalendarDate | null) => {
    if (!value || value.compare(now) > 0) return;
    setJumped({ date: value, range: slice.range.start });
    // Each typed digit makes a complete date; ask for the period once typing pauses.
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void run({ type: 'statistics.jumpTo', date: value.toString() }), JUMP_DEBOUNCE_MS);
  };
  const failure = navigate.error ?? refresh.error;

  return (
    <div ref={stickyRef} className={styles.headerStack} data-stuck={stuck || undefined}>
      <PlaceHeader
        title={rangeTitle(slice.period, slice.range)}
        subtitle={<SyncStatus slice={slice} />}
        before={
          <div className={styles.stepper}>
            <IconButton
              label={t('Previous period')}
              icon={ChevronLeftIcon}
              variant="secondary"
              onPress={() => void run({ type: 'statistics.move', amount: -1 })}
            />
            <IconButton
              label={t('Next period')}
              icon={ChevronRightIcon}
              variant="secondary"
              isDisabled={atLatest}
              onPress={() => void run({ type: 'statistics.move', amount: 1 })}
            />
          </div>
        }
        after={
          atLatest ? null : (
            <Button size="small" variant="plain" onPress={() => void run({ type: 'statistics.current' })}>
              {currentPeriodLabel(slice.period)}
            </Button>
          )
        }
        actions={
          <>
            <SegmentedControl
              label={t('Period')}
              hideLabel
              options={PERIODS.map((option) => ({ ...option, label: t(option.label) }))}
              selectedKey={slice.period}
              onSelectionChange={(period) => void run({ type: 'statistics.setPeriod', period })}
            />
            {configured ? (
              <>
                <ActivityFilter slice={slice} hideLabel className={styles.headerPicker} />
                <TicketFilter slice={slice} hideLabel className={styles.headerPicker} />
              </>
            ) : null}
            <DatePicker<CalendarDate> label={t('Jump to')} hideLabel className={styles.jumpTo} value={shown} maxValue={now} onChange={jumpTo} />
            <IconButton
              label={t('Refresh statistics')}
              icon={RefreshIcon}
              variant="secondary"
              shortcut={REFRESH_SHORTCUT}
              isPending={refreshing}
              isDisabled={!configured}
              onPress={doRefresh}
            />
          </>
        }
      />
      {failure ? (
        <p role="alert" className={styles.inlineError}>
          {failure.message}
        </p>
      ) : null}
    </div>
  );
}
