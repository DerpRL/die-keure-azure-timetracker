import { max } from 'd3-array';
import { scaleLinear, scaleTime } from 'd3-scale';
import { area, curveStepAfter, line } from 'd3-shape';
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useFocusVisible } from 'react-aria';
import type { HeadingLevel } from '../components/Card';
import { ChartFrame } from './ChartFrame';
import { ChartTooltip } from './ChartTooltip';
import { DataTable } from './DataTable';
import { defaultFormatValue, defaultTickFormatter, formatAxisValue, formatDateTime } from './format';
import { focusMark, nextIndex } from './keyboard';
import type { TimeRange } from './ActivityBars';
import { useElementSize } from './useElementSize';
import styles from './charts.module.css';

export interface ProgressPoint {
  date: Date;
  /** Cumulative seconds at `date`. */
  value: number;
}

export interface CumulativeProgressProps {
  title: string;
  headingLevel?: HeadingLevel;
  description?: ReactNode;
  domain: TimeRange;
  /** Cumulative recorded time, in time order. Future time is never projected. */
  points: readonly ProgressPoint[];
  /**
   * Cumulative scheduled target (dashed). Pass it only for the full, unfiltered period: 1.14 shows
   * no target comparison for zoomed or filtered windows.
   */
  target?: readonly ProgressPoint[] | null;
  formatValue?: (seconds: number) => string;
  formatDate?: (date: Date) => string;
  formatTick?: (date: Date) => string;
  height?: string;
}

/** Stepped cumulative recorded time against a dashed target line, with keyboard inspection. */
export function CumulativeProgress({
  title,
  headingLevel,
  description,
  domain,
  points,
  target = null,
  formatValue = defaultFormatValue,
  formatDate = formatDateTime,
  formatTick,
  height = '15rem',
}: CumulativeProgressProps) {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const instructionsId = useId();
  const { isFocusVisible } = useFocusVisible();
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [tooltipHidden, setTooltipHidden] = useState(false);

  const font = size.fontSize;
  const margin = { top: font * 0.75, right: font * 1, bottom: font * 2, left: font * 3 };
  const plotWidth = Math.max(0, size.width - margin.left - margin.right);
  const plotHeight = Math.max(0, size.height - margin.top - margin.bottom);
  const tick = formatTick ?? defaultTickFormatter(domain);

  const { x, y, recordedPath, areaPath, targetPath } = useMemo(() => {
    const top = Math.max(1, ((max([...points.map((p) => p.value), ...(target ?? []).map((p) => p.value)]) ?? 0) / 3600) * 1.05);
    const xScale = scaleTime().domain([domain.start, domain.end]).range([0, plotWidth]);
    const yScale = scaleLinear().domain([0, top]).range([plotHeight, 0]).nice(5);
    const lineGenerator = line<ProgressPoint>()
      .x((p) => xScale(p.date))
      .y((p) => yScale(p.value / 3600))
      .curve(curveStepAfter);
    const areaGenerator = area<ProgressPoint>()
      .x((p) => xScale(p.date))
      .y0(plotHeight)
      .y1((p) => yScale(p.value / 3600))
      .curve(curveStepAfter);
    return {
      x: xScale,
      y: yScale,
      recordedPath: lineGenerator([...points]) ?? '',
      areaPath: areaGenerator([...points]) ?? '',
      targetPath: target ? (lineGenerator([...target]) ?? '') : '',
    };
  }, [points, target, domain.start, domain.end, plotWidth, plotHeight]);

  const targetAt = (date: Date): number | null => {
    if (!target?.length) return null;
    let value: number | null = null;
    for (const point of target) {
      if (point.date.getTime() <= date.getTime()) value = point.value;
      else break;
    }
    return value ?? 0;
  };

  const pointLabel = (index: number) => {
    const point = points[index];
    if (!point) return '';
    const goal = targetAt(point.date);
    return `${formatDate(point.date)}: ${formatValue(point.value)} recorded${goal === null ? '' : `, target ${formatValue(goal)}`}`;
  };

  const activeIndex = points.length === 0 ? -1 : Math.min(active, points.length - 1);
  const inspected = hovered ?? (focused !== null && isFocusVisible ? focused : null);
  const inspectedPoint = inspected === null ? undefined : points[inspected];

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left - margin.left;
    if (px < 0 || px > plotWidth || points.length === 0) {
      setHovered(null);
      return;
    }
    const time = x.invert(px).getTime();
    let best = 0;
    points.forEach((point, index) => {
      if (Math.abs(point.date.getTime() - time) < Math.abs((points[best]?.date.getTime() ?? 0) - time)) best = index;
    });
    setTooltipHidden(false);
    setHovered(best);
  };

  const onKeyDown = (event: KeyboardEvent<SVGElement>, index: number) => {
    const next = nextIndex(event.key, index, points.length, 'horizontal');
    if (next !== null) {
      event.preventDefault();
      setActive(next);
      setTooltipHidden(false);
      focusMark(svgRef.current, next);
    } else if (event.key === 'Escape' && !tooltipHidden) {
      event.stopPropagation();
      setTooltipHidden(true);
    }
  };

  const table = (
    <DataTable
      caption={title}
      columns={[
        { id: 'date', header: 'Time' },
        { id: 'recorded', header: 'Recorded', align: 'end' },
        ...(target ? [{ id: 'target', header: 'Scheduled target', align: 'end' as const }] : []),
      ]}
      rows={points.map((point, index) => {
        const goal = targetAt(point.date);
        return {
          id: `${index}`,
          cells: {
            date: formatDate(point.date),
            recorded: formatValue(point.value),
            target: goal === null ? '' : formatValue(goal),
          },
        };
      })}
    />
  );

  const legend = (
    <ul role="list" aria-label="Legend" className={styles.legend}>
      <li className={styles.legendItem}>
        <svg className={styles.swatch} viewBox="0 0 16 12" aria-hidden="true">
          <line x1={0} x2={16} y1={6} y2={6} className={styles.recordedLine} />
        </svg>
        <span>Recorded</span>
      </li>
      {target ? (
        <li className={styles.legendItem}>
          <svg className={styles.swatch} viewBox="0 0 16 12" aria-hidden="true">
            <line x1={0} x2={16} y1={6} y2={6} className={styles.targetLine} />
          </svg>
          <span>Scheduled target (dashed)</span>
        </li>
      ) : null}
    </ul>
  );

  return (
    <ChartFrame title={title} headingLevel={headingLevel} description={description} table={table} legend={legend}>
      <div ref={containerRef} className={styles.plot} style={{ height }}>
        {size.width > 0 ? (
          <svg
            ref={svgRef}
            width={size.width}
            height={size.height}
            role="group"
            aria-label={`${title}, cumulative line chart`}
            className={styles.svg}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHovered(null)}
          >
            <g transform={`translate(${margin.left},${margin.top})`}>
              <g aria-hidden="true">
                {y.ticks(5).map((value) => (
                  <g key={value}>
                    <line x1={0} x2={plotWidth} y1={y(value)} y2={y(value)} className={styles.gridLine} />
                    <text x={-font * 0.5} y={y(value)} dy="0.32em" textAnchor="end" className={styles.axisLabel}>
                      {formatAxisValue(value * 3600, 'hours')}
                    </text>
                  </g>
                ))}
                {x.ticks(6).map((date) => (
                  <text key={date.getTime()} x={x(date)} y={plotHeight + font * 1.3} textAnchor="middle" className={styles.axisLabel}>
                    {tick(date)}
                  </text>
                ))}
                <path d={areaPath} className={styles.recordedArea} />
                {targetPath ? <path d={targetPath} className={styles.targetLine} /> : null}
                <path d={recordedPath} className={styles.recordedLine} />
                <line x1={0} x2={plotWidth} y1={plotHeight} y2={plotHeight} className={styles.axisLine} />
              </g>
              <g role="listbox" aria-label={`${title}: points`} aria-orientation="horizontal" aria-describedby={instructionsId}>
                {points.map((point, index) => (
                  <circle
                    key={`${point.date.getTime()}-${index}`}
                    role="option"
                    aria-selected={index === inspected}
                    aria-label={pointLabel(index)}
                    tabIndex={index === activeIndex ? 0 : -1}
                    data-mark-index={index}
                    cx={x(point.date)}
                    cy={y(point.value / 3600)}
                    r={index === inspected ? 4.5 : 3}
                    className={index === inspected ? styles.pointActive : styles.point}
                    onKeyDown={(event) => onKeyDown(event, index)}
                    onFocus={() => {
                      setFocused(index);
                      setActive(index);
                      setTooltipHidden(false);
                    }}
                    onBlur={() => setFocused(null)}
                  />
                ))}
              </g>
              {inspectedPoint ? (
                <line
                  aria-hidden="true"
                  x1={x(inspectedPoint.date)}
                  x2={x(inspectedPoint.date)}
                  y1={0}
                  y2={plotHeight}
                  className={styles.rule}
                />
              ) : null}
              {focused !== null && isFocusVisible && points[focused] ? (
                <circle
                  aria-hidden="true"
                  cx={x(points[focused]?.date ?? domain.start)}
                  cy={y((points[focused]?.value ?? 0) / 3600)}
                  r={8}
                  className={styles.focusRing}
                />
              ) : null}
            </g>
          </svg>
        ) : null}
        {points.length === 0 && size.width > 0 ? <p className={styles.emptyOverlay}>No recorded time in this window.</p> : null}
        {inspectedPoint && inspected !== null && !tooltipHidden ? (
          <ChartTooltip
            x={margin.left + x(inspectedPoint.date)}
            y={margin.top + y(inspectedPoint.value / 3600)}
            containerWidth={size.width}
            title={formatDate(inspectedPoint.date)}
            lines={[
              `Recorded ${formatValue(inspectedPoint.value)}`,
              ...(target ? [`Target ${formatValue(targetAt(inspectedPoint.date) ?? 0)}`] : []),
            ]}
          />
        ) : null}
        <p id={instructionsId} className="visually-hidden">
          Use the Left and Right Arrow keys to move between points.
        </p>
      </div>
    </ChartFrame>
  );
}
