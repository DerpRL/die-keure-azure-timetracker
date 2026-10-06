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

export interface HeatmapDay {
  /** Calendar date, ISO `YYYY-MM-DD`. Days must be consecutive and ascending. */
  date: string;
  /** Recorded seconds. */
  value: number;
  /** Long label; defaults to "Tuesday 7 October 2026". */
  label?: string;
  /** In-cell label for the large layout; defaults to "7 Oct". */
  shortLabel?: string;
  /** Extra detail for the tooltip, name and table, e.g. "4 entries · target 7h 36m". */
  detail?: string;
  /** Future days are shown with a dashed outline and "Future". */
  future?: boolean;
}

export interface CalendarHeatmapProps {
  title: string;
  headingLevel?: HeadingLevel;
  description?: ReactNode;
  days: readonly HeatmapDay[];
  /** `auto` picks the compact year layout above 62 days (as 1.14) and larger cells otherwise. */
  layout?: 'auto' | 'year' | 'month';
  /** Colour scale maximum; defaults to the larger of 1 h and the busiest day. */
  maxValue?: number;
  selectedDate?: string | null;
  /** Return or a click on a day, e.g. to open its timeline. */
  onSelectDay?: (date: string) => void;
  formatValue?: (seconds: number) => string;
  weekdayLabels?: readonly string[];
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY = 86_400_000;
const longFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });

function utc(date: string): number {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Monday = 0, as Swift `ExplorerCalendarDay.weekday`. */
function weekday(date: string): number {
  return (new Date(utc(date)).getUTCDay() + 6) % 7;
}

interface Hover {
  index: number;
  x: number;
  y: number;
  width: number;
}

/**
 * Calendar heatmap: every day is a cell, empty and future days included. A grid for assistive
 * technology: arrow keys move by day and week, Return selects the day.
 */
export function CalendarHeatmap({
  title,
  headingLevel,
  description,
  days,
  layout = 'auto',
  maxValue,
  selectedDate = null,
  onSelectDay,
  formatValue = defaultFormatValue,
  weekdayLabels = WEEKDAYS,
}: CalendarHeatmapProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  const { isFocusVisible } = useFocusVisible();
  const [active, setActive] = useState(0);
  const [hover, setHover] = useState<Hover | null>(null);
  const year = layout === 'year' || (layout === 'auto' && days.length > 62);
  const maximum = maxValue ?? Math.max(3600, ...days.map((day) => day.value));

  const model = useMemo(() => {
    const first = days[0];
    const offset = first ? weekday(first.date) : 0;
    const firstUtc = first ? utc(first.date) : 0;
    const cells = days.map((day, index) => {
      const position = Math.round((utc(day.date) - firstUtc) / DAY) + offset;
      return {
        day,
        index,
        week: Math.floor(position / 7),
        weekday: position % 7,
        label: day.label ?? longFormat.format(new Date(utc(day.date))),
        shortLabel: day.shortLabel ?? shortFormat.format(new Date(utc(day.date))),
      };
    });
    const weeks = cells.length ? (cells[cells.length - 1]?.week ?? 0) + 1 : 0;
    return { cells, weeks, offset };
  }, [days]);

  const describe = (index: number) => {
    const cell = model.cells[index];
    if (!cell) return '';
    const value = cell.day.future && cell.day.value === 0 ? 'future date' : formatValue(cell.day.value);
    return [`${cell.label}: ${value}`, cell.day.detail].filter(Boolean).join(', ');
  };

  const activeIndex = days.length === 0 ? -1 : Math.min(active, days.length - 1);

  const move = (index: number) => {
    const target = Math.max(0, Math.min(days.length - 1, index));
    setActive(target);
    gridRef.current?.querySelector<HTMLElement>(`[data-mark-index="${target}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    // Year layout: rows are weekdays, so Up/Down step a day and Left/Right a week.
    const steps: Record<string, number> = year
      ? { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }
      : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const step = steps[event.key];
    if (step !== undefined) {
      event.preventDefault();
      const target = index + step;
      if (target >= 0 && target < days.length) move(target);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(days.length - 1);
    } else if (isActivationKey(event.key)) {
      event.preventDefault();
      const day = days[index];
      if (day) onSelectDay?.(day.date);
    } else if (event.key === 'Escape' && hover) {
      event.stopPropagation();
      setHover(null);
    }
  };

  const showTooltip = (event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>, index: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const container = gridRef.current?.getBoundingClientRect();
    setHover({
      index,
      x: (container ? rect.left - container.left : 0) + rect.width / 2,
      y: container ? rect.top - container.top : 0,
      width: container?.width ?? 0,
    });
  };

  const renderCell = (index: number) => {
    const cell = model.cells[index];
    if (!cell) return null;
    const step = heatStep(cell.day.value, maximum);
    const selected = cell.day.date === selectedDate;
    return (
      <div
        key={cell.day.date}
        role="gridcell"
        aria-selected={selected}
        aria-label={describe(index)}
        tabIndex={index === activeIndex ? 0 : -1}
        data-mark-index={index}
        className={cx(
          styles.dayCell,
          year ? styles.dayCellCompact : styles.dayCellLarge,
          HEAT_CLASS[step],
          step >= 3 ? styles.onHigh : styles.onLow,
          cell.day.future && styles.future,
          selected && styles.cellSelected,
        )}
        onKeyDown={(event) => onKeyDown(event, index)}
        onFocus={(event) => {
          setActive(index);
          if (isFocusVisible) showTooltip(event, index);
        }}
        onBlur={() => setHover(null)}
        onClick={() => onSelectDay?.(cell.day.date)}
        onPointerEnter={(event) => showTooltip(event, index)}
        onPointerLeave={() => setHover(null)}
      >
        {year ? null : (
          <span aria-hidden="true" className={styles.dayCellText}>
            <span className={styles.dayCellDate}>{cell.shortLabel}</span>
            <span>{cell.day.future && cell.day.value === 0 ? 'Future' : formatValue(cell.day.value)}</span>
          </span>
        )}
      </div>
    );
  };

  const hovered = hover ? model.cells[hover.index] : undefined;

  const table = (
    <DataTable
      caption={title}
      columns={[
        { id: 'date', header: 'Date' },
        { id: 'value', header: 'Recorded', align: 'end' },
        { id: 'detail', header: 'Details' },
      ]}
      rows={model.cells.map((cell) => ({
        id: cell.day.date,
        cells: {
          date: cell.label,
          value: cell.day.future && cell.day.value === 0 ? 'Future' : formatValue(cell.day.value),
          detail: cell.day.detail ?? '',
        },
      }))}
    />
  );

  const gridStyle = { '--heat-columns': year ? model.weeks : 7 } as CSSProperties;

  return (
    <ChartFrame
      title={title}
      headingLevel={headingLevel}
      description={description}
      table={table}
      legend={<HeatLegend maximum={maximum} unit="per day" formatValue={formatValue} showFuture={days.some((day) => day.future)} />}
    >
      <div className={styles.heatContainer}>
        <div
          ref={gridRef}
          role="grid"
          aria-label={title}
          aria-describedby={instructionsId}
          className={cx(styles.heatGrid, year ? styles.heatYear : styles.heatMonth)}
          style={gridStyle}
        >
          {year ? (
            <>
              <div aria-hidden="true" className={styles.heatRow}>
                <span />
                {Array.from({ length: model.weeks }, (_, week) => {
                  const starter = model.cells.find(
                    (cell) => cell.week === week && cell.weekday === 0 && Number(cell.day.date.slice(8, 10)) <= 7,
                  );
                  return (
                    <span key={week} className={styles.monthLabel}>
                      {starter ? monthFormat.format(new Date(utc(starter.day.date))) : ''}
                    </span>
                  );
                })}
              </div>
              {weekdayLabels.map((name, weekdayIndex) => (
                <div key={name} role="row" className={styles.heatRow}>
                  <span role="rowheader" className={styles.rowHeader}>
                    {name}
                  </span>
                  {Array.from({ length: model.weeks }, (_, week) => {
                    const cell = model.cells.find((entry) => entry.week === week && entry.weekday === weekdayIndex);
                    return cell ? renderCell(cell.index) : <span key={`empty-${week}`} aria-hidden="true" />;
                  })}
                </div>
              ))}
            </>
          ) : (
            <>
              <div role="row" className={styles.heatRow}>
                {weekdayLabels.map((name) => (
                  <span key={name} role="columnheader" className={styles.columnHeader}>
                    {name}
                  </span>
                ))}
              </div>
              {Array.from({ length: Math.ceil((model.offset + days.length) / 7) }, (_, week) => (
                <div key={week} role="row" className={styles.heatRow}>
                  {Array.from({ length: 7 }, (_, weekdayIndex) => {
                    const cell = model.cells.find((entry) => entry.week === week && entry.weekday === weekdayIndex);
                    return cell ? (
                      renderCell(cell.index)
                    ) : (
                      <span key={`empty-${weekdayIndex}`} role="gridcell" className={styles.emptyCell} />
                    );
                  })}
                </div>
              ))}
            </>
          )}
        </div>
        {hovered && hover ? (
          <ChartTooltip
            x={hover.x}
            y={hover.y}
            containerWidth={hover.width}
            title={hovered.label}
            lines={[
              hovered.day.future && hovered.day.value === 0 ? 'Future date' : formatValue(hovered.day.value),
              ...(hovered.day.detail ? [hovered.day.detail] : []),
            ]}
          />
        ) : null}
        <p id={instructionsId} className="visually-hidden">
          {year
            ? 'Use Up and Down Arrow to move by day and Left and Right Arrow to move by week.'
            : 'Use the Arrow keys to move by day and week.'}{' '}
          {onSelectDay ? 'Press Return to open the day.' : ''}
        </p>
      </div>
    </ChartFrame>
  );
}
