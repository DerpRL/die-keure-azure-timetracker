import styles from './charts.module.css';
import { SeriesSwatch } from './palette';

export interface LegendItem {
  id: string;
  label: string;
  colorIndex: number;
  /** Optional total, e.g. "12h 30m". */
  value?: string;
}

/** Series key in the same order as the stack, so position is a third signal after colour and pattern. */
export function Legend({ items, patterns = true, label = 'Legend' }: { items: readonly LegendItem[]; patterns?: boolean; label?: string }) {
  if (items.length === 0) return null;
  return (
    <ul role="list" aria-label={label} className={styles.legend}>
      {items.map((item) => (
        <li key={item.id} className={styles.legendItem}>
          <SeriesSwatch index={item.colorIndex} patterns={patterns} />
          <span>{item.label}</span>
          {item.value ? <span className={styles.legendValue}>{item.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}
