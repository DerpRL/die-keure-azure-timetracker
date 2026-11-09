import { useId, useMemo, useState, type CSSProperties } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable } from '../../charts/DataTable';
import { seriesColor } from '../../charts/palette';
import { ActivityLegend } from '../../features/activity';
import { mark, t } from '../../i18n';
import type { AnalysisView, ExplorerBucket, ExplorerResolution, Interval, StatisticsSlice } from '../../ipc/contract';
import { bucketLabel, bucketLongLabel, date, duration, seconds } from './explore/format';
import { activitySeries, MIN_WINDOW_SECONDS } from './explore/model';
import { cx } from '../../utils/cx';
import styles from './insights.module.css';

/** Above this many columns the totals and every other label are left out (a month, a day of hours). */
const DENSE = 14;

const TITLES: Record<ExplorerResolution, string> = {
  Monthly: mark('Per month, by activity'),
  Daily: mark('Per day, by activity'),
  Hourly: mark('Per hour, by activity'),
  '15 minutes': mark('Per 15 minutes, by activity'),
  '5 minutes': mark('Per 5 minutes, by activity'),
};

export function bucketTotal(bucket: ExplorerBucket): number {
  return bucket.segments[bucket.segments.length - 1]?.top ?? 0;
}

interface Column {
  bucket: ExplorerBucket;
  start: Date;
  label: string;
  longLabel: string;
  total: number;
  /** The day's target (daily buckets only), else null. */
  target: number | null;
}

/** "Per day, by activity", "Per hour, by activity", … after the analysis' resolution. */
export function dayBarsTitle(resolution: ExplorerResolution): string {
  return t(TITLES[resolution]);
}

/** A round top for the scale: whole hours (or quarter hours below an hour). */
function niceMaximum(value: number): number {
  if (value <= 0) return 3600;
  const step = value <= 3600 ? 900 : 3600;
  return Math.ceil((value * 1.08) / step) * step;
}

export interface DayBarsProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  colors: ReadonlyMap<string, number>;
  /** A bar was chosen: zoom into its interval. */
  onZoom: (range: Interval) => void;
}

/**
 * Recorded time per bucket of the window (a day in a week or month, an hour in a day, a month in a
 * year), stacked by activity, with the day's target (2.2 "Per day, by activity"). Every bar is a
 * button that zooms into its interval; "Show as table" lists the same numbers.
 */
export function DayBars({ slice, analysis, colors, onZoom }: DayBarsProps) {
  const headingId = useId();
  const [asTable, setAsTable] = useState(false);
  const series = useMemo(() => activitySeries(analysis, colors), [analysis, colors]);
  const targets = useMemo(() => {
    const map = new Map<string, number>();
    if (analysis.resolution === 'Daily' && slice.targetComparable) {
      for (const day of slice.visuals?.days ?? []) map.set(String(Date.parse(day.date)), day.target);
    }
    return map;
  }, [analysis.resolution, slice.targetComparable, slice.visuals]);

  const columns = useMemo<Column[]>(
    () =>
      analysis.buckets.map((bucket) => {
        const start = date(bucket.start);
        return {
          bucket,
          start,
          label: bucketLabel(start, analysis.resolution),
          longLabel: bucketLongLabel(start, date(bucket.end), analysis.resolution),
          total: bucketTotal(bucket),
          target: targets.get(String(start.getTime())) ?? null,
        };
      }),
    [analysis, targets],
  );

  const title = dayBarsTitle(analysis.resolution);
  const nonZeroTargets = [...new Set(columns.map((column) => column.target).filter((target): target is number => !!target))];
  // One dashed line when every working day has the same target; else a mark per bar.
  const sharedTarget = nonZeroTargets.length === 1 ? nonZeroTargets[0]! : null;
  const maximum = niceMaximum(Math.max(0, ...columns.map((column) => Math.max(column.total, column.target ?? 0))));
  const dense = columns.length > DENSE;
  const labelEvery = dense ? Math.ceil(columns.length / DENSE) : 1;
  const empty = columns.every((column) => column.total === 0);
  const name = (activityId: string, fallback: string) => series.find((entry) => entry.id === activityId)?.name ?? fallback;

  const describe = (column: Column) => {
    const parts = column.bucket.segments.map((segment) => `${name(segment.activityId, segment.name)} ${duration(segment.top - segment.bottom)}`);
    return [
      `${column.longLabel}: ${column.total > 0 ? duration(column.total) : t('no time')}`,
      parts.length > 0 ? parts.join(', ') : null,
      column.target ? t('target {time}', { time: duration(column.target) }) : null,
    ]
      .filter(Boolean)
      .join('; ');
  };

  return (
    <Card as="section" aria-labelledby={headingId} padding="medium" className={styles.chartCard}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          {title}
        </h2>
        <div className={styles.cardTools}>
          <ActivityLegend items={series.map((entry) => ({ id: entry.id, name: entry.name, colorIndex: entry.colorIndex ?? 0 }))} />
          <Button size="small" aria-pressed={asTable} onPress={() => setAsTable((value) => !value)}>
            {asTable ? t('Show as chart') : t('Show as table')}
          </Button>
        </div>
      </div>
      {empty ? (
        <p className={styles.muted}>{t('No recorded time in this window.')}</p>
      ) : asTable ? (
        <DataTable
          caption={title}
          columns={[
            { id: 'bucket', header: analysis.resolution === 'Daily' ? t('Day') : t('Interval') },
            { id: 'total', header: t('Recorded'), align: 'end' },
            ...series.map((entry) => ({ id: `a:${entry.id}`, header: entry.name, align: 'end' as const })),
            ...(targets.size > 0 ? [{ id: 'target', header: t('Target'), align: 'end' as const }] : []),
          ]}
          rows={columns.map((column) => ({
            id: column.bucket.start,
            cells: {
              bucket: column.longLabel,
              total: duration(column.total),
              ...Object.fromEntries(
                series.map((entry) => {
                  const segment = column.bucket.segments.find((item) => item.activityId === entry.id);
                  return [`a:${entry.id}`, segment ? duration(segment.top - segment.bottom) : '–'];
                }),
              ),
              ...(targets.size > 0 ? { target: column.target ? duration(column.target) : '–' } : {}),
            },
          }))}
        />
      ) : (
        <div className={styles.barsPlot}>
          <div className={styles.barsArea} aria-hidden="true">
            {sharedTarget ? (
              <div className={styles.targetLine} style={{ bottom: `${(sharedTarget / maximum) * 100}%` }}>
                <span className={styles.targetLabel}>{t('Target {value}', { value: duration(sharedTarget) })}</span>
              </div>
            ) : null}
          </div>
          <ul role="list" aria-label={t('{title}. Choose a bar to zoom into it.', { title })} className={styles.barColumns} style={{ '--columns': columns.length } as CSSProperties}>
            {columns.map((column, index) => {
              const zoomable = seconds(column.bucket) > MIN_WINDOW_SECONDS;
              const showLabel = index % labelEvery === 0;
              return (
                <li key={column.bucket.start} className={styles.barColumn}>
                  <span className={cx(styles.barTotal, column.total === 0 && styles.barTotalNone)} aria-hidden="true">
                    {dense ? '' : column.total > 0 ? duration(column.total) : '–'}
                  </span>
                  <button
                    type="button"
                    className={styles.barButton}
                    aria-label={describe(column)}
                    aria-disabled={!zoomable || undefined}
                    onClick={() => {
                      if (zoomable) onZoom({ start: column.bucket.start, end: column.bucket.end });
                    }}
                  >
                    <span className={styles.barTrack}>
                      {column.bucket.segments.map((segment, segmentIndex) => (
                        <span
                          key={segment.activityId}
                          className={cx(
                            styles.barSegment,
                            segmentIndex === 0 && styles.barBottom,
                            segmentIndex === column.bucket.segments.length - 1 && styles.barTop,
                          )}
                          style={{
                            height: `${((segment.top - segment.bottom) / maximum) * 100}%`,
                            background: seriesColor(colors.get(segment.activityId) ?? 0),
                          }}
                        />
                      ))}
                      {column.target && !sharedTarget ? (
                        <span className={styles.barTarget} style={{ bottom: `${(column.target / maximum) * 100}%` }} />
                      ) : null}
                    </span>
                  </button>
                  <span className={cx(styles.barLabel, column.total === 0 && styles.barLabelNone)} aria-hidden="true">
                    {showLabel ? column.label : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
