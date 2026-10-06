import { useId } from 'react';
import styles from './charts.module.css';

/** A data series (activity). `colorIndex` keeps an activity's colour stable across filters. */
export interface ChartSeries {
  id: string;
  name: string;
  colorIndex?: number;
}

export const SERIES_COLOR_COUNT = 8;

export function seriesColor(index: number): string {
  return `var(--chart-${(((index % SERIES_COLOR_COUNT) + SERIES_COLOR_COUNT) % SERIES_COLOR_COUNT) + 1})`;
}

export type PatternKind =
  | 'solid'
  | 'diagonal'
  | 'dots'
  | 'horizontal'
  | 'backDiagonal'
  | 'crosshatch'
  | 'vertical'
  | 'grid';

/**
 * Second signal next to colour: every series index has its own fill pattern, so stacked bars,
 * slices and timeline bars stay distinguishable in forced colours and for colour-blind users.
 */
export const PATTERN_KINDS: readonly PatternKind[] = [
  'solid',
  'diagonal',
  'dots',
  'horizontal',
  'backDiagonal',
  'crosshatch',
  'vertical',
  'grid',
];

export function seriesPattern(index: number): PatternKind {
  return PATTERN_KINDS[((index % PATTERN_KINDS.length) + PATTERN_KINDS.length) % PATTERN_KINDS.length] ?? 'solid';
}

export function colorIndexOf(series: readonly ChartSeries[], id: string): number {
  const position = series.findIndex((entry) => entry.id === id);
  const entry = series[position];
  return entry?.colorIndex ?? Math.max(0, position);
}

function PatternShape({ kind }: { kind: PatternKind }) {
  const ink = { stroke: 'var(--chart-pattern-ink)', strokeWidth: 1.25 };
  switch (kind) {
    case 'solid':
      return null;
    case 'diagonal':
      return <path d="M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6" {...ink} />;
    case 'backDiagonal':
      return <path d="M-2 6 L2 10 M0 0 L8 8 M6 -2 L10 2" {...ink} />;
    case 'horizontal':
      return <path d="M0 2 H8 M0 6 H8" {...ink} />;
    case 'vertical':
      return <path d="M2 0 V8 M6 0 V8" {...ink} />;
    case 'crosshatch':
      return <path d="M0 8 L8 0 M0 0 L8 8" {...ink} />;
    case 'grid':
      return <path d="M0 4 H8 M4 0 V8" {...ink} />;
    case 'dots':
      return (
        <>
          <circle cx={2} cy={2} r={1.1} fill="var(--chart-pattern-ink)" />
          <circle cx={6} cy={6} r={1.1} fill="var(--chart-pattern-ink)" />
        </>
      );
  }
}

/** `<pattern>` definitions for `count` series, referenced with `seriesFill(prefix, index)`. */
export function SeriesPatternDefs({ prefix, count }: { prefix: string; count: number }) {
  return (
    <defs>
      {Array.from({ length: Math.max(count, 1) }, (_, index) => (
        <pattern key={index} id={`${prefix}-${index}`} width={8} height={8} patternUnits="userSpaceOnUse">
          <rect width={8} height={8} fill={seriesColor(index)} />
          <PatternShape kind={seriesPattern(index)} />
        </pattern>
      ))}
    </defs>
  );
}

export function seriesFill(prefix: string, index: number, patterns: boolean): string {
  return patterns ? `url(#${prefix}-${index})` : seriesColor(index);
}

/** A `useId` value that is safe inside SVG `url(#…)` references. */
export function useSvgId(): string {
  return `c${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** Legend swatch with the same colour and pattern as the marks. */
export function SeriesSwatch({ index, patterns = true, shape = 'square' }: { index: number; patterns?: boolean; shape?: 'square' | 'circle' }) {
  const id = useSvgId();
  return (
    <svg className={styles.swatch} viewBox="0 0 12 12" aria-hidden="true">
      {patterns ? (
        <defs>
          <pattern id={`${id}-p`} width={8} height={8} patternUnits="userSpaceOnUse">
            <rect width={8} height={8} fill={seriesColor(index)} />
            <PatternShape kind={seriesPattern(index)} />
          </pattern>
        </defs>
      ) : null}
      {shape === 'circle' ? (
        <circle cx={6} cy={6} r={5.5} fill={patterns ? `url(#${id}-p)` : seriesColor(index)} className={styles.swatchShape} />
      ) : (
        <rect x={0.5} y={0.5} width={11} height={11} rx={2} fill={patterns ? `url(#${id}-p)` : seriesColor(index)} className={styles.swatchShape} />
      )}
    </svg>
  );
}
