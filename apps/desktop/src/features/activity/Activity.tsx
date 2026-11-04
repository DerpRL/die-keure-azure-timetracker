import type { CSSProperties } from 'react';
import { seriesColor } from '../../charts/palette';
import { cx } from '../../utils/cx';
import styles from './activity.module.css';

type Swatch = CSSProperties & { '--activity-color': string };

function swatchStyle(colorIndex: number): Swatch {
  return { '--activity-color': seriesColor(colorIndex) };
}

/**
 * An activity as a tinted chip with a coloured square: the name carries the meaning, the colour
 * matches the activity's marks in charts and day strips.
 */
export function ActivityChip({ name, colorIndex, className }: { name: string; colorIndex: number; className?: string }) {
  return (
    <span className={cx(styles.chip, className)} style={swatchStyle(colorIndex)}>
      <span className={styles.chipSwatch} aria-hidden="true" />
      <span className={styles.chipLabel}>{name}</span>
    </span>
  );
}

/** A small square in an activity's colour, for legends. Decorative: pair it with the name. */
export function ActivitySwatch({ colorIndex, className }: { colorIndex: number; className?: string }) {
  return <span className={cx(styles.swatch, className)} style={swatchStyle(colorIndex)} aria-hidden="true" />;
}

/** The vertical bar that leads a list row in its activity's colour. Decorative. */
export function ActivityPill({ colorIndex, className }: { colorIndex: number; className?: string }) {
  return <span className={cx(styles.pill, className)} style={swatchStyle(colorIndex)} aria-hidden="true" />;
}

export interface LegendEntry {
  id: string;
  name: string;
  colorIndex: number;
}

/** A row of swatches with names. */
export function ActivityLegend({ items, className }: { items: readonly LegendEntry[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <ul className={cx(styles.legend, className)} role="list" aria-label="Activities">
      {items.map((item) => (
        <li key={item.id} className={styles.legendItem}>
          <ActivitySwatch colorIndex={item.colorIndex} />
          {item.name}
        </li>
      ))}
    </ul>
  );
}
