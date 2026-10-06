import { max } from 'd3-array';
import { scaleBand, scaleLinear } from 'd3-scale';
import { stack } from 'd3-shape';
import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useFocusVisible } from 'react-aria';
import type { HeadingLevel } from '../components/Card';
import { cx } from '../utils/cx';
import { ChartFrame } from './ChartFrame';
import { ChartTooltip } from './ChartTooltip';
import { DataTable } from './DataTable';
import { defaultFormatValue, formatAxisValue } from './format';
import { focusMark, isActivationKey, isZoomInKey, isZoomOutKey, nextIndex } from './keyboard';
import { Legend } from './Legend';
import { colorIndexOf, SeriesPatternDefs, seriesFill, useSvgId, type ChartSeries } from './palette';
import { useElementSize } from './useElementSize';
import styles from './charts.module.css';

export interface ActivityBucket {
  id: string;
  start: Date;
  end: Date;
  /** Short axis label, e.g. "Tue 7" or "09:00". */
  label: string;
  /** Full label for tooltips, screen readers and the table, e.g. "Tue 7 Oct, 09:00 – 10:00". */
  longLabel?: string;
  /** Recorded seconds per series id. */
  values: Readonly<Record<string, number>>;
}

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface ActivityBarsProps {
  title: string;
  headingLevel?: HeadingLevel;
  description?: ReactNode;
  /** Stack order, bottom to top, and the legend. */
  series: readonly ChartSeries[];
  buckets: readonly ActivityBucket[];
  selectedId?: string | null;
  /** Click or Return selects a bucket; selecting it again clears the selection. */
  onSelect?: (bucketId: string | null) => void;
  /** Dragging across buckets, or + on a focused bar, zooms to that range. */
  onZoom?: (range: TimeRange) => void;
  /** − on a focused bar. */
  onZoomOut?: () => void;
  valueUnit?: 'hours' | 'minutes';
  formatValue?: (seconds: number) => string;
  patterns?: boolean;
  actions?: ReactNode;
  /** CSS height of the plot. */
  height?: string;
  emptyMessage?: string;
}

const DRAG_THRESHOLD = 8;

interface Drag {
  pointerId: number;
  startX: number;
  currentX: number;
  captured: boolean;
}

/**
 * Time explorer bars (README "Statistics (1.8)"): activity-stacked buckets with a hover rule,
 * click to select, drag in either direction to zoom, and a keyboard model — arrows move between
 * buckets, Return selects, + zooms into the focused bucket and − zooms out.
 */
export function ActivityBars({
  title,
  headingLevel,
  description,
  series,
  buckets,
  selectedId = null,
  onSelect,
  onZoom,
  onZoomOut,
  valueUnit = 'hours',
  formatValue = defaultFormatValue,
  patterns = true,
  actions,
  height = '17rem',
  emptyMessage = 'No recorded time in this window.',
}: ActivityBarsProps) {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const patternId = useSvgId();
  const instructionsId = useId();
  const { isFocusVisible } = useFocusVisible();
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [tooltipHidden, setTooltipHidden] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);

  const font = size.fontSize;
  const margin = { top: font * 0.75, right: font * 0.5, bottom: font * 2, left: font * 3 };
  const plotWidth = Math.max(0, size.width - margin.left - margin.right);
  const plotHeight = Math.max(0, size.height - margin.top - margin.bottom);
  const unitSeconds = valueUnit === 'minutes' ? 60 : 3600;

  const model = useMemo(() => {
    const totals = buckets.map((bucket) => series.reduce((sum, entry) => sum + Math.max(0, bucket.values[entry.id] ?? 0), 0));
    const minimum = valueUnit === 'minutes' ? 5 : 1;
    const y = scaleLinear()
      .domain([0, Math.max(minimum, ((max(totals) ?? 0) / unitSeconds) * 1.1)])
      .range([plotHeight, 0])
      .nice(5);
    const x = scaleBand<string>()
      .domain(buckets.map((bucket) => bucket.id))
      .range([0, plotWidth])
      .paddingInner(buckets.length > 60 ? 0.06 : 0.15)
      .paddingOuter(0.08);
    const layers = stack<ActivityBucket, string>()
      .keys(series.map((entry) => entry.id))
      .value((bucket, key) => Math.max(0, bucket.values[key] ?? 0))([...buckets]);
    return { totals, x, y, layers };
  }, [buckets, series, plotHeight, plotWidth, unitSeconds, valueUnit]);

  const { totals, x, y, layers } = model;
  const bandwidth = x.bandwidth();
  const selectedIndex = buckets.findIndex((bucket) => bucket.id === selectedId);
  const activeIndex = buckets.length === 0 ? -1 : Math.min(active, buckets.length - 1);
  const hasData = totals.some((total) => total > 0);
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(plotWidth / (font * 4.5)))));

  const bucketLabel = (index: number): string => {
    const bucket = buckets[index];
    if (!bucket) return '';
    const parts = series
      .map((entry) => ({ entry, value: bucket.values[entry.id] ?? 0 }))
      .filter(({ value }) => value > 0)
      .map(({ entry, value }) => `${entry.name} ${formatValue(value)}`);
    return `${bucket.longLabel ?? bucket.label}: ${formatValue(totals[index] ?? 0)} recorded${parts.length ? `. ${parts.join(', ')}` : ''}`;
  };

  const plotX = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX - rect.left - margin.left;
  };

  const indexAt = (px: number): number | null => {
    if (buckets.length === 0) return null;
    let best = 0;
    let distance = Infinity;
    buckets.forEach((bucket, index) => {
      const center = (x(bucket.id) ?? 0) + bandwidth / 2;
      const d = Math.abs(center - px);
      if (d < distance) {
        distance = d;
        best = index;
      }
    });
    return best;
  };

  const toggle = (index: number) => {
    const bucket = buckets[index];
    if (!bucket || !onSelect) return;
    setActive(index);
    onSelect(bucket.id === selectedId ? null : bucket.id);
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const px = plotX(event);
    setTooltipHidden(false);
    setHovered(px >= 0 && px <= plotWidth ? indexAt(px) : null);
    if (drag && drag.pointerId === event.pointerId) {
      const moved = Math.abs(px - drag.startX) >= DRAG_THRESHOLD;
      if (moved && !drag.captured) event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({ ...drag, currentX: px, captured: drag.captured || moved });
    }
  };

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || !onZoom) return;
    const px = plotX(event);
    setDrag({ pointerId: event.pointerId, startX: px, currentX: px, captured: false });
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const px = plotX(event);
    setDrag(null);
    if (Math.abs(px - drag.startX) < DRAG_THRESHOLD || !onZoom) return;
    const from = indexAt(Math.max(0, Math.min(drag.startX, px)));
    const to = indexAt(Math.min(plotWidth, Math.max(drag.startX, px)));
    const first = from === null ? undefined : buckets[from];
    const last = to === null ? undefined : buckets[to];
    if (first && last) onZoom({ start: first.start, end: last.end });
  };

  const onKeyDown = (event: KeyboardEvent<SVGGElement>, index: number) => {
    const next = nextIndex(event.key, index, buckets.length, 'horizontal');
    if (next !== null) {
      event.preventDefault();
      setActive(next);
      setTooltipHidden(false);
      focusMark(svgRef.current, next);
      return;
    }
    const bucket = buckets[index];
    if (!bucket) return;
    if (isActivationKey(event.key)) {
      event.preventDefault();
      toggle(index);
    } else if (isZoomInKey(event.key) && onZoom) {
      event.preventDefault();
      onZoom({ start: bucket.start, end: bucket.end });
    } else if (isZoomOutKey(event.key) && onZoomOut) {
      event.preventDefault();
      onZoomOut();
    } else if (event.key === 'Escape') {
      if (!tooltipHidden) {
        event.stopPropagation();
        setTooltipHidden(true);
      } else if (selectedId && onSelect) {
        event.stopPropagation();
        onSelect(null);
      }
    }
  };

  const inspected = hovered ?? (focused !== null && isFocusVisible ? focused : null);
  const inspectedBucket = inspected === null ? undefined : buckets[inspected];
  const dragging = drag !== null && Math.abs(drag.currentX - drag.startX) >= DRAG_THRESHOLD;

  const instructions = [
    'Use the Left and Right Arrow keys to move between intervals',
    onSelect ? 'Return to select one' : null,
    onZoom ? 'plus to zoom into it' : null,
    onZoomOut ? 'minus to zoom out' : null,
  ]
    .filter(Boolean)
    .join(', ');

  const table = (
    <DataTable
      caption={title}
      columns={[
        { id: 'interval', header: 'Interval' },
        ...series.map((entry) => ({ id: entry.id, header: entry.name, align: 'end' as const })),
        { id: 'total', header: 'Total', align: 'end' },
      ]}
      rows={buckets.map((bucket, index) => ({
        id: bucket.id,
        cells: {
          interval: bucket.longLabel ?? bucket.label,
          ...Object.fromEntries(series.map((entry) => [entry.id, formatValue(bucket.values[entry.id] ?? 0)])),
          total: formatValue(totals[index] ?? 0),
        },
      }))}
    />
  );

  return (
    <ChartFrame
      title={title}
      headingLevel={headingLevel}
      description={description}
      actions={actions}
      table={table}
      legend={<Legend items={series.map((entry, index) => ({ id: entry.id, label: entry.name, colorIndex: entry.colorIndex ?? index }))} patterns={patterns} />}
    >
      <div ref={containerRef} className={styles.plot} style={{ height }}>
        {size.width > 0 && buckets.length > 0 ? (
          <svg
            ref={svgRef}
            width={size.width}
            height={size.height}
            role="group"
            aria-label={`${title}, stacked bar chart`}
            className={cx(styles.svg, onZoom && styles.zoomable)}
            onPointerMove={onPointerMove}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
            onPointerLeave={() => setHovered(null)}
          >
            <SeriesPatternDefs prefix={patternId} count={8} />
            <g transform={`translate(${margin.left},${margin.top})`}>
              <g aria-hidden="true">
                {y.ticks(5).map((tick) => (
                  <g key={tick}>
                    <line x1={0} x2={plotWidth} y1={y(tick)} y2={y(tick)} className={styles.gridLine} />
                    <text x={-font * 0.5} y={y(tick)} dy="0.32em" textAnchor="end" className={styles.axisLabel}>
                      {formatAxisValue(tick * unitSeconds, valueUnit)}
                    </text>
                  </g>
                ))}
              </g>
              {selectedIndex >= 0 ? (
                <rect
                  aria-hidden="true"
                  x={(x(buckets[selectedIndex]?.id ?? '') ?? 0) - 2}
                  y={0}
                  width={bandwidth + 4}
                  height={plotHeight}
                  className={styles.selectionBand}
                />
              ) : null}
              <g role="listbox" aria-label={`${title}: intervals`} aria-orientation="horizontal" aria-describedby={instructionsId}>
                {buckets.map((bucket, index) => {
                  const left = x(bucket.id) ?? 0;
                  const selected = bucket.id === selectedId;
                  return (
                    <g
                      key={bucket.id}
                      role="option"
                      aria-selected={selected}
                      aria-label={bucketLabel(index)}
                      tabIndex={index === activeIndex ? 0 : -1}
                      data-mark-index={index}
                      className={styles.mark}
                      onKeyDown={(event) => onKeyDown(event, index)}
                      onFocus={() => {
                        setFocused(index);
                        setActive(index);
                        setTooltipHidden(false);
                      }}
                      onBlur={() => setFocused(null)}
                      onClick={() => toggle(index)}
                    >
                      <rect x={left} y={0} width={bandwidth} height={plotHeight} className={styles.hit} />
                      {layers.map((layer, layerIndex) => {
                        const point = layer[index];
                        const entry = series[layerIndex];
                        if (!point || !entry) return null;
                        const [low, high] = point;
                        if (high - low <= 0) return null;
                        const top = y(high / unitSeconds);
                        return (
                          <rect
                            key={entry.id}
                            x={left}
                            y={top}
                            width={bandwidth}
                            height={Math.max(1, y(low / unitSeconds) - top)}
                            fill={seriesFill(patternId, colorIndexOf(series, entry.id), patterns)}
                            className={styles.segment}
                          />
                        );
                      })}
                    </g>
                  );
                })}
              </g>
              <line x1={0} x2={plotWidth} y1={plotHeight} y2={plotHeight} className={styles.axisLine} aria-hidden="true" />
              <g aria-hidden="true">
                {buckets.map((bucket, index) =>
                  index % labelEvery === 0 || bucket.id === selectedId ? (
                    <text
                      key={bucket.id}
                      x={(x(bucket.id) ?? 0) + bandwidth / 2}
                      y={plotHeight + font * 1.3}
                      textAnchor="middle"
                      className={cx(styles.axisLabel, bucket.id === selectedId && styles.axisLabelSelected)}
                    >
                      {bucket.label}
                    </text>
                  ) : null,
                )}
                {selectedIndex >= 0 ? (
                  <rect
                    x={x(buckets[selectedIndex]?.id ?? '') ?? 0}
                    y={plotHeight + 2}
                    width={bandwidth}
                    height={3}
                    className={styles.selectionMarker}
                  />
                ) : null}
              </g>
              {inspectedBucket && !dragging ? (
                <line
                  aria-hidden="true"
                  x1={(x(inspectedBucket.id) ?? 0) + bandwidth / 2}
                  x2={(x(inspectedBucket.id) ?? 0) + bandwidth / 2}
                  y1={0}
                  y2={plotHeight}
                  className={styles.rule}
                />
              ) : null}
              {drag && dragging ? (
                <rect
                  aria-hidden="true"
                  x={Math.max(0, Math.min(drag.startX, drag.currentX))}
                  y={0}
                  width={Math.min(plotWidth, Math.max(drag.startX, drag.currentX)) - Math.max(0, Math.min(drag.startX, drag.currentX))}
                  height={plotHeight}
                  className={styles.dragBand}
                />
              ) : null}
              {focused !== null && isFocusVisible && buckets[focused] ? (
                <rect
                  aria-hidden="true"
                  x={(x(buckets[focused]?.id ?? '') ?? 0) - 3}
                  y={-3}
                  width={bandwidth + 6}
                  height={plotHeight + 6}
                  rx={4}
                  className={styles.focusRing}
                />
              ) : null}
            </g>
          </svg>
        ) : null}
        {buckets.length === 0 || (!hasData && size.width > 0) ? <p className={styles.emptyOverlay}>{emptyMessage}</p> : null}
        {inspectedBucket && inspected !== null && !tooltipHidden && !dragging ? (
          <ChartTooltip
            x={margin.left + (x(inspectedBucket.id) ?? 0) + bandwidth / 2}
            y={margin.top + y((totals[inspected] ?? 0) / unitSeconds)}
            containerWidth={size.width}
            title={inspectedBucket.longLabel ?? inspectedBucket.label}
            lines={[
              `${formatValue(totals[inspected] ?? 0)} recorded`,
              ...series
                .filter((entry) => (inspectedBucket.values[entry.id] ?? 0) > 0)
                .map((entry) => `${entry.name}: ${formatValue(inspectedBucket.values[entry.id] ?? 0)}`),
            ]}
          />
        ) : null}
        <p id={instructionsId} className="visually-hidden">
          {instructions}.
        </p>
      </div>
    </ChartFrame>
  );
}
