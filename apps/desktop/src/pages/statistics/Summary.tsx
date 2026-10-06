import { useId, type ReactNode } from 'react';
import { Button } from '../../components/Button';
import { CalendarIcon, ClockIcon, DayReviewIcon, HistoryIcon, StatisticsIcon, type IconComponent } from '../../components/icons';
import type { AnalysisView, StatisticsSlice } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { duration, percent, plural, windowTitle } from './format';
import { isFilterActive } from './model';
import styles from './Statistics.module.css';

export interface MetricProps {
  title: string;
  value: string;
  note: ReactNode;
  icon: IconComponent;
}

/** One headline number (1.14 `metric`): title, value and a note. */
export function Metric({ title, value, note, icon: Icon }: MetricProps) {
  return (
    <li className={styles.metric}>
      <p className={styles.metricTitle}>
        <Icon className={styles.inlineIcon} />
        {title}
      </p>
      <p className={styles.metricValue}>{value}</p>
      <p className={styles.metricNote}>{note}</p>
    </li>
  );
}

export function MetricList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul role="list" aria-label={label} className={styles.metrics}>
      {children}
    </ul>
  );
}

/**
 * The scope of every number below (whole period or zoomed window, filtered or not) and the
 * headline totals (1.14 `scopeHeader` and `metrics`).
 */
export function Summary({ slice, analysis }: { slice: StatisticsSlice; analysis: AnalysisView }) {
  const headingId = useId();
  const reset = useAction();
  const filtered = isFilterActive(slice.filter);
  return (
    <section aria-labelledby={headingId} className={styles.summary}>
      <div className={styles.scope}>
        <div className={styles.scopeText}>
          <h2 id={headingId} className={styles.scopeTitle} aria-live="polite" aria-atomic="true">
            {slice.isZoomed ? `Selected window · ${windowTitle(slice.window)}` : `Whole ${slice.period}`}
          </h2>
          <p className={styles.secondary}>
            {filtered ? 'All totals and charts below use your active filters.' : 'All activities and tasks · recorded time only'}
          </p>
        </div>
        {slice.isZoomed ? (
          <Button size="small" onPress={() => void reset.run({ type: 'statistics.resetZoom' })}>
            Reset zoom
          </Button>
        ) : null}
      </div>
      <MetricList label="Totals">
        <Metric
          title="Recorded time"
          value={duration(analysis.total)}
          note={`${plural(analysis.count, 'entry', 'entries')} · ${plural(analysis.trackedDays, 'tracked day')}`}
          icon={ClockIcon}
        />
        <Metric title="Tasks worked on" value={String(analysis.tasks.length)} note="Tickets and work without a ticket" icon={DayReviewIcon} />
        <Metric title="Typical entry" value={duration(analysis.median)} note="Median duration inside this window" icon={HistoryIcon} />
        {slice.targetComparable ? (
          <Metric
            title="Period target"
            value={analysis.target > 0 ? percent(analysis.total, analysis.target) : 'Not set'}
            note={`of ${duration(analysis.target)} scheduled`}
            icon={StatisticsIcon}
          />
        ) : (
          <Metric
            title="Average tracked day"
            value={duration(analysis.trackedDays > 0 ? analysis.total / analysis.trackedDays : 0)}
            note="Across days with matching entries"
            icon={CalendarIcon}
          />
        )}
      </MetricList>
    </section>
  );
}
