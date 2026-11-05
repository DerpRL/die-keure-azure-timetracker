import { useId, useMemo, useState, type CSSProperties } from 'react';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CalendarHeatmap, type HeatmapDay } from '../../charts/CalendarHeatmap';
import { DataTable } from '../../charts/DataTable';
import { HourHeatmap, type HourHeatmapCell, type HourHeatmapRow } from '../../charts/HourHeatmap';
import type { AnalysisView, ExplorerCalendarDay, ExplorerVisuals, Interval, StatisticsSlice } from '../../ipc/contract';
import {
  duration,
  fullDateLabel,
  localDay,
  longDayTimeLabel,
  plural,
  timeLabel,
  timeZoneLabel,
  weekdayDayMonthLabel,
} from './explore/format';
import { PatternsSection } from './explore/PatternsSection';
import { cx } from '../../utils/cx';
import { Extras } from './Extras';
import styles from './insights.module.css';

/** More days than this show as the calendar heatmap instead of tiles. */
const MAX_TILES = 31;

const weekdayDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' });

/** Heat level of a day against its own target (or 8 hours on a day without one). */
export function dayLevel(seconds: number, target: number): 0 | 1 | 2 | 3 | 4 {
  if (!(seconds > 0)) return 0;
  const share = seconds / (target > 0 ? target : 8 * 3600);
  if (share < 0.25) return 1;
  if (share < 0.6) return 2;
  if (share < 1) return 3;
  return 4;
}

/** Hours of day with at least half the busiest hour's time, merged into ranges ("09:00 – 12:00"). */
export function busiestHours(analysis: AnalysisView): string | null {
  const hours = analysis.hours.filter((hour) => hour.seconds > 0);
  const peak = Math.max(0, ...hours.map((hour) => hour.seconds));
  if (peak <= 0) return null;
  const busy = hours.filter((hour) => hour.seconds >= peak / 2).map((hour) => hour.id).sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const hour of busy) {
    const last = ranges[ranges.length - 1];
    if (last && hour === last[1] + 1) last[1] = hour;
    else ranges.push([hour, hour]);
  }
  const clock = (hour: number) => `${String(hour % 24).padStart(2, '0')}:00`;
  const labels = ranges.slice(0, 3).map(([from, to]) => `${clock(from)} – ${clock(to + 1)}`);
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0]!;
}

function longestDay(days: readonly ExplorerCalendarDay[]): ExplorerCalendarDay | null {
  return days.reduce<ExplorerCalendarDay | null>((best, day) => (day.seconds > (best?.seconds ?? 0) ? day : best), null);
}

export interface PatternsViewProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  analysisKey: string;
  colors: ReadonlyMap<string, number>;
  /** Zoom to a day or hour and show its timeline under "Where time went". */
  onOpenTimeline: (range: Interval) => void;
  /** "See entries in Timesheet", when the Timesheet list is reachable. */
  onSeeEntries?: () => void;
}

/**
 * Patterns (2.2 "S3b · Insights — Patterns"): a tile per day, the hour-by-day heatmap and the
 * period at a glance; below them the 1.14 work patterns (weekdays, entry lengths, hours, context
 * switches) with their filters.
 */
export function PatternsView({ slice, analysis, analysisKey, colors, onOpenTimeline, onSeeEntries }: PatternsViewProps) {
  const visuals = slice.visuals;
  return (
    <div className={styles.columns}>
      <div className={styles.mainColumn}>
        {visuals ? (
          <>
            <DaysCard visuals={visuals} targets={slice.targetComparable} onOpenTimeline={onOpenTimeline} />
            <HoursCard visuals={visuals} onOpenTimeline={onOpenTimeline} />
          </>
        ) : (
          <Card padding="medium">
            <p className={styles.muted}>The day and hour patterns appear once this window’s worklogs are analysed.</p>
          </Card>
        )}
      </div>
      <Glance slice={slice} analysis={analysis} visuals={visuals} onSeeEntries={onSeeEntries} />
      <div className={styles.fullRow}>
        <Extras id="patterns" title="More work patterns" summary="Weekdays, entry lengths, hours, context switches and entries">
          <PatternsSection slice={slice} analysis={analysis} analysisKey={analysisKey} colors={colors} />
        </Extras>
      </div>
    </div>
  );
}

function DaysCard({ visuals, targets, onOpenTimeline }: { visuals: ExplorerVisuals; targets: boolean; onOpenTimeline: (range: Interval) => void }) {
  const headingId = useId();
  const [asTable, setAsTable] = useState(false);
  const tiles = visuals.days.length <= MAX_TILES;
  const days = useMemo<HeatmapDay[]>(
    () =>
      visuals.days.map((day) => ({
        date: localDay(day.date),
        value: day.seconds,
        label: fullDateLabel(day.date),
        shortLabel: weekdayDayMonthLabel(day.date),
        detail: `${plural(day.entries, 'entry', 'entries')}${targets ? ` · target ${duration(day.target)}` : ''}`,
        future: day.future,
      })),
    [visuals.days, targets],
  );
  return (
    <Card as="section" aria-labelledby={headingId} padding="medium" className={styles.chartCard}>
      <div className={styles.cardHead}>
        <h2 id={headingId} className={styles.cardTitle}>
          Per day
        </h2>
        {tiles ? (
          <Button size="small" aria-pressed={asTable} onPress={() => setAsTable((value) => !value)}>
            {asTable ? 'Show as tiles' : 'Show as table'}
          </Button>
        ) : null}
      </div>
      {!tiles ? (
        <CalendarHeatmap
          title="Calendar heatmap"
          headingLevel={3}
          description="Each cell is a day. Select one to open its timeline."
          days={days}
          onSelectDay={(selected) => {
            const day = visuals.days.find((item) => localDay(item.date) === selected);
            if (day) onOpenTimeline(day.interval);
          }}
        />
      ) : asTable ? (
        <DataTable
          caption="Recorded time per day"
          columns={[
            { id: 'day', header: 'Day' },
            { id: 'time', header: 'Recorded', align: 'end' },
            { id: 'entries', header: 'Entries', align: 'end' },
            ...(targets ? [{ id: 'target', header: 'Target', align: 'end' as const }] : []),
          ]}
          rows={visuals.days.map((day) => ({
            id: day.date,
            cells: {
              day: fullDateLabel(day.date),
              time: day.seconds > 0 ? duration(day.seconds) : '–',
              entries: String(day.entries),
              ...(targets ? { target: duration(day.target) } : {}),
            },
          }))}
        />
      ) : (
        <ul role="list" aria-label="Recorded time per day. Choose a day to open its timeline." className={styles.dayTiles}>
          {visuals.days.map((day) => {
            const level = dayLevel(day.seconds, targets ? day.target : 0);
            return (
              <li key={day.date}>
                <button
                  type="button"
                  className={cx(styles.dayTile, level >= 3 && styles.dayTileStrong, level === 0 && styles.dayTileEmpty)}
                  style={{ '--tile': `var(--heat-${level})` } as CSSProperties}
                  aria-label={`${fullDateLabel(day.date)}: ${day.seconds > 0 ? duration(day.seconds) : 'no time'}, ${plural(day.entries, 'entry', 'entries')}`}
                  onClick={() => onOpenTimeline(day.interval)}
                >
                  <span className={styles.dayTileDay}>{weekdayDay.format(new Date(day.date))}</span>
                  <b className={styles.dayTileTime}>{day.seconds > 0 ? duration(day.seconds) : '–'}</b>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function HoursCard({ visuals, onOpenTimeline }: { visuals: ExplorerVisuals; onOpenTimeline: (range: Interval) => void }) {
  const headingId = useId();
  const hours = useMemo(() => {
    const rows: HourHeatmapRow[] = visuals.days.map((day) => ({ id: day.date, label: weekdayDayMonthLabel(day.date), longLabel: fullDateLabel(day.date) }));
    const intervals = new Map<string, Interval>();
    const cells: HourHeatmapCell[] = visuals.hours.map((hour) => {
      const id = `${hour.day}#${hour.slot}`;
      intervals.set(id, hour.interval);
      const label = timeLabel(hour.interval.start);
      // A repeated daylight-saving hour keeps its own cell, so its label names the zone.
      const repeated = visuals.hours.some((other) => other !== hour && other.day === hour.day && timeLabel(other.interval.start) === label);
      return {
        id,
        rowId: hour.day,
        slot: hour.slot,
        label: repeated ? timeZoneLabel(hour.interval.start) : label,
        longLabel: repeated ? `${fullDateLabel(hour.interval.start)}, ${timeZoneLabel(hour.interval.start)}` : longDayTimeLabel(hour.interval.start),
        value: hour.seconds,
      };
    });
    return { rows, cells, intervals };
  }, [visuals]);
  return (
    <Card as="section" aria-labelledby={headingId} padding="medium" className={styles.chartCard}>
      <h2 id={headingId} className={styles.cardTitle}>
        Per hour
      </h2>
      {visuals.hours.length > 0 ? (
        <HourHeatmap
          title="Hourly heatmap"
          headingLevel={3}
          description="Select an hour to open its timeline. Repeated daylight-saving hours have separate cells."
          rows={hours.rows}
          cells={hours.cells}
          onSelectCell={(cell) => {
            const range = hours.intervals.get(cell.id);
            if (range) onOpenTimeline(range);
          }}
        />
      ) : (
        <p className={styles.muted}>Hours show for windows up to eight days. Choose a week or a day, or zoom in.</p>
      )}
    </Card>
  );
}

function Glance({
  slice,
  analysis,
  visuals,
  onSeeEntries,
}: {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  visuals: ExplorerVisuals | null;
  onSeeEntries?: () => void;
}) {
  const headingId = useId();
  const busiest = busiestHours(analysis);
  const longest = visuals ? longestDay(visuals.days) : null;
  const scope = slice.isZoomed ? 'This window' : `This ${slice.period}`;
  const facts: Array<{ label: string; value: string }> = [
    { label: 'Busiest hours', value: busiest ?? 'No recorded time' },
    ...(longest ? [{ label: 'Longest day', value: `${weekdayDayMonthLabel(longest.date)} · ${duration(longest.seconds)}` }] : []),
    { label: 'Average tracked day', value: duration(analysis.trackedDays > 0 ? analysis.total / analysis.trackedDays : 0) },
    { label: 'Overlapping time', value: duration(analysis.overlap) },
    { label: 'Covered clock time', value: duration(analysis.covered) },
  ];
  return (
    <Card as="aside" aria-labelledby={headingId} padding="medium" className={styles.glance}>
      <h2 id={headingId} className={styles.cardTitle}>
        {`${scope} at a glance`}
      </h2>
      <dl className={styles.facts}>
        {facts.map((fact) => (
          <div key={fact.label} className={styles.fact}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
      {onSeeEntries ? (
        <Button size="small" className={styles.alignStart} onPress={onSeeEntries}>
          See entries in Timesheet
        </Button>
      ) : null}
    </Card>
  );
}
