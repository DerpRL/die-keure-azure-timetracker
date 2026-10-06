import {
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useFocusVisible } from 'react-aria';
import type { HeadingLevel } from '../components/Card';
import { cx } from '../utils/cx';
import { ChartFrame } from './ChartFrame';
import { ChartTooltip } from './ChartTooltip';
import { DataTable } from './DataTable';
import { defaultFormatValue } from './format';
import { HEAT_CLASS, HeatLegend, heatStep } from './heat';
import { isActivationKey } from './keyboard';
import styles from './charts.module.css';

export interface HourHeatmapRow {
  id: string;
  /** Short row label, e.g. "Tue 7 Oct". */
  label: string;
  /** Full label for screen readers and the table; defaults to `label`. */
  longLabel?: string;
}

export interface HourHeatmapCell {
  id: string;
  rowId: string;
  /** Chronological hour position in its day; a repeated DST hour gets its own slot. */
  slot: number;
  /** Hour label from the caller, e.g. "02:00" or "02:00 CET", so DST hours stay distinct. */
  label: string;
  /** Full label, e.g. "Sunday 25 October, 02:00 CEST"; defaults to row and hour labels. */
  longLabel?: string;
  /** Recorded seconds. */
  value: number;
}

export interface HourHeatmapProps {
  title: string;
  headingLevel?: HeadingLevel;
  description?: ReactNode;
  rows: readonly HourHeatmapRow[];
  cells: readonly HourHeatmapCell[];
  maxValue?: number;
  selectedId?: string | null;
  /** Return or click, e.g. to zoom to that hour. */
  onSelectCell?: (cell: HourHeatmapCell) => void;
  formatValue?: (seconds: number) => string;
  /** Show the hour label above every n-th cell (and each row's first cell). */
  labelEvery?: number;
}

interface Hover {
  id: string;
  x: number;
  y: number;
  width: number;
}

/** Day × hour heatmap. Left/Right move within a day, Up/Down to the same hour of another day. */
export function HourHeatmap({
  title,
  headingLevel,
  description,
  rows,
  cells,
  maxValue,
  selectedId = null,
  onSelectCell,
  formatValue = defaultFormatValue,
  labelEvery = 3,
}: HourHeatmapProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const { isFocusVisible } = useFocusVisible();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const maximum = maxValue ?? Math.max(3600, ...cells.map((cell) => cell.value));

  const model = useMemo(() => {
    const byRow = rows.map((row) =>
      cells.filter((cell) => cell.rowId === row.id).sort((a, b) => a.slot - b.slot),
    );
    const columns = Math.max(0, ...cells.map((cell) => cell.slot + 1));
    return { byRow, columns };
  }, [rows, cells]);

  const firstCell = model.byRow.find((row) => row.length > 0)?.[0];
  const tabStop = cells.some((cell) => cell.id === activeId) ? activeId : (firstCell?.id ?? null);

  const describe = (cell: HourHeatmapCell, row: HourHeatmapRow | undefined) =>
    `${cell.longLabel ?? `${row?.longLabel ?? row?.label ?? ''}, ${cell.label}`}: ${formatValue(cell.value)}`;

  const focusCell = (cell: HourHeatmapCell | undefined) => {
    if (!cell) return;
    setActiveId(cell.id);
    const target = [...(gridRef.current?.querySelectorAll<HTMLElement>('[data-cell-id]') ?? [])].find(
      (element) => element.dataset.cellId === cell.id,
    );
    target?.focus();
  };

  const nearest = (rowCells: readonly HourHeatmapCell[] | undefined, slot: number) =>
    rowCells?.reduce<HourHeatmapCell | undefined>(
      (best, cell) => (!best || Math.abs(cell.slot - slot) < Math.abs(best.slot - slot) ? cell : best),
      undefined,
    );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, rowIndex: number, cellIndex: number) => {
    const rowCells = model.byRow[rowIndex] ?? [];
    const cell = rowCells[cellIndex];
    if (!cell) return;
    const moveRow = (direction: number) => {
      for (let index = rowIndex + direction; index >= 0 && index < model.byRow.length; index += direction) {
        const target = nearest(model.byRow[index], cell.slot);
        if (target) return focusCell(target);
      }
    };
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusCell(rowCells[Math.min(rowCells.length - 1, cellIndex + 1)]);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusCell(rowCells[Math.max(0, cellIndex - 1)]);
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveRow(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveRow(-1);
        break;
      case 'Home':
        event.preventDefault();
        focusCell(event.ctrlKey || event.metaKey ? model.byRow.find((row) => row.length)?.[0] : rowCells[0]);
        break;
      case 'End':
        event.preventDefault();
        focusCell(
          event.ctrlKey || event.metaKey
            ? [...model.byRow].reverse().find((row) => row.length)?.at(-1)
            : rowCells[rowCells.length - 1],
        );
        break;
      case 'Escape':
        if (hover) {
          event.stopPropagation();
          setHover(null);
        }
        break;
      default:
        if (isActivationKey(event.key)) {
          event.preventDefault();
          onSelectCell?.(cell);
        }
    }
  };

  const showTooltip = (event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>, id: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const container = gridRef.current?.getBoundingClientRect();
    setHover({
      id,
      x: (container ? rect.left - container.left : 0) + rect.width / 2,
      y: container ? rect.top - container.top : 0,
      width: container?.width ?? 0,
    });
  };

  const hovered = hover ? cells.find((cell) => cell.id === hover.id) : undefined;
  const hoveredRow = hovered ? rows.find((row) => row.id === hovered.rowId) : undefined;

  const table = (
    <DataTable
      caption={title}
      columns={[
        { id: 'day', header: 'Day' },
        { id: 'hour', header: 'Hour' },
        { id: 'value', header: 'Recorded', align: 'end' },
      ]}
      rows={rows.flatMap((row, rowIndex) =>
        (model.byRow[rowIndex] ?? []).map((cell) => ({
          id: cell.id,
          cells: { day: row.longLabel ?? row.label, hour: cell.label, value: formatValue(cell.value) },
        })),
      )}
    />
  );

  const gridStyle = { '--heat-columns': model.columns } as CSSProperties;

  return (
    <ChartFrame
      title={title}
      headingLevel={headingLevel}
      description={description}
      table={table}
      legend={<HeatLegend maximum={maximum} unit="per cell" formatValue={formatValue} />}
    >
      <div className={styles.heatContainer}>
        <div
          ref={gridRef}
          role="grid"
          aria-label={title}
          aria-describedby={instructionsId}
          className={cx(styles.heatGrid, styles.heatHours)}
          style={gridStyle}
        >
          {rows.map((row, rowIndex) => {
            const rowCells = model.byRow[rowIndex] ?? [];
            const bySlot = new Map(rowCells.map((cell, index) => [cell.slot, { cell, index }]));
            return (
              <div key={row.id} role="row" className={styles.heatRow}>
                <span role="rowheader" className={styles.rowHeader}>
                  {row.label}
                </span>
                {Array.from({ length: model.columns }, (_, slot) => {
                  const entry = bySlot.get(slot);
                  if (!entry) return <span key={`empty-${slot}`} aria-hidden="true" />;
                  const { cell, index } = entry;
                  const step = heatStep(cell.value, maximum);
                  const showLabel = slot % labelEvery === 0 || index === 0;
                  return (
                    <div
                      key={cell.id}
                      role="gridcell"
                      aria-selected={cell.id === selectedId}
                      aria-label={describe(cell, row)}
                      tabIndex={cell.id === tabStop ? 0 : -1}
                      data-cell-id={cell.id}
                      className={cx(styles.hourCell, cell.id === selectedId && styles.cellSelected)}
                      onKeyDown={(event) => onKeyDown(event, rowIndex, index)}
                      onFocus={(event) => {
                        setActiveId(cell.id);
                        if (isFocusVisible) showTooltip(event, cell.id);
                      }}
                      onBlur={() => setHover(null)}
                      onClick={() => onSelectCell?.(cell)}
                      onPointerEnter={(event) => showTooltip(event, cell.id)}
                      onPointerLeave={() => setHover(null)}
                    >
                      <span aria-hidden="true" className={styles.hourLabel}>
                        {showLabel ? cell.label : ' '}
                      </span>
                      <span aria-hidden="true" className={cx(styles.hourBlock, HEAT_CLASS[step])} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {hovered && hover ? (
          <ChartTooltip
            x={hover.x}
            y={hover.y}
            containerWidth={hover.width}
            title={hovered.longLabel ?? `${hoveredRow?.label ?? ''}, ${hovered.label}`}
            lines={[formatValue(hovered.value)]}
          />
        ) : null}
        <p id={instructionsId} className="visually-hidden">
          Use Left and Right Arrow to move between hours and Up and Down Arrow to move between days.
          {onSelectCell ? ' Press Return to zoom to the hour.' : ''}
        </p>
      </div>
    </ChartFrame>
  );
}
