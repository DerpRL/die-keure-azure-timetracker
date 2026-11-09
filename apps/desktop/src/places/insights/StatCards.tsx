import { Button } from '../../components/Button';
import { t, tn } from '../../i18n';
import type { AnalysisView, StatisticsSlice } from '../../ipc/contract';
import { FilterChips } from './explore/Filters';
import { duration, percent, windowTitle } from './explore/format';
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
      title: t('Recorded'),
      value: duration(analysis.total),
      note: targeted
        ? t('{percent} of {target} target', { percent: percent(analysis.total, analysis.target), target: duration(analysis.target) })
        : `${tn(analysis.count, '{count} entry', '{count} entries')} · ${tn(analysis.trackedDays, '{count} tracked day', '{count} tracked days')}`,
    },
    { title: t('Tickets'), value: String(analysis.tasks.length), note: t('incl. work without a ticket') },
    { title: t('Typical entry'), value: duration(analysis.median), note: t('median') },
    analysis.billableKnownCount > 0
      ? {
          title: t('Billable'),
          value: duration(analysis.billable),
          note: tn(analysis.count, '{known} of {count} entry', '{known} of {count} entries', { known: analysis.billableKnownCount }),
        }
      : { title: t('Billable'), value: '–', note: t('Not supplied by 7pace') },
  ];
}

/** The stat cards row (2.2 "S3 · Insights"): Recorded, Tickets, Typical entry, Billable. */
export function StatCards({ slice, analysis }: { slice: StatisticsSlice; analysis: AnalysisView }) {
  return (
    <ul role="list" aria-label={t('Totals')} className={styles.stats}>
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
    <section aria-label={t('Scope')} className={styles.scope}>
      {slice.isZoomed ? (
        <div className={styles.scopeRow}>
          <p className={styles.scopeTitle} aria-live="polite" aria-atomic="true">
            {t('Selected window · {window}', { window: windowTitle(slice.window) })}
          </p>
          <Button size="small" onPress={() => void reset.run({ type: 'statistics.resetZoom' })}>
            {t('Reset zoom')}
          </Button>
        </div>
      ) : null}
      {filtered ? <p className={styles.scopeNote}>{t('All totals and charts use your active filters.')}</p> : null}
      <FilterChips slice={slice} />
    </section>
  );
}
