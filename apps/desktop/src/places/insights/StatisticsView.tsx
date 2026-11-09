import { getLocalTimeZone, today } from '@internationalized/date';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAnnounce } from '../../components/Announcer';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState, LoadingRegion, Skeleton } from '../../components/EmptyState';
import { ArrowLeftIcon, CalendarIcon, ChevronLeftIcon, ChevronRightIcon, ClearFilterIcon, ResetIcon, StatisticsIcon, WarningIcon, ZoomInIcon, ZoomOutIcon } from '../../components/icons';
import { t, tn } from '../../i18n';
import type { AnalysisView, Interval, StatisticsSlice } from '../../ipc/contract';
import { currentPeriodLabel, duration, syncedLabel } from './explore/format';
import { activityColors, analysisKey, isFilterActive } from './explore/model';
import { isCurrentOrFuture } from './explore/PeriodControls';
import type { TimeChart } from './explore/TimeSection';
import { useOpenPage } from './explore/useOpenPage';
import { canZoomIn } from './explore/ZoomControls';
import { useCommands } from '../../shortcuts/hooks';
import { useAction, useSlice } from '../../state/hooks';
import { cx } from '../../utils/cx';
import { DayBars } from './DayBars';
import { Explore } from './Explore';
import { Extras, useOpenExtras } from './Extras';
import { InsightsHeader } from './InsightsHeader';
import { PatternsView } from './PatternsView';
import { ScopeLine, StatCards } from './StatCards';
import { TicketBars } from './TicketBars';
import { useWeeklyReport } from './useWeeklyReport';
import { WeeklyAside } from './WeeklyAside';
import styles from './insights.module.css';

export type StatisticsViewId = 'time' | 'patterns';

export interface StatisticsViewProps {
  view: StatisticsViewId;
  /** The view tabs, placed as in the design: in the main column on "Where time went". */
  tabs?: ReactNode;
  /** Show the weekly report next to the charts (the Weekly report view is reachable). */
  reportAside?: boolean;
  /** Patterns asks to show a day's timeline under "Where time went". */
  onShowTime?: () => void;
  /** "See entries in Timesheet"; omitted when the list is not reachable. */
  onSeeEntries?: () => void;
}

/**
 * "Where time went" and "Patterns" (2.2 Insights) on the engine's `statistics` slice: one header
 * with the period and filters, the totals, then the view.
 */
export function StatisticsView({ view, tabs, reportAside = false, onShowTime, onSeeEntries }: StatisticsViewProps) {
  const slice = useSlice('statistics');
  return (
    <>
      <InsightsHeader slice={slice} />
      {!slice ? (
        <>
          {tabs}
          <LoadingRegion label={t('Loading statistics')} isLoading placeholder={<StatisticsSkeleton />}>
            {null}
          </LoadingRegion>
        </>
      ) : !slice.configured ? (
        <>
          {tabs}
          <NotConfigured />
        </>
      ) : (
        <StatisticsContent slice={slice} view={view} tabs={tabs} reportAside={reportAside} onShowTime={onShowTime} onSeeEntries={onSeeEntries} />
      )}
    </>
  );
}

function StatisticsSkeleton() {
  return (
    <div className={styles.stack}>
      <div className={styles.stats}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} shape="rect" height="6.5rem" />
        ))}
      </div>
      <Skeleton shape="rect" height="18rem" />
      <Skeleton lines={4} />
    </div>
  );
}

/** "Your statistics are waiting" without a 7pace connection (slice `configured` false). */
function NotConfigured() {
  const openPage = useOpenPage();
  return (
    <Card padding="large">
      <EmptyState
        icon={StatisticsIcon}
        headingLevel={2}
        title={t('Your statistics are waiting')}
        description={t('Connect to 7pace in Settings to explore your recorded time.')}
        action={
          <Button variant="primary" onPress={() => openPage('settings')}>
            {t('Open Settings')}
          </Button>
        }
      />
    </Card>
  );
}

function StatisticsContent({ slice, view, tabs, reportAside, onShowTime, onSeeEntries }: StatisticsViewProps & { slice: StatisticsSlice }) {
  const refresh = useAction();
  const retry = () => void refresh.run({ type: 'statistics.refresh' });
  const { analysis } = slice;
  useStatisticsCommands(slice);

  const issue = slice.issue ? (
    <Banner
      tone="warning"
      title={t('Could not refresh worklogs')}
      actions={
        <Button size="small" onPress={retry} isDisabled={slice.loading}>
          {t('Retry')}
        </Button>
      }
    >
      <p>{slice.issue}</p>
      {analysis ? <p>{t('Showing the last downloaded worklogs.')}</p> : null}
    </Banner>
  ) : null;

  if (!analysis) {
    return (
      <>
        {tabs}
        {issue}
        {slice.loading || slice.analyzing ? (
          <Card padding="large">
            <LoadingRegion label={t('Loading your recorded time…')} isLoading placeholder={<StatisticsSkeleton />}>
              {null}
            </LoadingRegion>
          </Card>
        ) : slice.issue ? null : (
          <Card padding="large">
            <EmptyState
              icon={StatisticsIcon}
              headingLevel={2}
              title={t('Your statistics are waiting')}
              description={t('Refresh to download the recorded time of this period.')}
              action={
                <Button variant="primary" onPress={retry}>
                  {t('Refresh')}
                </Button>
              }
            />
          </Card>
        )}
      </>
    );
  }
  return (
    <Analysed
      slice={slice}
      analysis={analysis}
      view={view}
      tabs={tabs}
      issue={issue}
      reportAside={reportAside}
      onShowTime={onShowTime}
      onSeeEntries={onSeeEntries}
    />
  );
}

interface AnalysedProps extends StatisticsViewProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  issue: ReactNode;
}

function Analysed({ slice, analysis, view, tabs, issue, reportAside, onShowTime, onSeeEntries }: AnalysedProps) {
  const zoom = useAction();
  const clear = useAction();
  const [chart, setChart] = useState<TimeChart>('activity');
  const openExtras = useOpenExtras();

  // A filter or zoom re-analyses in the background; say when the numbers are ready.
  const announce = useAnnounce();
  const wasAnalyzing = useRef(slice.analyzing);
  useEffect(() => {
    if (wasAnalyzing.current && !slice.analyzing) announce(t('Statistics updated: {time} recorded.', { time: duration(analysis.total) }));
    wasAnalyzing.current = slice.analyzing;
  }, [slice.analyzing, analysis.total, announce]);

  const key = analysisKey(slice);
  const colors = activityColors(slice.availableActivities, analysis);
  const filtered = isFilterActive(slice.filter);
  const emptyPeriod = analysis.entryCount === 0 && !filtered && !slice.isZoomed;
  const noMatch = analysis.entryCount === 0 && filtered;
  const zoomTo = (range: Interval) => void zoom.run({ type: 'statistics.zoomTo', start: range.start, end: range.end });
  const openTimeline = (range: Interval) => {
    zoomTo(range);
    setChart('timeline');
    // The timeline lives in the explorer: show it.
    openExtras('explore');
    onShowTime?.();
  };

  const empty = emptyPeriod ? (
    <Card padding="large">
      <EmptyState
        icon={StatisticsIcon}
        headingLevel={2}
        title={t('No time tracked in this period')}
        description={t('Nothing was recorded in 7pace for this period. Choose another period, or refresh after recording time.')}
      />
    </Card>
  ) : noMatch ? (
    <Card padding="large">
      <EmptyState
        icon={StatisticsIcon}
        headingLevel={2}
        title={t('No entries match these filters')}
        description={t('Try a different search or activity, or clear your filters.')}
        action={<Button onPress={() => void clear.run({ type: 'statistics.clearFilters' })}>{t('Clear filters')}</Button>}
      />
    </Card>
  ) : null;

  const errors = zoom.error ? (
    <p role="alert" className={styles.inlineError}>
      {zoom.error.message}
    </p>
  ) : null;

  if (view === 'patterns') {
    return (
      <>
        {tabs}
        {issue}
        <ScopeLine slice={slice} />
        {empty ?? (
          <div aria-busy={slice.analyzing || undefined} className={slice.analyzing ? styles.analyzing : undefined}>
            <PatternsView
              slice={slice}
              analysis={analysis}
              analysisKey={key}
              colors={colors}
              onOpenTimeline={openTimeline}
              onSeeEntries={onSeeEntries}
            />
          </div>
        )}
        {errors}
        <SourceNotes slice={slice} />
      </>
    );
  }

  return (
    <>
      {issue}
      <ScopeLine slice={slice} />
      {emptyPeriod ? null : <StatCards slice={slice} analysis={analysis} />}
      <div className={styles.columns}>
        <div className={styles.mainColumn}>
          {tabs}
          {empty ?? (
            <div aria-busy={slice.analyzing || undefined} className={cx(styles.mainColumn, slice.analyzing && styles.analyzing)}>
              <DayBars slice={slice} analysis={analysis} colors={colors} onZoom={zoomTo} />
              <TicketBars analysis={analysis} />
            </div>
          )}
          {errors}
        </div>
        {reportAside ? <ReportAside statisticsRange={slice.period === 'week' ? slice.range.start : null} /> : null}
        {empty ? null : (
          <div className={styles.fullRow}>
            <Extras id="explore" title={t('Explore entries')} summary={t('Time explorer, heatmaps, timeline, progress, tasks and entries')}>
              <Explore
                slice={slice}
                analysis={analysis}
                analysisKey={key}
                colors={colors}
                chart={chart}
                onChartChange={setChart}
                onOpenTimeline={openTimeline}
              />
            </Extras>
          </div>
        )}
      </div>
      <SourceNotes slice={slice} />
    </>
  );
}

function ReportAside({ statisticsRange }: { statisticsRange: string | null }) {
  const report = useWeeklyReport({ commands: true });
  return (
    <>
      <WeeklyAside report={report} statisticsRange={statisticsRange} />
      {report.confirmation}
    </>
  );
}

/** Where the numbers come from (1.14 `sourceNotes`). */
function SourceNotes({ slice }: { slice: StatisticsSlice }) {
  return (
    <div className={styles.sourceNotes}>
      {slice.syncedAt ? <p className={styles.strongNote}>{t('Synced {time}', { time: syncedLabel(slice.syncedAt) })}</p> : null}
      <p>
        {t(
          '7pace worklogs only; the live timer is not added. Entries are clipped to your selected window and split at midnight. Weeks start on Monday. Refresh after editing time.',
        )}
      </p>
      <p>
        {t(
          'One preceding day is downloaded to include overnight work. Entries that started earlier are not included. Targets use your daily schedule, holidays and leave from Settings.',
        )}
      </p>
      {slice.omitted > 0 ? (
        <p className={styles.warningNote}>
          <WarningIcon className={styles.inlineIcon} />
          {tn(
            slice.omitted,
            '{count} entry was omitted because their date or duration is invalid.',
            '{count} entries were omitted because their date or duration is invalid.',
          )}
        </p>
      ) : null}
    </div>
  );
}

/** Palette commands for the period, zoom and filters while the view is open. */
function useStatisticsCommands(slice: StatisticsSlice) {
  const { run } = useAction();
  const keywords = ['statistics', 'insights'];
  const atLatest = isCurrentOrFuture(slice, today(getLocalTimeZone()));
  useCommands([
    { id: 'statistics.previous', icon: ChevronLeftIcon, label: t('Previous period'), group: 'Actions', keywords, onAction: () => void run({ type: 'statistics.move', amount: -1 }) },
    {
      id: 'statistics.next',
      icon: ChevronRightIcon,
      label: t('Next period'),
      group: 'Actions',
      keywords,
      isDisabled: atLatest,
      onAction: () => void run({ type: 'statistics.move', amount: 1 }),
    },
    { id: 'statistics.current', icon: CalendarIcon, label: currentPeriodLabel(slice.period), group: 'Actions', keywords, onAction: () => void run({ type: 'statistics.current' }) },
    {
      id: 'statistics.zoomIn',
      icon: ZoomInIcon,
      label: t('Zoom in'),
      group: 'Actions',
      keywords,
      isDisabled: !slice.analysis || !canZoomIn(slice),
      onAction: () => void run({ type: 'statistics.scale', factor: 0.5 }),
    },
    {
      id: 'statistics.zoomOut',
      icon: ZoomOutIcon,
      label: t('Zoom out'),
      group: 'Actions',
      keywords,
      isDisabled: !slice.isZoomed,
      onAction: () => void run({ type: 'statistics.scale', factor: 2 }),
    },
    {
      id: 'statistics.back',
      icon: ArrowLeftIcon,
      label: t('Back to the previous zoom'),
      group: 'Actions',
      keywords,
      isDisabled: slice.zoomDepth === 0,
      onAction: () => void run({ type: 'statistics.back' }),
    },
    {
      id: 'statistics.resetZoom',
      icon: ResetIcon,
      label: t('Reset zoom'),
      group: 'Actions',
      keywords,
      isDisabled: !slice.isZoomed,
      onAction: () => void run({ type: 'statistics.resetZoom' }),
    },
    {
      id: 'statistics.clearFilters',
      icon: ClearFilterIcon,
      label: t('Clear filters'),
      group: 'Actions',
      keywords,
      isDisabled: !isFilterActive(slice.filter),
      onAction: () => void run({ type: 'statistics.clearFilters' }),
    },
  ]);
}
