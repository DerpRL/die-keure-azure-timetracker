import { arc, pie, type PieArcDatum } from 'd3-shape';
import { useMemo, useState, type ReactNode } from 'react';
import { ToggleButton, Toolbar } from 'react-aria-components';
import type { HeadingLevel } from '../components/Card';
import { FilterIcon } from '../components/icons';
import { cx } from '../utils/cx';
import { ChartFrame } from './ChartFrame';
import { ChartTooltip } from './ChartTooltip';
import { DataTable } from './DataTable';
import { defaultFormatValue } from './format';
import { SeriesPatternDefs, seriesFill, SeriesSwatch, useSvgId } from './palette';
import styles from './charts.module.css';

export interface DonutSlice {
  id: string;
  name: string;
  value: number;
  colorIndex?: number;
}

export interface DonutProps {
  title: string;
  headingLevel?: HeadingLevel;
  description?: ReactNode;
  slices: readonly DonutSlice[];
  /** The active filter. Selecting a slice (or its button) filters; selecting it again clears. */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  formatValue?: (seconds: number) => string;
  /** Under the total in the centre. */
  totalLabel?: string;
  patterns?: boolean;
  emptyMessage?: string;
}

const SIZE = 190;

function percent(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : '0%';
}

/**
 * Activity mix. Slices carry their own labels for screen readers; the keyboard model is the
 * labelled filter buttons beside the chart (a toolbar: arrow keys move, Space toggles).
 */
export function Donut({
  title,
  headingLevel,
  description,
  slices,
  selectedId = null,
  onSelect,
  formatValue = defaultFormatValue,
  totalLabel = 'recorded',
  patterns = true,
  emptyMessage = 'No recorded time in this selection.',
}: DonutProps) {
  const patternId = useSvgId();
  const [hovered, setHovered] = useState<string | null>(null);
  const visible = useMemo(() => slices.filter((slice) => slice.value > 0), [slices]);
  const total = visible.reduce((sum, slice) => sum + slice.value, 0);

  const arcs = useMemo(() => {
    const layout = pie<DonutSlice>()
      .sort(null)
      .value((slice) => slice.value)
      .padAngle(visible.length > 1 ? 0.02 : 0);
    return layout([...visible]);
  }, [visible]);

  const radius = SIZE / 2;
  const shape = arc<PieArcDatum<DonutSlice>>()
    .innerRadius(radius * 0.68)
    .outerRadius(radius - 4)
    .cornerRadius(3);
  const selectedShape = arc<PieArcDatum<DonutSlice>>()
    .innerRadius(radius * 0.68)
    .outerRadius(radius)
    .cornerRadius(3);

  const colorIndex = (slice: DonutSlice) => slice.colorIndex ?? slices.indexOf(slice);
  const toggle = (id: string) => onSelect?.(selectedId === id ? null : id);
  const hoveredArc = arcs.find((entry) => entry.data.id === hovered);
  const hoverPoint = hoveredArc ? shape.centroid(hoveredArc) : null;

  const table = (
    <DataTable
      caption={title}
      columns={[
        { id: 'name', header: 'Activity' },
        { id: 'value', header: 'Recorded', align: 'end' },
        { id: 'share', header: 'Share', align: 'end' },
      ]}
      rows={visible.map((slice) => ({
        id: slice.id,
        cells: { name: slice.name, value: formatValue(slice.value), share: percent(slice.value, total) },
      }))}
      emptyMessage={emptyMessage}
    />
  );

  return (
    <ChartFrame title={title} headingLevel={headingLevel} description={description} table={table}>
      {total === 0 ? (
        <p className={styles.emptyText}>{emptyMessage}</p>
      ) : (
        <div className={styles.donutLayout}>
          <div className={styles.donutChart}>
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width="100%" height="100%" role="group" aria-label={`${title}, doughnut chart`}>
              <SeriesPatternDefs prefix={patternId} count={8} />
              <g transform={`translate(${radius},${radius})`}>
                {arcs.map((entry) => {
                  const slice = entry.data;
                  const selected = slice.id === selectedId;
                  return (
                    <path
                      key={slice.id}
                      role="img"
                      aria-label={`${slice.name}: ${formatValue(slice.value)}, ${percent(slice.value, total)}${selected ? ', filtered' : ''}`}
                      d={(selected ? selectedShape(entry) : shape(entry)) ?? ''}
                      fill={seriesFill(patternId, colorIndex(slice), patterns)}
                      className={cx(styles.slice, selected && styles.sliceSelected, onSelect && styles.clickable)}
                      onPointerEnter={() => setHovered(slice.id)}
                      onPointerLeave={() => setHovered(null)}
                      onPointerUp={(event) => {
                        if (event.button === 0) toggle(slice.id);
                      }}
                    />
                  );
                })}
              </g>
            </svg>
            <div className={styles.donutCenter} aria-hidden="true">
              <span className={styles.donutTotal}>{formatValue(total)}</span>
              <span className={styles.donutTotalLabel}>{totalLabel}</span>
            </div>
            {hoveredArc && hoverPoint ? (
              <ChartTooltip
                x={((hoverPoint[0] + radius) / SIZE) * 100}
                y={((hoverPoint[1] + radius) / SIZE) * 100}
                containerWidth={100}
                title={hoveredArc.data.name}
                lines={[`${formatValue(hoveredArc.data.value)} · ${percent(hoveredArc.data.value, total)}`]}
                percentPosition
              />
            ) : null}
          </div>
          <Toolbar aria-label={`Filter by ${title.toLowerCase()}`} orientation="vertical" className={styles.filters}>
            {visible.map((slice) => (
              <ToggleButton
                key={slice.id}
                isSelected={slice.id === selectedId}
                onChange={() => toggle(slice.id)}
                isDisabled={!onSelect}
                aria-label={`Filter by ${slice.name}, ${formatValue(slice.value)}, ${percent(slice.value, total)}`}
                className={styles.filterButton}
                onHoverChange={(hovering) => setHovered(hovering ? slice.id : null)}
              >
                <SeriesSwatch index={colorIndex(slice)} patterns={patterns} shape="circle" />
                <span className={styles.filterName}>{slice.name}</span>
                <span className={styles.filterValue}>{formatValue(slice.value)}</span>
                <span className={styles.filterShare}>{percent(slice.value, total)}</span>
                <FilterIcon className={styles.filterIcon} />
              </ToggleButton>
            ))}
          </Toolbar>
        </div>
      )}
    </ChartFrame>
  );
}
