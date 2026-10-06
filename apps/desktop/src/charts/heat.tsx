import { formatAxisValue } from './format';
import styles from './charts.module.css';

/** 0 for empty, 1…5 for increasing values relative to `maximum`. */
export function heatStep(value: number, maximum: number): number {
  if (!(value > 0) || !(maximum > 0)) return 0;
  return 1 + Math.min(4, Math.floor(Math.min(1, value / maximum) * 5 - 1e-9));
}

export const HEAT_CLASS = [styles.heat0, styles.heat1, styles.heat2, styles.heat3, styles.heat4, styles.heat5];

/** Scale key: "0h ▢▢▢▢▢ 7h 36m per day", plus the future-day note when relevant. */
export function HeatLegend({
  maximum,
  unit,
  formatValue,
  showFuture = false,
}: {
  maximum: number;
  unit: string;
  formatValue: (seconds: number) => string;
  showFuture?: boolean;
}) {
  return (
    <div className={styles.heatLegend}>
      <span>{formatAxisValue(0, 'hours')}</span>
      <span className={styles.heatScale} aria-hidden="true">
        {HEAT_CLASS.map((className, index) => (
          <span key={index} className={`${styles.heatSwatch} ${className ?? ''}`} />
        ))}
      </span>
      <span>
        {formatValue(maximum)} {unit}
      </span>
      {showFuture ? <span className={styles.heatFutureNote}>Dashed outline: future date</span> : null}
    </div>
  );
}
