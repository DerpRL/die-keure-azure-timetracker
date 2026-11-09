import { useMemo, useState } from 'react';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Section } from '../../../components/Card';
import { LoadingRegion, Skeleton } from '../../../components/EmptyState';
import { ZoomInIcon } from '../../../components/icons';
import { Select } from '../../../components/Pickers';
import type { TimeRange } from '../../../charts/ActivityBars';
import type { ChartSeries } from '../../../charts/palette';
import { Timeline, type TimelineEntry } from '../../../charts/Timeline';
import { t } from '../../../i18n';
import type { AnalysisView, ExplorerCalendarDay, ExplorerEntry, StatisticsSlice } from '../../../ipc/contract';
import { EntryTable, entryId } from './EntriesList';
import { date, duration, weekdayDayMonthLabel } from './format';
import { recordLabel, taskTitles } from './model';
import { MAX_ENTRIES_PAGE, useEntriesPage } from './useEntriesPage';
import styles from './Statistics.module.css';

/** Entries asked for at once for a day's timeline (the timeline itself pages 12 rows). */
export const TIMELINE_LIMIT = MAX_ENTRIES_PAGE;

const TITLE = () => t('Your day’s task timeline');

export interface TimelineViewProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  analysisKey: string;
  series: readonly ChartSeries[];
  colors: ReadonlyMap<string, number>;
  onZoom: (range: TimeRange) => void;
}

/** The last day with recorded time, else the first day (1.14 `ExplorerTimelineView.day`). */
function defaultDay(days: readonly ExplorerCalendarDay[]): ExplorerCalendarDay | undefined {
  return [...days].reverse().find((day) => day.seconds > 0) ?? days[0];
}

/**
 * 1.14 `ExplorerTimelineView`: one row per entry of the chosen day, so gaps and overlaps stay
 * visible. The day's entries come from `statistics.entries {start, end}`.
 */
export function TimelineView({ slice, analysis, analysisKey, series, colors, onZoom }: TimelineViewProps) {
  const days = useMemo(() => slice.visuals?.days ?? [], [slice.visuals]);
  const [chosen, setChosen] = useState<{ key: string; date: string } | null>(null);
  const day = (chosen && chosen.key === analysisKey ? days.find((item) => item.date === chosen.date) : undefined) ?? defaultDay(days);
  const coversWindow = !!day && day.interval.start === slice.window.start && day.interval.end === slice.window.end;
  // A one-day window whose preview already holds every entry needs no request.
  const complete = coversWindow && analysis.entryCount <= analysis.entriesPreview.length;
  const loaded = useEntriesPage(analysisKey, day && !complete ? 0 : null, TIMELINE_LIMIT, day && !complete ? day.interval : null);
  const fetched = loaded.page?.entries;
  const entries = useMemo<readonly ExplorerEntry[]>(
    () => (complete ? analysis.entriesPreview : (fetched ?? [])),
    [complete, analysis.entriesPreview, fetched],
  );

  const dayKey = `${analysisKey}|${day?.date ?? ''}`;
  const [selection, setSelection] = useState<{ key: string; id: string | null }>({ key: dayKey, id: null });
  const selectedId = selection.key === dayKey ? selection.id : null;
  const titles = useMemo(() => taskTitles(analysis), [analysis]);
  const rows = useMemo<TimelineEntry[]>(
    () =>
      entries.map((entry) => ({
        id: entryId(entry),
        start: date(entry.start),
        end: date(entry.end),
        label: recordLabel(entry.record, titles),
        detail: entry.record.log.comment ?? undefined,
        seriesId: entry.record.activityId,
      })),
    [entries, titles],
  );
  const selected = entries.find((entry) => entryId(entry) === selectedId);

  if (!day) {
    return (
      <Section title={TITLE()} variant="plain">
        <p className={styles.secondary}>{t('No days in this window.')}</p>
      </Section>
    );
  }

  const controls =
    days.length > 1 || !coversWindow ? (
      <div className={styles.inlineForm}>
        {days.length > 1 ? (
          <Select
            label={t('Timeline day')}
            width="auto"
            items={days.map((item) => ({ id: item.date, label: `${weekdayDayMonthLabel(item.date)} · ${duration(item.seconds)}` }))}
            selectedKey={day.date}
            onSelectionChange={(key) => {
              if (key !== null) setChosen({ key: analysisKey, date: String(key) });
            }}
          />
        ) : null}
        {!coversWindow ? (
          <Button icon={ZoomInIcon} onPress={() => onZoom({ start: date(day.interval.start), end: date(day.interval.end) })}>
            {t('Zoom to this day')}
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <>
      {controls}
      {loaded.error ? (
        <Banner
          tone="error"
          title={t('Could not load the timeline')}
          actions={
            <Button size="small" onPress={loaded.retry}>
              {t('Retry')}
            </Button>
          }
        >
          {loaded.error}
        </Banner>
      ) : (
        <LoadingRegion label={t('Loading the timeline')} isLoading={loaded.loading} placeholder={<Skeleton lines={6} />}>
          <Timeline
            title={TITLE()}
            headingLevel={2}
            description={t('Each row is one recorded entry. Gaps and overlapping times stay visible. Select a bar for its entry details below.')}
            domain={{ start: date(day.interval.start), end: date(day.interval.end) }}
            entries={rows}
            series={series}
            selectedId={selectedId}
            onSelect={(id) => setSelection({ key: dayKey, id })}
            onZoomToEntry={(entry) => onZoom({ start: entry.start, end: entry.end })}
            emptyMessage={t('No entries in this day. Choose another day or adjust the active filters.')}
          />
          {loaded.page && loaded.page.total > loaded.page.entries.length ? (
            <p className={styles.secondary}>
              {t('Showing the first {shown} of {total} entries of this day. Zoom in to see the rest.', {
                shown: loaded.page.entries.length,
                total: loaded.page.total,
              })}
            </p>
          ) : null}
          {selected ? (
            <Section
              title={t('Selected timeline entry')}
              subtitle={t('Recorded task, activity and times inside the selected window.')}
              variant="plain"
              headingLevel={3}
            >
              <EntryTable label={t('Selected timeline entry')} entries={[selected]} analysis={analysis} colors={colors} />
            </Section>
          ) : null}
        </LoadingRegion>
      )}
    </>
  );
}
