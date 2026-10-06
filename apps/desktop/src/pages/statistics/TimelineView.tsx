import { useMemo, useState } from 'react';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Section } from '../../components/Card';
import { LoadingRegion, Skeleton } from '../../components/EmptyState';
import { ZoomInIcon } from '../../components/icons';
import { Select } from '../../components/Pickers';
import type { TimeRange } from '../../charts/ActivityBars';
import type { ChartSeries } from '../../charts/palette';
import { Timeline, type TimelineEntry } from '../../charts/Timeline';
import type { AnalysisView, ExplorerEntry, StatisticsSlice } from '../../ipc/contract';
import { EntryTable, entryId } from './EntriesList';
import { date, duration, seconds, weekdayDayMonthLabel } from './format';
import { recordLabel, taskTitles } from './model';
import { useEntriesPage } from './useEntriesPage';
import styles from './Statistics.module.css';

/** The timeline shows one day; windows up to 36 hours count as a day, as 1.14's time axis did. */
export const TIMELINE_MAX_SECONDS = 36 * 3600;
/** Entries asked for at once for a day's timeline (the timeline itself pages 12 rows). */
export const TIMELINE_LIMIT = 500;

const TITLE = 'Your day’s task timeline';

export interface TimelineViewProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  analysisKey: string;
  series: readonly ChartSeries[];
  colors: ReadonlyMap<string, number>;
  onZoom: (range: TimeRange) => void;
}

/** 1.14 `ExplorerTimelineView`: one row per entry of a day, so gaps and overlaps stay visible. */
export function TimelineView(props: TimelineViewProps) {
  return seconds(props.slice.window) <= TIMELINE_MAX_SECONDS ? <DayTimeline {...props} /> : <DayChooser {...props} />;
}

/**
 * Longer windows: choose the day to see (the last day with recorded time first, as 1.14), then
 * zoom to it. The engine pages entries over the whole window, so the timeline needs the day as
 * the window.
 */
function DayChooser({ slice, onZoom }: TimelineViewProps) {
  const days = useMemo(() => slice.visuals?.days ?? [], [slice.visuals]);
  const [chosen, setChosen] = useState<string | null>(null);
  const fallback = [...days].reverse().find((day) => day.seconds > 0) ?? days[0];
  const day = days.find((item) => item.date === chosen) ?? fallback;
  return (
    <Section
      title={TITLE}
      variant="plain"
      subtitle="Each row is one recorded entry. Gaps and overlapping times stay visible. The timeline shows one day at a time: choose a day and zoom to it."
    >
      {day ? (
        <div className={styles.inlineForm}>
          <Select
            label="Timeline day"
            width="auto"
            items={days.map((item) => ({ id: item.date, label: `${weekdayDayMonthLabel(item.date)} · ${duration(item.seconds)}` }))}
            selectedKey={day.date}
            onSelectionChange={(key) => {
              if (key !== null) setChosen(String(key));
            }}
          />
          <Button variant="primary" icon={ZoomInIcon} onPress={() => onZoom({ start: date(day.interval.start), end: date(day.interval.end) })}>
            Zoom to this day
          </Button>
        </div>
      ) : (
        <p className={styles.secondary}>No days in this window.</p>
      )}
    </Section>
  );
}

function DayTimeline({ slice, analysis, analysisKey, series, colors, onZoom }: TimelineViewProps) {
  // The preview already holds every entry of short days; otherwise ask the engine for them.
  const complete = analysis.entryCount <= analysis.entriesPreview.length;
  const loaded = useEntriesPage(analysisKey, complete ? null : 0, TIMELINE_LIMIT);
  const fetched = loaded.page?.entries;
  const entries = useMemo<readonly ExplorerEntry[]>(
    () => (complete ? analysis.entriesPreview : (fetched ?? [])),
    [complete, analysis.entriesPreview, fetched],
  );
  const [selection, setSelection] = useState<{ key: string; id: string | null }>({ key: analysisKey, id: null });
  const selectedId = selection.key === analysisKey ? selection.id : null;

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

  if (loaded.error) {
    return (
      <Banner
        tone="error"
        title="Could not load the timeline"
        actions={
          <Button size="small" onPress={loaded.retry}>
            Retry
          </Button>
        }
      >
        {loaded.error}
      </Banner>
    );
  }

  return (
    <LoadingRegion label="Loading the timeline" isLoading={loaded.loading} placeholder={<Skeleton lines={6} />}>
      <Timeline
        title={TITLE}
        headingLevel={2}
        description="Each row is one recorded entry. Gaps and overlapping times stay visible. Select a bar for its entry details below."
        domain={{ start: date(slice.window.start), end: date(slice.window.end) }}
        entries={rows}
        series={series}
        selectedId={selectedId}
        onSelect={(id) => setSelection({ key: analysisKey, id })}
        onZoomToEntry={(entry) => onZoom({ start: entry.start, end: entry.end })}
        emptyMessage="No entries in this day. Choose another day or adjust the active filters."
      />
      {analysis.entryCount > TIMELINE_LIMIT ? (
        <p className={styles.secondary}>{`Showing the first ${TIMELINE_LIMIT} of ${analysis.entryCount} entries. Zoom in to see the rest.`}</p>
      ) : null}
      {selected ? (
        <Section title="Selected timeline entry" subtitle="Recorded task, activity and times inside the selected window." variant="plain" headingLevel={3}>
          <EntryTable label="Selected timeline entry" entries={[selected]} analysis={analysis} colors={colors} />
        </Section>
      ) : null}
    </LoadingRegion>
  );
}
