import { useMemo, useState } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card, Section } from '../../components/Card';
import { ZoomInIcon } from '../../components/icons';
import { SegmentedControl } from '../../components/Segmented';
import { ActivityBars, type ActivityBucket, type TimeRange } from '../../charts/ActivityBars';
import { DataTable } from '../../charts/DataTable';
import type { AnalysisView, ExplorerBucket, StatisticsSlice } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { EntriesList } from './EntriesList';
import { bucketLabel, bucketLongLabel, date, duration, instant, percent, plural, seconds } from './format';
import { activitySeries, MIN_WINDOW_SECONDS } from './model';
import { TimelineView } from './TimelineView';
import { ZoomControls } from './ZoomControls';
import styles from './Statistics.module.css';

export type TimeChart = 'activity' | 'timeline';

const CHARTS: ReadonlyArray<{ id: TimeChart; label: string }> = [
  { id: 'activity', label: 'Activity chart' },
  { id: 'timeline', label: 'Timeline' },
];

export interface TimeSectionProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  analysisKey: string;
  colors: ReadonlyMap<string, number>;
  chart: TimeChart;
  onChartChange: (chart: TimeChart) => void;
}

function bucketSeconds(bucket: ExplorerBucket): number {
  return bucket.segments[bucket.segments.length - 1]?.top ?? 0;
}

/** Time explorer (1.14 `timeExplorer`): the zoomable time chart or the day timeline, then entries. */
export function TimeSection({ slice, analysis, analysisKey, colors, chart, onChartChange }: TimeSectionProps) {
  const zoom = useAction();
  const zoomTo = (range: TimeRange) => void zoom.run({ type: 'statistics.zoomTo', start: instant(range.start), end: instant(range.end) });
  const series = useMemo(() => activitySeries(analysis, colors), [analysis, colors]);

  return (
    <div className={styles.stack}>
      <Card padding="large" className={styles.chartCard}>
        <div className={styles.chartToolbar}>
          <SegmentedControl label="Chart type" hideLabel options={CHARTS} selectedKey={chart} onSelectionChange={onChartChange} />
          <Badge tone="neutral" accessibleLabel={`Resolution: ${analysis.resolution}`}>
            {analysis.resolution}
          </Badge>
        </div>
        <ZoomControls slice={slice} />
        {chart === 'activity' ? (
          <ActivityChart slice={slice} analysis={analysis} analysisKey={analysisKey} series={series} onZoom={zoomTo} />
        ) : (
          <TimelineView slice={slice} analysis={analysis} analysisKey={analysisKey} series={series} colors={colors} onZoom={zoomTo} />
        )}
      </Card>
      <Coverage analysis={analysis} />
      <EntriesList
        title="Entries in this window"
        detail="Select a chart bar or timeline entry to inspect its recorded time."
        analysis={analysis}
        analysisKey={analysisKey}
        colors={colors}
      />
    </div>
  );
}

interface ActivityChartProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  analysisKey: string;
  series: ReturnType<typeof activitySeries>;
  onZoom: (range: TimeRange) => void;
}

function ActivityChart({ slice, analysis, analysisKey, series, onZoom }: ActivityChartProps) {
  const scale = useAction();
  // The inspected bar is a view choice; a new analysis clears it (1.14 resets it on every change).
  const [selection, setSelection] = useState<{ key: string; id: string | null }>({ key: analysisKey, id: null });
  const selectedId = selection.key === analysisKey ? selection.id : null;
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
  const selected = analysis.buckets.find((bucket) => bucket.start === selectedId) ?? null;

  return (
    <>
      <ActivityBars
        title="Where your time went"
        headingLevel={2}
        description="Click a bar to inspect it. Drag across the chart to zoom into a range."
        series={series}
        buckets={buckets}
        selectedId={selectedId}
        onSelect={(id) => setSelection({ key: analysisKey, id })}
        onZoom={onZoom}
        onZoomOut={slice.isZoomed ? () => void scale.run({ type: 'statistics.scale', factor: 2 }) : undefined}
        valueUnit={minutes ? 'minutes' : 'hours'}
        emptyMessage="No recorded time in this window."
      />
      {selected ? (
        <BucketInspector
          bucket={selected}
          analysis={analysis}
          slice={slice}
          series={series}
          onZoom={onZoom}
          onClear={() => setSelection({ key: analysisKey, id: null })}
        />
      ) : null}
    </>
  );
}

interface BucketInspectorProps {
  bucket: ExplorerBucket;
  analysis: AnalysisView;
  slice: StatisticsSlice;
  series: ReturnType<typeof activitySeries>;
  onZoom: (range: TimeRange) => void;
  onClear: () => void;
}

/** 1.14 `selectionInspector`: the chosen interval's total by activity, and zoom into it. */
function BucketInspector({ bucket, analysis, slice, series, onZoom, onClear }: BucketInspectorProps) {
  const start = date(bucket.start);
  const end = date(bucket.end);
  const total = bucketSeconds(bucket);
  const label = bucketLongLabel(start, end, analysis.resolution);
  const tooSmall = seconds(bucket) <= MIN_WINDOW_SECONDS && seconds(slice.window) <= MIN_WINDOW_SECONDS;
  return (
    <Section
      title={`${label} · ${duration(total)}`}
      subtitle="Recorded time by activity inside this interval. Zoom in to list its entries."
      variant="plain"
      headingLevel={3}
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
    </Section>
  );
}

/** Totals behind the chart: clock time covered, overlap and billable time (1.14 pattern notes). */
function Coverage({ analysis }: { analysis: AnalysisView }) {
  const overlap = Math.max(0, analysis.total - analysis.covered);
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
