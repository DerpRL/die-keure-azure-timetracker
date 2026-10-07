import { getLocalTimeZone, today } from '@internationalized/date';
import { useEffect, useRef, useState } from 'react';
import { useAnnounce } from '../../components/Announcer';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { EmptyState, LoadingRegion, Skeleton } from '../../components/EmptyState';
import { StatisticsIcon, WarningIcon } from '../../components/icons';
import { Tab, TabList, TabPanel, TabsRoot } from '../../components/Segmented';
import { PageRefresh } from '../../features/app/PageHeaderActions';
import type { AnalysisView, Interval, StatisticsSection, StatisticsSlice } from '../../ipc/contract';
import { useCommands } from '../../shortcuts/hooks';
import { useAction, useSlice } from '../../state/hooks';
import { Filters } from './Filters';
import { duration, plural, syncedLabel } from './format';
import { activityColors, analysisKey, isFilterActive } from './model';
import { PatternsSection } from './PatternsSection';
import { isCurrentOrFuture, PeriodControls } from './PeriodControls';
import { Summary } from './Summary';
import { TasksSection } from './TasksSection';
import { TimeSection, type TimeChart } from './TimeSection';
import { useOpenPage } from './useOpenPage';
import { canZoomIn } from './ZoomControls';
import styles from './Statistics.module.css';

export const SECTIONS: ReadonlyArray<{ id: StatisticsSection; title: string }> = [
  { id: 'time', title: 'Time explorer' },
  { id: 'tasks', title: 'Tasks' },
  { id: 'patterns', title: 'Work patterns' },
];

/** Statistics page (main window), the 1.14 `StatisticsView` on the engine's `statistics` slice. */
export default function StatisticsPage() {
  const slice = useSlice('statistics');
  const refresh = useAction();
  const configured = slice?.configured ?? false;
  return (
    <div className={styles.page}>
      <PageRefresh
        label="Refresh"
        onRefresh={() => void refresh.run({ type: 'statistics.refresh' })}
        isRefreshing={slice?.loading ?? false}
        isDisabled={!slice || !configured}
      />
      <p className={styles.intro}>See where your time went. Explore a period, narrow it down, then inspect the work behind it.</p>
      {refresh.error ? (
        <Banner tone="error" title="Could not refresh worklogs" onDismiss={refresh.clearError} dismissLabel="Dismiss">
          {refresh.error.message}
        </Banner>
      ) : null}
      {!slice ? <PageSkeleton /> : configured ? <StatisticsContent slice={slice} /> : <NotConfigured />}
    </div>
  );
}

function PageSkeleton() {
  return (
    <LoadingRegion label="Loading statistics" isLoading placeholder={<StatisticsSkeleton />}>
      {null}
    </LoadingRegion>
  );
}

function StatisticsSkeleton() {
  return (
    <div className={styles.stack}>
      <Skeleton shape="rect" height="2.5rem" width="24rem" />
      <div className={styles.skeletonMetrics}>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} shape="rect" height="6.5rem" />
        ))}
      </div>
      <Skeleton shape="rect" height="18rem" />
      <Skeleton lines={4} />
    </div>
  );
}

function StatisticsContent({ slice }: { slice: StatisticsSlice }) {
  const refresh = useAction();
  const retry = () => void refresh.run({ type: 'statistics.refresh' });
  const { analysis } = slice;
  useStatisticsCommands(slice);

  return (
    <>
      <PeriodControls slice={slice} />
      {slice.issue ? (
        <Banner
          tone="warning"
          title="Could not refresh worklogs"
          actions={
            <Button size="small" onPress={retry} isDisabled={slice.loading}>
              Retry
            </Button>
          }
        >
          <p>{slice.issue}</p>
          {analysis ? <p>Showing the last downloaded worklogs.</p> : null}
        </Banner>
      ) : null}
      {analysis ? (
        <Explorer slice={slice} analysis={analysis} />
      ) : slice.loading || slice.analyzing ? (
        <Card padding="large">
          <LoadingRegion label="Loading your recorded time…" isLoading placeholder={<StatisticsSkeleton />}>
            {null}
          </LoadingRegion>
        </Card>
      ) : slice.issue ? null : (
        <Card padding="large">
          <EmptyState
            icon={StatisticsIcon}
            headingLevel={2}
            title="Your statistics are waiting"
            description="Refresh to download the recorded time of this period."
            action={
              <Button variant="primary" onPress={retry}>
                Refresh
              </Button>
            }
          />
        </Card>
      )}
    </>
  );
}

/** 1.14 "Your statistics are waiting" without a 7pace connection (slice `configured` false). */
function NotConfigured() {
  const openPage = useOpenPage();
  return (
    <Card padding="large">
      <EmptyState
        icon={StatisticsIcon}
        headingLevel={2}
        title="Your statistics are waiting"
        description="Connect to 7pace in Settings to explore your recorded time."
        action={
          <Button variant="primary" onPress={() => openPage('settings')}>
            Open Settings
          </Button>
        }
      />
    </Card>
  );
}

/** Filters, totals and the three sections, once an analysis exists. */
function Explorer({ slice, analysis }: { slice: StatisticsSlice; analysis: AnalysisView }) {
  const section = useAction();
  const clear = useAction();
  const zoom = useAction();
  const [chart, setChart] = useState<TimeChart>('activity');
  // The tab follows the engine; a choice shows at once and gives way to the next slice.
  const [pending, setPending] = useState<{ from: StatisticsSection; to: StatisticsSection } | null>(null);
  const shown = pending && pending.from === slice.section ? pending.to : slice.section;

  // A filter or zoom re-analyses in the background; say when the numbers are ready.
  const announce = useAnnounce();
  const wasAnalyzing = useRef(slice.analyzing);
  useEffect(() => {
    if (wasAnalyzing.current && !slice.analyzing) announce(`Statistics updated: ${duration(analysis.total)} recorded.`);
    wasAnalyzing.current = slice.analyzing;
  }, [slice.analyzing, analysis.total, announce]);

  const key = analysisKey(slice);
  const colors = activityColors(slice.availableActivities, analysis);
  const filtered = isFilterActive(slice.filter);
  const emptyPeriod = analysis.entryCount === 0 && !filtered && !slice.isZoomed;

  const chooseSection = (next: StatisticsSection) => {
    if (next === shown) return;
    setPending({ from: slice.section, to: next });
    void section.run({ type: 'statistics.setSection', section: next }).then((result) => {
      if (!result.ok) setPending(null);
    });
  };
  useCommands(
    SECTIONS.map((item) => ({
      id: `statistics.section.${item.id}`,
      label: `Show ${item.title}`,
      group: 'Actions' as const,
      keywords: ['statistics', 'section', 'tab'],
      isDisabled: shown === item.id,
      onAction: () => chooseSection(item.id),
    })),
  );
  const openTimeline = (range: Interval) => {
    void zoom.run({ type: 'statistics.zoomTo', start: range.start, end: range.end });
    setChart('timeline');
    chooseSection('time');
  };

  return (
    <>
      <Filters slice={slice} />
      {emptyPeriod ? (
        <Card padding="large">
          <EmptyState
            icon={StatisticsIcon}
            headingLevel={2}
            title="No time tracked in this period"
            description="Nothing was recorded in 7pace for this period. Choose another period, or refresh after recording time."
          />
        </Card>
      ) : analysis.entryCount === 0 && filtered ? (
        <>
          <Summary slice={slice} analysis={analysis} />
          <Card padding="large">
            <EmptyState
              icon={StatisticsIcon}
              headingLevel={2}
              title="No entries match these filters"
              description="Try a different search or activity, or clear your filters."
              action={<Button onPress={() => void clear.run({ type: 'statistics.clearFilters' })}>Clear filters</Button>}
            />
          </Card>
        </>
      ) : (
        <>
          <Summary slice={slice} analysis={analysis} />
          <TabsRoot
            selectedKey={shown}
            onSelectionChange={(next) => chooseSection(next as StatisticsSection)}
            className={styles.sections}
          >
            <TabList aria-label="Statistics section">
              {SECTIONS.map((item) => (
                <Tab key={item.id} id={item.id}>
                  {item.title}
                </Tab>
              ))}
            </TabList>
            <div aria-busy={slice.analyzing || undefined} className={slice.analyzing ? styles.analyzing : undefined}>
              <TabPanel id="time">
                <TimeSection
                  slice={slice}
                  analysis={analysis}
                  analysisKey={key}
                  colors={colors}
                  chart={chart}
                  onChartChange={setChart}
                  onOpenTimeline={openTimeline}
                />
              </TabPanel>
              <TabPanel id="tasks">
                <TasksSection slice={slice} analysis={analysis} analysisKey={key} colors={colors} onSection={chooseSection} />
              </TabPanel>
              <TabPanel id="patterns">
                <PatternsSection slice={slice} analysis={analysis} analysisKey={key} colors={colors} />
              </TabPanel>
            </div>
          </TabsRoot>
        </>
      )}
      <SourceNotes slice={slice} />
      {section.error ? (
        <p role="alert" className={styles.inlineError}>
          {section.error.message}
        </p>
      ) : null}
    </>
  );
}

/** 1.14 `sourceNotes`: where the numbers come from. */
function SourceNotes({ slice }: { slice: StatisticsSlice }) {
  return (
    <div className={styles.sourceNotes}>
      {slice.syncedAt ? <p className={styles.strongNote}>{`Synced ${syncedLabel(slice.syncedAt)}`}</p> : null}
      <p>
        7pace worklogs only; the live timer is not added. Entries are clipped to your selected window and split at midnight. Weeks start on
        Monday. Refresh after editing time.
      </p>
      <p>
        One preceding day is downloaded to include overnight work. Entries that started earlier are not included. Targets use your daily
        schedule, holidays and leave from Settings.
      </p>
      {slice.omitted > 0 ? (
        <p className={styles.warningNote}>
          <WarningIcon className={styles.inlineIcon} />
          {`${plural(slice.omitted, 'entry was', 'entries were')} omitted because their date or duration is invalid.`}
        </p>
      ) : null}
    </div>
  );
}

/** Palette commands for the period, zoom, filters and sections while the page is open. */
function useStatisticsCommands(slice: StatisticsSlice) {
  const { run } = useAction();
  const keywords = ['statistics'];
  const atLatest = isCurrentOrFuture(slice, today(getLocalTimeZone()));
  useCommands([
    { id: 'statistics.previous', label: 'Previous period', group: 'Actions', keywords, onAction: () => void run({ type: 'statistics.move', amount: -1 }) },
    {
      id: 'statistics.next',
      label: 'Next period',
      group: 'Actions',
      keywords,
      isDisabled: atLatest,
      onAction: () => void run({ type: 'statistics.move', amount: 1 }),
    },
    { id: 'statistics.current', label: `Current ${slice.period}`, group: 'Actions', keywords, onAction: () => void run({ type: 'statistics.current' }) },
    {
      id: 'statistics.zoomIn',
      label: 'Zoom in',
      group: 'Actions',
      keywords,
      isDisabled: !slice.analysis || !canZoomIn(slice),
      onAction: () => void run({ type: 'statistics.scale', factor: 0.5 }),
    },
    {
      id: 'statistics.zoomOut',
      label: 'Zoom out',
      group: 'Actions',
      keywords,
      isDisabled: !slice.isZoomed,
      onAction: () => void run({ type: 'statistics.scale', factor: 2 }),
    },
    {
      id: 'statistics.back',
      label: 'Back to the previous zoom',
      group: 'Actions',
      keywords,
      isDisabled: slice.zoomDepth === 0,
      onAction: () => void run({ type: 'statistics.back' }),
    },
    {
      id: 'statistics.resetZoom',
      label: 'Reset zoom',
      group: 'Actions',
      keywords,
      isDisabled: !slice.isZoomed,
      onAction: () => void run({ type: 'statistics.resetZoom' }),
    },
    {
      id: 'statistics.clearFilters',
      label: 'Clear filters',
      group: 'Actions',
      keywords,
      isDisabled: !isFilterActive(slice.filter),
      onAction: () => void run({ type: 'statistics.clearFilters' }),
    },
  ]);
}
