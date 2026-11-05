import type { ReactNode } from 'react';
import { cx } from '../../../utils/cx';
import styles from './Statistics.module.css';

export interface MetricProps {
  title: string;
  value: string;
  note: ReactNode;
  /** `success` colours the value, e.g. a reached target. */
  tone?: 'default' | 'success';
}

/** One headline number (1.14 `metric`): title, value and a note. */
export function Metric({ title, value, note, tone = 'default' }: MetricProps) {
  return (
    <li className={styles.metric}>
      <p className={styles.metricTitle}>{title}</p>
      <p className={cx(styles.metricValue, tone === 'success' && styles.metricSuccess)}>{value}</p>
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
