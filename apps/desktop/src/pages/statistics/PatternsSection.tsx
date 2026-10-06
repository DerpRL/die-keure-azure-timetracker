import { useMemo, type ReactNode } from 'react';
import { ToggleButton } from 'react-aria-components';
import { Card, Section } from '../../components/Card';
import { CheckIcon, FilterIcon, HistoryIcon, StatisticsIcon, TimeEditorIcon, WarningIcon, CalendarRangeIcon } from '../../components/icons';
import { ActivityBars, type ActivityBucket } from '../../charts/ActivityBars';
import { CalendarHeatmap, type HeatmapDay } from '../../charts/CalendarHeatmap';
import { ChartFrame } from '../../charts/ChartFrame';
import { CumulativeProgress } from '../../charts/CumulativeProgress';
import { DataTable } from '../../charts/DataTable';
import { HourHeatmap, type HourHeatmapCell, type HourHeatmapRow } from '../../charts/HourHeatmap';
import type { AnalysisView, ExplorerFilter, ExplorerPattern, ExplorerVisuals, Interval, StatisticsSlice } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { EntriesList } from './EntriesList';
import {
  date,
  duration,
  fullDateLabel,
  localDay,
  longDayTimeLabel,
  monthLabel,
  plural,
  timeLabel,
  timeZoneLabel,
  weekdayDayMonthLabel,
} from './format';
import { Metric, MetricList } from './Summary';
import styles from './Statistics.module.css';

export interface PatternsSectionProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  analysisKey: string;
  colors: ReadonlyMap<string, number>;
  /** Zoom to a day or hour and show its timeline (1.14 `openTimeline`). */
  onOpenTimeline: (range: Interval) => void;
}

/** 1.14 `workPatterns`, the heatmaps and progress chart, and the context insights. */
export function PatternsSection({ slice, analysis, analysisKey, colors, onOpenTimeline }: PatternsSectionProps) {
  const update = useAction();
  const setFilter = (filter: ExplorerFilter) => void update.run({ type: 'statistics.setFilter', filter });
  const blocks = analysis.context.days.flatMap((day) => day.blocks);
  const switches = analysis.context.days.reduce((sum, day) => sum + day.switches, 0);
  const longest = blocks.length ? Math.max(...blocks) : 0;
  const average = blocks.length ? blocks.reduce((sum, value) => sum + value, 0) / blocks.length : 0;
  const showTargets = slice.targetComparable && analysis.target > 0;

  return (
    <div className={styles.stack}>
      <MetricList label="Work pattern totals">
        <Metric title="Context switches" value={String(switches)} note="Between tasks, with breaks up to 15 min" icon={StatisticsIcon} />
        <Metric title="Longest work block" value={duration(longest)} note="Continuous entries for the same task" icon={HistoryIcon} />
        <Metric title="Average work block" value={duration(average)} note="Continuous entries for the same task" icon={TimeEditorIcon} />
        <Metric
          title="Overlapping time"
          value={duration(Math.max(0, analysis.total - analysis.covered))}
          note="Recorded total minus covered clock time"
          icon={CalendarRangeIcon}
        />
      </MetricList>
      <div className={styles.columns}>
        <Card padding="large">
          <PatternBars
            title="Time by weekday"
            description="Total recorded time. Select a day to filter."
            nameHeader="Weekday"
            items={analysis.weekdays}
            selectedId={slice.filter.weekday}
            onToggle={(weekday) => setFilter({ ...slice.filter, weekday })}
          />
        </Card>
        <Card padding="large">
          <PatternBars
            title="Entry lengths"
            description="Original entry duration. Select a band to filter."
            nameHeader="Entry length"
            items={analysis.lengths}
            selectedId={slice.filter.lengthBand}
            onToggle={(lengthBand) => setFilter({ ...slice.filter, lengthBand })}
            showCount
            footer="Long entries are not a measure of concentration. Filters keep the original duration band when you zoom."
          />
        </Card>
      </div>
      {update.error ? (
        <p role="alert" className={styles.inlineError}>
          {update.error.message}
        </p>
      ) : null}
      <Card padding="large">
        <HoursChart analysis={analysis} />
      </Card>
      {slice.visuals ? <Visuals slice={slice} visuals={slice.visuals} analysis={analysis} showTargets={showTargets} onOpenTimeline={onOpenTimeline} /> : null}
      <Card padding="large">
        <ContextSwitches analysis={analysis} slice={slice} />
      </Card>
      <ReadingNotes analysis={analysis} />
      <EntriesList
        title="Entries behind these patterns"
        detail="Open an entry’s day to review or correct it in Time editor."
        analysis={analysis}
        analysisKey={analysisKey}
        colors={colors}
      />
    </div>
  );
}

interface PatternBarsProps {
  title: string;
  description: string;
  nameHeader: string;
  items: readonly ExplorerPattern[];
  selectedId: number | null;
  onToggle: (id: number | null) => void;
  showCount?: boolean;
  footer?: ReactNode;
}

/** 1.14 `patternRow`s: a share bar per weekday or length band; each row toggles its filter. */
function PatternBars({ title, description, nameHeader, items, selectedId, onToggle, showCount = false, footer }: PatternBarsProps) {
  const maximum = Math.max(1, ...items.map((item) => item.seconds));
  const table = (
    <DataTable
      caption={title}
      columns={[
        { id: 'name', header: nameHeader },
        { id: 'time', header: 'Recorded', align: 'end' },
        ...(showCount ? [{ id: 'count', header: 'Entries', align: 'end' as const }] : []),
      ]}
      rows={items.map((item) => ({
        id: String(item.id),
        cells: { name: item.label, time: duration(item.seconds), count: String(item.count) },
      }))}
    />
  );
  return (
    <ChartFrame
      title={title}
      headingLevel={2}
      description={description}
      table={table}
      footer={footer ? <p className={styles.secondary}>{footer}</p> : undefined}
    >
      <ul role="list" className={styles.patternList}>
        {items.map((item) => {
          const selected = item.id === selectedId;
          return (
            <li key={item.id}>
              <ToggleButton isSelected={selected} onChange={() => onToggle(selected ? null : item.id)} className={styles.patternRow}>
                <span className={styles.patternText}>
                  <span className={styles.patternLabel}>
                    <span className="visually-hidden">Filter by </span>
                    {item.label}
                  </span>
                  {showCount ? <span className={styles.note}>{`${plural(item.count, 'entry', 'entries')} ·`}</span> : null}
                  <span className={styles.number}>{duration(item.seconds)}</span>
                  {selected ? <CheckIcon className={styles.patternIcon} /> : <FilterIcon className={styles.patternIcon} />}
                </span>
                <span className={styles.shareTrack} aria-hidden="true">
                  <span className={styles.shareFill} style={{ width: `${(item.seconds / maximum) * 100}%` }} />
                </span>
              </ToggleButton>
            </li>
          );
        })}
      </ul>
    </ChartFrame>
  );
}

const HOUR_SERIES = [{ id: 'recorded', name: 'Recorded time', colorIndex: 0 }];

/** 1.14 "When you record work": recorded time per clock hour across the selection. */
function HoursChart({ analysis }: { analysis: AnalysisView }) {
  const buckets = useMemo<ActivityBucket[]>(
    () =>
      analysis.hours.map((hour) => {
        // Placeholder instants: this chart neither zooms nor selects.
        const start = new Date(Date.UTC(2000, 0, 1, hour.id));
        const next = `${String((hour.id + 1) % 24).padStart(2, '0')}:00`;
        return { id: `hour-${hour.id}`, start, end: new Date(start.getTime() + 3_600_000), label: hour.label, longLabel: `${hour.label} – ${next}`, values: { recorded: hour.seconds } };
      }),
    [analysis.hours],
  );
  const peak = analysis.hours.reduce<ExplorerPattern | null>((best, hour) => (!best || hour.seconds > best.seconds ? hour : best), null);
  return (
    <>
      <ActivityBars
        title="When you record work"
        headingLevel={2}
        description="Hours by time of day, summed across this selection in your computer’s time zone."
        series={HOUR_SERIES}
        buckets={buckets}
        patterns={false}
        height="13rem"
        emptyMessage="No recorded time in this selection."
      />
      {peak && peak.seconds > 0 ? (
        <p className={styles.footnoteStrong}>{`Most recorded hour: ${peak.label} · ${duration(peak.seconds)} across the selection.`}</p>
      ) : null}
    </>
  );
}

interface VisualsProps {
  slice: StatisticsSlice;
  visuals: ExplorerVisuals;
  analysis: AnalysisView;
  showTargets: boolean;
  onOpenTimeline: (range: Interval) => void;
}

/** 1.14 `ExplorerHeatmapView` and `ExplorerProgressChart`. */
function Visuals({ slice, visuals, analysis, showTargets, onOpenTimeline }: VisualsProps) {
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

  return (
    <>
      {visuals.days.length > 1 ? (
        <Card padding="large">
          <CalendarHeatmap
            title="Calendar heatmap"
            headingLevel={2}
            description="Each cell is a day. Select one to open its task timeline. Empty days remain visible."
            days={days}
            onSelectDay={(selected) => {
              const day = visuals.days.find((item) => localDay(item.date) === selected);
              if (day) onOpenTimeline(day.interval);
            }}
          />
        </Card>
      ) : null}
      {visuals.hours.length > 0 ? (
        <Card padding="large">
          <HourHeatmap
            title="Hourly heatmap"
            headingLevel={2}
            description="Select an hour to zoom into its timeline. Repeated daylight-saving hours have separate cells."
            rows={hours.rows}
            cells={hours.cells}
            onSelectCell={(cell) => {
              const range = hours.intervals.get(cell.id);
              if (range) onOpenTimeline(range);
            }}
          />
        </Card>
      ) : null}
      <Card padding="large">
        <CumulativeProgress
          title="Progress through the period"
          headingLevel={2}
          description={
            showTargets
              ? 'Recorded time alongside your scheduled target. Future dates show the target without projecting tracked time.'
              : 'Cumulative recorded time inside this filtered or zoomed window. Clear filters and reset zoom to compare the complete period with its target.'
          }
          domain={{ start: date(slice.window.start), end: date(slice.window.end) }}
          points={visuals.progress.map((point) => ({ date: date(point.date), value: point.seconds }))}
          target={showTargets ? visuals.targetProgress.map((point) => ({ date: date(point.date), value: point.target })) : null}
        />
        {analysis.total === 0 ? <p className={styles.secondary}>No recorded time in this selection.</p> : null}
      </Card>
    </>
  );
}

/** 1.14 `ContextInsightsView`: task switches per day (per month for a year). */
function ContextSwitches({ analysis, slice }: { analysis: AnalysisView; slice: StatisticsSlice }) {
  const rows = useMemo(() => {
    const days = analysis.context.days;
    if (slice.period !== 'year') {
      return days.map((day) => ({ id: day.date, label: weekdayDayMonthLabel(day.date), switches: day.switches, blocks: day.blocks.length }));
    }
    const months = new Map<string, { id: string; label: string; switches: number; blocks: number }>();
    for (const day of days) {
      const key = localDay(day.date).slice(0, 7);
      const month = months.get(key) ?? { id: key, label: monthLabel(day.date), switches: 0, blocks: 0 };
      month.switches += day.switches;
      month.blocks += day.blocks.length;
      months.set(key, month);
    }
    return [...months.values()];
  }, [analysis.context.days, slice.period]);
  const maximum = Math.max(1, ...rows.map((row) => row.switches));
  const unit = slice.period === 'year' ? 'Month' : 'Day';

  const table = (
    <DataTable
      caption={`Task switches by ${unit.toLowerCase()}`}
      columns={[
        { id: 'label', header: unit },
        { id: 'switches', header: 'Task switches', align: 'end' },
        { id: 'blocks', header: 'Work blocks', align: 'end' },
      ]}
      rows={rows.map((row) => ({ id: row.id, cells: { label: row.label, switches: String(row.switches), blocks: String(row.blocks) } }))}
    />
  );
  const footer = (
    <div className={styles.notes}>
      <p className={styles.secondary}>
        Inferred from recorded entries, not a measure of concentration. A switch changes ticket (or ticket-free activity/comment) within 15
        minutes. Adjacent entries on the same task form one block; longer breaks and overlapping entries interrupt the sequence.
      </p>
      {analysis.context.ambiguousEntries > 0 ? (
        <p className={styles.warningNote}>
          <WarningIcon className={styles.inlineIcon} />
          {`${plural(analysis.context.ambiguousEntries, 'invalid or overlapping segment')} excluded.`}
        </p>
      ) : null}
    </div>
  );

  return (
    <ChartFrame
      title="Context switches"
      headingLevel={2}
      description="Understand how your recorded work is divided across tasks."
      table={table}
      footer={footer}
    >
      {rows.length > 1 ? (
        <ul role="list" className={styles.countBars}>
          {rows.map((row) => (
            <li key={row.id} className={styles.countRow}>
              <span className={styles.countLabel}>{row.label}</span>
              <span className={styles.shareTrack} aria-hidden="true">
                <span className={styles.shareFill} style={{ width: `${(row.switches / maximum) * 100}%` }} />
              </span>
              <span className={styles.number}>{plural(row.switches, 'switch', 'switches')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.secondary}>{`${plural(rows[0]?.switches ?? 0, 'task switch', 'task switches')} in this selection.`}</p>
      )}
    </ChartFrame>
  );
}

/** 1.14 "Reading these patterns". */
function ReadingNotes({ analysis }: { analysis: AnalysisView }) {
  return (
    <Section title="Reading these patterns">
      <p className={styles.secondary}>
        {`${duration(analysis.covered)} of clock time is covered by matching entries. Overlapping entries remain in recorded totals, but are excluded from context-switch and continuous-block calculations.`}
      </p>
      <p className={styles.secondary}>
        {`Billable time: ${
          analysis.billableKnownCount > 0
            ? `${duration(analysis.billable)} · supplied by 7pace for ${analysis.billableKnownCount} of ${plural(analysis.count, 'entry', 'entries')}.`
            : 'Not supplied by 7pace for these entries.'
        }`}
      </p>
      <p className={styles.secondary}>
        Switches and blocks describe recorded entries, not attention or productivity. Applying filters can hide intervening tasks; clear
        filters for the complete sequence.
      </p>
    </Section>
  );
}
