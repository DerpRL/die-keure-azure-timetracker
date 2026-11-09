import { useMemo, type ReactNode } from 'react';
import { ToggleButton } from 'react-aria-components';
import { Card, Section } from '../../../components/Card';
import { CheckIcon, FilterIcon, WarningIcon } from '../../../components/icons';
import { ActivityBars, type ActivityBucket } from '../../../charts/ActivityBars';
import { ChartFrame } from '../../../charts/ChartFrame';
import { DataTable } from '../../../charts/DataTable';
import { t, tn } from '../../../i18n';
import type { AnalysisView, ExplorerFilter, ExplorerPattern, StatisticsSlice } from '../../../ipc/contract';
import { useAction } from '../../../state/hooks';
import { EntriesList } from './EntriesList';
import { duration, localDay, monthLabel, weekdayDayMonthLabel } from './format';
import { Metric, MetricList } from './Summary';
import styles from './Statistics.module.css';

export interface PatternsSectionProps {
  slice: StatisticsSlice;
  analysis: AnalysisView;
  analysisKey: string;
  colors: ReadonlyMap<string, number>;
}

/** 1.14 `workPatterns` and the context insights. */
export function PatternsSection({ slice, analysis, analysisKey, colors }: PatternsSectionProps) {
  const update = useAction();
  const setFilter = (filter: ExplorerFilter) => void update.run({ type: 'statistics.setFilter', filter });
  const { switches, longestBlock, averageBlock } = analysis.context;

  return (
    <div className={styles.stack}>
      <MetricList label={t('Work pattern totals')}>
        <Metric title={t('Context switches')} value={String(switches)} note={t('Between tasks, with breaks up to 15 min')} />
        <Metric title={t('Longest work block')} value={duration(longestBlock)} note={t('Continuous entries for the same task')} />
        <Metric title={t('Average work block')} value={duration(averageBlock)} note={t('Mean length of continuous work')} />
        <Metric title={t('Overlapping time')} value={duration(analysis.overlap)} note={t('Recorded total minus covered clock time')} />
      </MetricList>
      <div className={styles.columns}>
        <Card padding="large">
          <PatternBars
            title={t('Time by weekday')}
            description={t('Total recorded time. Select a day to filter.')}
            nameHeader={t('Weekday')}
            items={analysis.weekdays}
            selectedId={slice.filter.weekday}
            onToggle={(weekday) => setFilter({ ...slice.filter, weekday })}
          />
        </Card>
        <Card padding="large">
          <PatternBars
            title={t('Entry lengths')}
            description={t('Original entry duration. Select a band to filter.')}
            nameHeader={t('Entry length')}
            items={analysis.lengths}
            selectedId={slice.filter.lengthBand}
            onToggle={(lengthBand) => setFilter({ ...slice.filter, lengthBand })}
            showCount
            footer={t('Long entries are not a measure of concentration. Filters keep the original duration band when you zoom.')}
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
      <Card padding="large">
        <ContextSwitches analysis={analysis} slice={slice} />
      </Card>
      <ReadingNotes analysis={analysis} />
      <EntriesList
        title={t('Entries behind these patterns')}
        detail={t('Open an entry’s day to review or correct it in Time editor.')}
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
        { id: 'time', header: t('Recorded'), align: 'end' },
        ...(showCount ? [{ id: 'count', header: t('Entries'), align: 'end' as const }] : []),
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
              <ToggleButton
                isSelected={selected}
                onChange={() => onToggle(selected ? null : item.id)}
                // 1.14's name: "Filter by Mon, 7h 25m"; the pressed state says whether it applies.
                aria-label={
                  showCount
                    ? tn(item.count, 'Filter by {name}, {time}, {count} entry', 'Filter by {name}, {time}, {count} entries', { name: item.label, time: duration(item.seconds) })
                    : t('Filter by {name}, {time}', { name: item.label, time: duration(item.seconds) })
                }
                className={styles.patternRow}
              >
                <span className={styles.patternText}>
                  <span className={styles.patternLabel}>{item.label}</span>
                  {showCount ? <span className={styles.note}>{`${tn(item.count, '{count} entry', '{count} entries')} ·`}</span> : null}
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
  const series = useMemo(() => [{ id: 'recorded', name: t('Recorded time'), colorIndex: 0 }], []);
  const peak = analysis.hours.reduce<ExplorerPattern | null>((best, hour) => (!best || hour.seconds > best.seconds ? hour : best), null);
  return (
    <>
      <ActivityBars
        title={t('When you record work')}
        headingLevel={2}
        description={t('Hours by time of day, summed across this selection in your computer’s time zone.')}
        series={series}
        buckets={buckets}
        patterns={false}
        height="13rem"
        emptyMessage={t('No recorded time in this selection.')}
      />
      {peak && peak.seconds > 0 ? (
        <p className={styles.footnoteStrong}>{t('Most recorded hour: {hour} · {time} across the selection.', { hour: peak.label, time: duration(peak.seconds) })}</p>
      ) : null}
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
  const byMonth = slice.period === 'year';

  const table = (
    <DataTable
      caption={byMonth ? t('Task switches by month') : t('Task switches by day')}
      columns={[
        { id: 'label', header: byMonth ? t('Month') : t('Day') },
        { id: 'switches', header: t('Task switches'), align: 'end' },
        { id: 'blocks', header: t('Work blocks'), align: 'end' },
      ]}
      rows={rows.map((row) => ({ id: row.id, cells: { label: row.label, switches: String(row.switches), blocks: String(row.blocks) } }))}
    />
  );
  const footer = (
    <div className={styles.notes}>
      <p className={styles.secondary}>
        {t(
          'Inferred from recorded entries, not a measure of concentration. A switch changes ticket (or ticket-free activity/comment) within 15 minutes. Adjacent entries on the same task form one block; longer breaks and overlapping entries interrupt the sequence.',
        )}
      </p>
      {analysis.context.ambiguousEntries > 0 ? (
        <p className={styles.warningNote}>
          <WarningIcon className={styles.inlineIcon} />
          {tn(analysis.context.ambiguousEntries, '{count} invalid or overlapping segment excluded.', '{count} invalid or overlapping segments excluded.')}
        </p>
      ) : null}
    </div>
  );

  return (
    <ChartFrame
      title={t('Context switches')}
      headingLevel={2}
      description={t('Understand how your recorded work is divided across tasks.')}
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
              <span className={styles.number}>{tn(row.switches, '{count} switch', '{count} switches')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.secondary}>{tn(rows[0]?.switches ?? 0, '{count} task switch in this selection.', '{count} task switches in this selection.')}</p>
      )}
    </ChartFrame>
  );
}

/** 1.14 "Reading these patterns". */
function ReadingNotes({ analysis }: { analysis: AnalysisView }) {
  return (
    <Section title={t('Reading these patterns')}>
      <p className={styles.secondary}>
        {t(
          '{time} of clock time is covered by matching entries. Overlapping entries remain in recorded totals, but are excluded from context-switch and continuous-block calculations.',
          { time: duration(analysis.covered) },
        )}
      </p>
      <p className={styles.secondary}>
        {analysis.billableKnownCount > 0
          ? tn(
              analysis.count,
              'Billable time: {time} · supplied by 7pace for {known} of {count} entry.',
              'Billable time: {time} · supplied by 7pace for {known} of {count} entries.',
              { time: duration(analysis.billable), known: analysis.billableKnownCount },
            )
          : t('Billable time: Not supplied by 7pace for these entries.')}
      </p>
      <p className={styles.secondary}>
        {t(
          'Switches and blocks describe recorded entries, not attention or productivity. Applying filters can hide intervening tasks; clear filters for the complete sequence.',
        )}
      </p>
    </Section>
  );
}
