import { useMemo } from 'react';
import { Section } from '../../components/Card';
import { CalendarHeatmap, type HeatmapDay } from '../../charts/CalendarHeatmap';
import { HourHeatmap, type HourHeatmapCell, type HourHeatmapRow } from '../../charts/HourHeatmap';
import type { AnalysisView, ExplorerVisuals, Interval, StatisticsSlice } from '../../ipc/contract';
import { duration, fullDateLabel, localDay, longDayTimeLabel, plural, timeLabel, timeZoneLabel, weekdayDayMonthLabel } from './format';
import styles from './Statistics.module.css';

const TITLE = 'Your work at a glance';

export interface HeatmapsViewProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  /** Zoom to a day or hour and show its timeline (1.14 `openTimeline`). */
  onOpenTimeline: (range: Interval) => void;
}

/**
 * The Heatmaps chart of the time explorer (1.14 `ExplorerHeatmapView`): the calendar heatmap for
 * windows longer than a day, the hourly heatmap for day and week scales.
 */
export function HeatmapsView({ slice, analysis, onOpenTimeline }: HeatmapsViewProps) {
  const visuals = slice.visuals;
  if (!visuals) {
    return (
      <Section title={TITLE} variant="plain">
        <p className={styles.secondary}>The heatmaps appear once this window’s worklogs are analysed.</p>
      </Section>
    );
  }
  return <Heatmaps visuals={visuals} showTargets={slice.targetComparable && analysis.target > 0} onOpenTimeline={onOpenTimeline} />;
}

interface HeatmapsProps {
  visuals: ExplorerVisuals;
  showTargets: boolean;
  onOpenTimeline: (range: Interval) => void;
}

function Heatmaps({ visuals, showTargets, onOpenTimeline }: HeatmapsProps) {
  const days = useMemo<HeatmapDay[]>(
    () =>
      visuals.days.map((day) => ({
        date: localDay(day.date),
        value: day.seconds,
        label: fullDateLabel(day.date),
        detail: `${plural(day.entries, 'entry', 'entries')}${showTargets ? ` · target ${duration(day.target)}` : ''}`,
        future: day.future,
      })),
    [visuals.days, showTargets],
  );
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
  const calendar = visuals.days.length > 1;
  const hourly = visuals.hours.length > 0;

  return (
    <Section title={TITLE} variant="plain">
      <div className={styles.stack}>
        {calendar ? (
          <CalendarHeatmap
            title="Calendar heatmap"
            headingLevel={3}
            description="Each cell is a day. Select one to open its task timeline. Empty days remain visible."
            days={days}
            onSelectDay={(selected) => {
              const day = visuals.days.find((item) => localDay(item.date) === selected);
              if (day) onOpenTimeline(day.interval);
            }}
          />
        ) : null}
        {hourly ? (
          <HourHeatmap
            title="Hourly heatmap"
            headingLevel={3}
            description="Select an hour to zoom into its timeline. Repeated daylight-saving hours have separate cells."
            rows={hours.rows}
            cells={hours.cells}
            onSelectCell={(cell) => {
              const range = hours.intervals.get(cell.id);
              if (range) onOpenTimeline(range);
            }}
          />
        ) : null}
        {!calendar && !hourly ? <p className={styles.secondary}>No days in this window.</p> : null}
      </div>
    </Section>
  );
}
