import type { ReactNode } from 'react';
import styles from './charts.module.css';

export interface ChartTooltipProps {
  /** Anchor in container pixels (usually the top centre of the mark). */
  x: number;
  y: number;
  containerWidth: number;
  title: ReactNode;
  lines?: readonly ReactNode[];
  /** Below the anchor instead of above it (for marks near the top edge). */
  below?: boolean;
  /** `x`, `y` and `containerWidth` are percentages of the container (for viewBox-scaled SVG). */
  percentPosition?: boolean;
}

/**
 * Visual tooltip for hovered or keyboard-focused marks. Hidden from assistive technology because
 * every mark already carries the same text in its accessible name. Escape hides it.
 */
export function ChartTooltip({ x, y, containerWidth, title, lines = [], below = false, percentPosition = false }: ChartTooltipProps) {
  // Keep the bubble inside the chart: shift the anchor point rather than overflow the card.
  const edge = Math.min(Math.max(x, 0), containerWidth);
  const align = edge < containerWidth * 0.2 ? 'start' : edge > containerWidth * 0.8 ? 'end' : 'center';
  const translateX = align === 'start' ? '0%' : align === 'end' ? '-100%' : '-50%';
  return (
    <div
      className={styles.tooltip}
      aria-hidden="true"
      style={{
        left: percentPosition ? `${edge}%` : edge,
        top: percentPosition ? `${y}%` : y,
        transform: `translate(${translateX}, ${below ? '0.5rem' : 'calc(-100% - 0.5rem)'})`,
      }}
    >
      <div className={styles.tooltipTitle}>{title}</div>
      {lines.map((line, index) => (
        <div key={index} className={styles.tooltipLine}>
          {line}
        </div>
      ))}
    </div>
  );
}
