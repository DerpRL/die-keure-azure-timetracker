import { useMemo, useRef, useState } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ZoomInIcon } from '../../components/icons';
import { SegmentedControl } from '../../components/Segmented';
import { ActivityBars, type ActivityBucket, type TimeRange } from '../../charts/ActivityBars';
import { DataTable } from '../../charts/DataTable';
import type { AnalysisView, ExplorerBucket, Interval, StatisticsSlice } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { EntriesList } from './EntriesList';
import { bucketLabel, bucketLongLabel, date, duration, instant, percent, plural, seconds } from './format';
import { HeatmapsView } from './HeatmapsView';
import { activitySeries, MIN_WINDOW_SECONDS } from './model';
import { ProgressView } from './ProgressView';
import { TimelineView } from './TimelineView';
import { ZoomControls } from './ZoomControls';
import styles from './Statistics.module.css';

export type TimeChart = 'activity' | 'heatmaps' | 'timeline' | 'progress';

/** The 1.14 chart picker, in its order. */
const CHARTS: ReadonlyArray<{ id: TimeChart; label: string }> = [
  { id: 'activity', label: 'Activity chart' },
  { id: 'heatmaps', label: 'Heatmaps' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'progress', label: 'Progress' },
];

export interface TimeSectionProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  analysisKey: string;
  colors: ReadonlyMap<string, number>;
  chart: TimeChart;
  onChartChange: (chart: TimeChart) => void;
  /** Zoom to a day or hour and show its timeline (1.14 `openTimeline`). */
  onOpenTimeline: (range: Interval) => void;
}

function bucketSeconds(bucket: ExplorerBucket): number {
  return bucket.segments[bucket.segments.length - 1]?.top ?? 0;
}

/**
 * Time explorer (1.14 `timeExplorer`): the zoomable time chart, the heatmaps, the day timeline or
 * the progress chart, then the entries of the window, or of the selected bar
 * (`statistics.entries {start, end}`).
 */
export function TimeSection({ slice, analysis, analysisKey, colors, chart, onChartChange, onOpenTimeline }: TimeSectionProps) {
  const zoom = useAction();
  const scale = useAction();
  const chartRef = useRef<HTMLDivElement>(null);
  const zoomTo = (range: TimeRange) => void zoom.run({ type: 'statistics.zoomTo', start: instant(range.start), end: instant(range.end) });
  const series = useMemo(() => activitySeries(analysis, colors), [analysis, colors]);
  // The inspected bar is a view choice; a new analysis clears it (1.14 resets it on every change).
  const [selection, setSelection] = useState<{ key: string; id: string | null }>({ key: analysisKey, id: null });
  const selectedId = selection.key === analysisKey ? selection.id : null;
  const selected = chart === 'activity' ? (analysis.buckets.find((bucket) => bucket.start === selectedId) ?? null) : null;
  const minutes = analysis.resolution === '15 minutes' || analysis.resolution === '5 minutes';

  const buckets = useMemo<ActivityBucket[]>(
    () =>
      analysis.buckets.map((bucket) => {
        const start = date(bucket.start);
        const end = date(bucket.end);
        return {
          id: bucket.start,
          start,
          end,
          label: bucketLabel(start, analysis.resolution),
          longLabel: bucketLongLabel(start, end, analysis.resolution),
          values: Object.fromEntries(bucket.segments.map((segment) => [segment.activityId, segment.top - segment.bottom])),
        };
      }),
    [analysis],
  );

  /** Back to the chart's focusable bar when the selection's controls go away. */
  const returnFocus = () => requestAnimationFrame(() => chartRef.current?.querySelector<SVGElement>('[data-mark-index][tabindex="0"]')?.focus());

  return (
    <div className={styles.stack}>
      <Card padding="large">
        <div ref={chartRef} className={styles.chartCard}>
          <div className={styles.chartToolbar}>
            <SegmentedControl label="Chart type" hideLabel options={CHARTS} selectedKey={chart} onSelectionChange={onChartChange} />
            <Badge tone="neutral" accessibleLabel={`Resolution: ${analysis.resolution}`}>
              {analysis.resolution}
            </Badge>
          </div>
          <ZoomControls slice={slice} />
          {chart === 'activity' ? (
            <ActivityBars
              title="Where your time went"
              headingLevel={2}
              description="Click a bar to inspect it. Drag across the chart to zoom into a range."
              series={series}
              buckets={buckets}
              selectedId={selectedId}
              onSelect={(id) => setSelection({ key: analysisKey, id })}
              onZoom={zoomTo}
              onZoomOut={slice.isZoomed ? () => void scale.run({ type: 'statistics.scale', factor: 2 }) : undefined}
              valueUnit={minutes ? 'minutes' : 'hours'}
              emptyMessage="No recorded time in this window."
            />
          ) : chart === 'heatmaps' ? (
            <HeatmapsView slice={slice} analysis={analysis} onOpenTimeline={onOpenTimeline} />
          ) : chart === 'timeline' ? (
            <TimelineView slice={slice} analysis={analysis} analysisKey={analysisKey} series={series} colors={colors} onZoom={zoomTo} />
          ) : (
            <ProgressView slice={slice} analysis={analysis} />
          )}
        </div>
      </Card>
      <Coverage analysis={analysis} />
      {selected ? (
        <BucketEntries
          bucket={selected}
          slice={slice}
          analysis={analysis}
          analysisKey={analysisKey}
          colors={colors}
          series={series}
          onZoom={(range) => {
            zoomTo(range);
            returnFocus();
          }}
          onClear={() => {
            setSelection({ key: analysisKey, id: null });
            returnFocus();
          }}
        />
      ) : (
        <EntriesList
          title="Entries in this window"
          detail="Select a chart bar or timeline entry to inspect its recorded time."
          analysis={analysis}
          analysisKey={analysisKey}
          colors={colors}
        />
      )}
    </div>
  );
}

interface BucketEntriesProps {
  bucket: ExplorerBucket;
  slice: StatisticsSlice;
  analysis: AnalysisView;
  analysisKey: string;
  colors: ReadonlyMap<string, number>;
  series: ReturnType<typeof activitySeries>;
  onZoom: (range: TimeRange) => void;
  onClear: () => void;
}

/**
 * 1.14 `selectionInspector`: the chosen bar's total by activity and the entries overlapping it,
 * each with only its time inside the bar.
 */
function BucketEntries({ bucket, slice, analysis, analysisKey, colors, series, onZoom, onClear }: BucketEntriesProps) {
  const start = date(bucket.start);
  const end = date(bucket.end);
  const total = bucketSeconds(bucket);
  const label = bucketLongLabel(start, end, analysis.resolution);
  const tooSmall = seconds(bucket) <= MIN_WINDOW_SECONDS && seconds(slice.window) <= MIN_WINDOW_SECONDS;
  return (
    <EntriesList
      title={`${label} · ${duration(total)}`}
      detail="Matching entries below show only their time inside this interval."
      analysis={analysis}
      analysisKey={analysisKey}
      colors={colors}
      within={{ start: bucket.start, end: bucket.end }}
      actions={
        <div className={styles.buttonRow}>
          <Button size="small" icon={ZoomInIcon} isDisabled={tooSmall} onPress={() => onZoom({ start, end })}>
            Zoom into selection
          </Button>
          <Button size="small" variant="plain" onPress={onClear}>
            Clear
          </Button>
        </div>
      }
    >
      <DataTable
        caption={`Recorded time by activity, ${label}`}
        columns={[
          { id: 'activity', header: 'Activity' },
          { id: 'time', header: 'Recorded', align: 'end' },
          { id: 'share', header: 'Share', align: 'end' },
        ]}
        rows={bucket.segments.map((segment) => ({
          id: segment.activityId,
          cells: {
            activity: series.find((entry) => entry.id === segment.activityId)?.name ?? segment.name,
            time: duration(segment.top - segment.bottom),
            share: percent(segment.top - segment.bottom, total),
          },
        }))}
        emptyMessage="No recorded time in this interval."
      />
    </EntriesList>
  );
}

/** Totals behind the chart: clock time covered, overlap and billable time (1.14 pattern notes). */
function Coverage({ analysis }: { analysis: AnalysisView }) {
  const { overlap } = analysis;
  return (
    <dl className={styles.coverage}>
      <div>
        <dt>Covered clock time</dt>
        <dd>{duration(analysis.covered)}</dd>
      </div>
      <div>
        <dt>Overlapping time</dt>
        <dd>{duration(overlap)}</dd>
      </div>
      <div>
        <dt>Billable time</dt>
        <dd>
          {analysis.billableKnownCount > 0
            ? `${duration(analysis.billable)} · supplied for ${analysis.billableKnownCount} of ${plural(analysis.count, 'entry', 'entries')}`
            : 'Not supplied by 7pace'}
        </dd>
      </div>
    </dl>
  );
}
