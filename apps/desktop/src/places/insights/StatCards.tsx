import { Button } from '../../components/Button';
import type { AnalysisView, StatisticsSlice } from '../../ipc/contract';
import { FilterChips } from './explore/Filters';
import { duration, percent, plural, windowTitle } from './explore/format';
import { isFilterActive } from './explore/model';
import { useAction } from '../../state/hooks';
import styles from './insights.module.css';

interface Stat {
  title: string;
  value: string;
  note: string;
}

/** The four headline numbers over the period (or zoomed window), with the active filters applied. */
export function statsOf(slice: StatisticsSlice, analysis: AnalysisView): Stat[] {
  const targeted = slice.targetComparable && analysis.target > 0;
  return [
    {
      title: 'Recorded',
      value: duration(analysis.total),
      note: targeted
        ? `${percent(analysis.total, analysis.target)} of ${duration(analysis.target)} target`
        : `${plural(analysis.count, 'entry', 'entries')} · ${plural(analysis.trackedDays, 'tracked day')}`,
    },
    { title: 'Tickets', value: String(analysis.tasks.length), note: 'incl. work without a ticket' },
    { title: 'Typical entry', value: duration(analysis.median), note: 'median' },
    analysis.billableKnownCount > 0
      ? {
          title: 'Billable',
          value: duration(analysis.billable),
          note: `${analysis.billableKnownCount} of ${plural(analysis.count, 'entry', 'entries')}`,
        }
      : { title: 'Billable', value: '–', note: 'Not supplied by 7pace' },
  ];
}

/** The stat cards row (2.2 "S3 · Insights"): Recorded, Tickets, Typical entry, Billable. */
export function StatCards({ slice, analysis }: { slice: StatisticsSlice; analysis: AnalysisView }) {
  return (
    <ul role="list" aria-label="Totals" className={styles.stats}>
      {statsOf(slice, analysis).map((stat) => (
        <li key={stat.title} className={styles.stat}>
          <span className={styles.statTitle}>{stat.title}</span>
          <span className={styles.statValue}>{stat.value}</span>
          <span className={styles.statNote}>{stat.note}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the numbers cover when it is not simply the whole period: a zoomed window (with Reset zoom)
 * and the active filters as removable chips. Nothing for the plain period.
 */
export function ScopeLine({ slice }: { slice: StatisticsSlice }) {
  const reset = useAction();
  const filtered = isFilterActive(slice.filter);
  if (!slice.isZoomed && !filtered) return null;
  return (
    <section aria-label="Scope" className={styles.scope}>
      {slice.isZoomed ? (
        <div className={styles.scopeRow}>
          <p className={styles.scopeTitle} aria-live="polite" aria-atomic="true">
            {`Selected window · ${windowTitle(slice.window)}`}
          </p>
          <Button size="small" onPress={() => void reset.run({ type: 'statistics.resetZoom' })}>
            Reset zoom
          </Button>
        </div>
      ) : null}
      {filtered ? <p className={styles.scopeNote}>All totals and charts use your active filters.</p> : null}
      <FilterChips slice={slice} />
    </section>
  );
}
