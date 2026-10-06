import { scaleTime } from 'd3-scale';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '../components/Button';
import type { HeadingLevel } from '../components/Card';
import { ZoomInIcon } from '../components/icons';
import { cx } from '../utils/cx';
import type { TimeRange } from './ActivityBars';
import { ChartFrame } from './ChartFrame';
import { ChartTooltip } from './ChartTooltip';
import { DataTable } from './DataTable';
import { defaultFormatValue, defaultTickFormatter, formatTime } from './format';
import { focusMark, isActivationKey, isZoomInKey, nextIndex } from './keyboard';
import { Legend } from './Legend';
import { colorIndexOf, seriesColor, seriesPattern, type ChartSeries } from './palette';
import styles from './charts.module.css';

export interface TimelineEntry {
  id: string;
  start: Date;
  end: Date;
  /** Row title, e.g. "#33624 · Improve loading". */
  label: string;
  /** Secondary text for the tooltip and table, e.g. the comment. */
  detail?: string;
  /** Series (activity) of the entry, for its colour and pattern. */
  seriesId: string;
}

export interface TimelineProps {
  title: string;
  headingLevel?: HeadingLevel;
  description?: ReactNode;
  domain: TimeRange;
  /** One row per entry, in the caller's order. Overlapping entries stay visible side by side. */
  entries: readonly TimelineEntry[];
  series: readonly ChartSeries[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** "Zoom to entry" (button, or + on a focused row). */
  onZoomToEntry?: (entry: TimelineEntry) => void;
  /** Rows per page; 1.14 pages after 12. */
  pageSize?: number;
  formatValue?: (seconds: number) => string;
  formatTime?: (date: Date) => string;
  formatTick?: (date: Date) => string;
  patterns?: boolean;
  emptyMessage?: string;
}

function durationSeconds(entry: TimelineEntry): number {
  return Math.max(0, (entry.end.getTime() - entry.start.getTime()) / 1000);
}

const PATTERN_CLASS: Record<string, string | undefined> = {
  diagonal: styles.patternDiagonal,
  dots: styles.patternDots,
  horizontal: styles.patternHorizontal,
  backDiagonal: styles.patternBackDiagonal,
  crosshatch: styles.patternCrosshatch,
  vertical: styles.patternVertical,
  grid: styles.patternGrid,
};

/**
 * Daily task timeline: one bar per entry on its own row, so gaps and overlaps stay visible.
 * Up/Down move between rows, Return selects, + zooms to the focused entry, Page Up/Down page.
 */
export function Timeline({
  title,
  headingLevel,
  description,
  domain,
  entries,
  series,
  selectedId = null,
  onSelect,
  onZoomToEntry,
  pageSize = 12,
  formatValue = defaultFormatValue,
  formatTime: formatClock = formatTime,
  formatTick,
  patterns = true,
  emptyMessage = 'No entries in this day. Choose another day or adjust the active filters.',
}: TimelineProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const instructionsId = useId();
  // A different set of entries starts on its first page (1.14 resets paging when the data
  // changes). Compared by ids, so a parent re-creating the same array keeps the page.
  const entriesKey = entries.map((entry) => entry.id).join('|');
  const [pageState, setPageState] = useState({ page: 0, key: entriesKey });
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number; width: number } | null>(null);

  let page = pageState.page;
  if (pageState.key !== entriesKey) {
    page = 0;
    setPageState({ page: 0, key: entriesKey });
  }

  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = entries.slice(currentPage * pageSize, currentPage * pageSize + pageSize);
  const activeIndex = visible.length === 0 ? -1 : Math.min(active, visible.length - 1);
  const x = scaleTime().domain([domain.start, domain.end]).range([0, 100]).clamp(true);
  const ticks = x.ticks(6);
  const tick = formatTick ?? defaultTickFormatter(domain);
  const selected = entries.find((entry) => entry.id === selectedId);

  const setPage = (next: number, focusRow: number | null = null) => {
    const clamped = Math.max(0, Math.min(pageCount - 1, next));
    setPageState({ page: clamped, key: entriesKey });
    if (focusRow !== null) {
      setActive(focusRow);
      requestAnimationFrame(() => focusMark(listRef.current, focusRow));
    }
  };

  const rowLabel = (entry: TimelineEntry) => {
    const activity = series.find((item) => item.id === entry.seriesId)?.name;
    return [
      entry.label,
      activity,
      `${formatClock(entry.start)} to ${formatClock(entry.end)}`,
      formatValue(durationSeconds(entry)),
      entry.detail,
    ]
      .filter(Boolean)
      .join(', ');
  };

  const toggle = (entry: TimelineEntry) => onSelect?.(entry.id === selectedId ? null : entry.id);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    const entry = visible[index];
    if (!entry) return;
    if (event.key === 'PageDown' || (event.key === 'ArrowDown' && index === visible.length - 1 && currentPage < pageCount - 1)) {
      event.preventDefault();
      setPage(currentPage + 1, 0);
      return;
    }
    if (event.key === 'PageUp' || (event.key === 'ArrowUp' && index === 0 && currentPage > 0)) {
      event.preventDefault();
      setPage(currentPage - 1, event.key === 'PageUp' ? 0 : pageSize - 1);
      return;
    }
    const next = nextIndex(event.key, index, visible.length, 'vertical');
    if (next !== null) {
      event.preventDefault();
      setActive(next);
      focusMark(listRef.current, next);
    } else if (isActivationKey(event.key)) {
      event.preventDefault();
      toggle(entry);
    } else if (isZoomInKey(event.key) && onZoomToEntry) {
      event.preventDefault();
      onZoomToEntry(entry);
    }
  };

  const hoveredEntry = hovered ? entries.find((entry) => entry.id === hovered.id) : undefined;
  const legendItems = series.map((entry, index) => ({ id: entry.id, label: entry.name, colorIndex: entry.colorIndex ?? index }));

  const table = (
    <DataTable
      caption={title}
      columns={[
        { id: 'label', header: 'Entry' },
        { id: 'activity', header: 'Activity' },
        { id: 'start', header: 'Start', align: 'end' },
        { id: 'end', header: 'End', align: 'end' },
        { id: 'duration', header: 'Duration', align: 'end' },
      ]}
      rows={entries.map((entry) => ({
        id: entry.id,
        cells: {
          label: entry.label,
          activity: series.find((item) => item.id === entry.seriesId)?.name ?? '',
          start: formatClock(entry.start),
          end: formatClock(entry.end),
          duration: formatValue(durationSeconds(entry)),
        },
      }))}
      emptyMessage={emptyMessage}
    />
  );

  const footer =
    entries.length > 0 ? (
      <div className={styles.timelineFooter}>
        {entries.length > pageSize ? (
          <div className={styles.pager}>
            <Button size="small" onPress={() => setPage(currentPage - 1)} isDisabled={currentPage === 0}>
              Previous entries
            </Button>
            <span className={styles.pagerStatus} aria-live="polite">
              {currentPage * pageSize + 1}–{Math.min(entries.length, (currentPage + 1) * pageSize)} of {entries.length} entries
            </span>
            <Button size="small" onPress={() => setPage(currentPage + 1)} isDisabled={currentPage >= pageCount - 1}>
              Next entries
            </Button>
          </div>
        ) : null}
        {selected && onZoomToEntry ? (
          <Button size="small" icon={ZoomInIcon} onPress={() => onZoomToEntry(selected)}>
            Zoom to entry
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <ChartFrame
      title={title}
      headingLevel={headingLevel}
      description={description}
      table={table}
      legend={<Legend items={legendItems} patterns={patterns} />}
      footer={footer}
    >
      {entries.length === 0 ? (
        <p className={styles.emptyText}>{emptyMessage}</p>
      ) : (
        <div className={styles.timeline}>
          <div className={styles.timelineAxis} aria-hidden="true">
            <span />
            <div className={styles.timelineTicks}>
              {ticks.map((date) => (
                <span key={date.getTime()} className={styles.timelineTick} style={{ left: `${x(date)}%` }}>
                  {tick(date)}
                </span>
              ))}
            </div>
          </div>
          <div className={styles.timelineBody}>
            <div
              ref={listRef}
              role="listbox"
              aria-label={`${title}: entries`}
              aria-describedby={instructionsId}
              className={styles.timelineRows}
            >
              {visible.map((entry, index) => {
                const left = x(entry.start);
                const width = Math.max(0.6, x(entry.end) - left);
                const colorIndex = colorIndexOf(series, entry.seriesId);
                const isSelected = entry.id === selectedId;
                return (
                  <div
                    key={entry.id}
                    role="option"
                    aria-selected={isSelected}
                    aria-label={rowLabel(entry)}
                    tabIndex={index === activeIndex ? 0 : -1}
                    data-mark-index={index}
                    className={cx(styles.timelineRow, isSelected && styles.timelineRowSelected)}
                    onKeyDown={(event) => onKeyDown(event, index)}
                    onFocus={() => setActive(index)}
                    onClick={() => toggle(entry)}
                    onPointerEnter={(event) => {
                      const bar = event.currentTarget.querySelector(`.${styles.timelineBar ?? 'bar'}`) ?? event.currentTarget;
                      const rect = bar.getBoundingClientRect();
                      const container = listRef.current?.getBoundingClientRect();
                      setHovered({
                        id: entry.id,
                        x: (container ? rect.left - container.left : 0) + rect.width / 2,
                        y: container ? rect.top - container.top : 0,
                        width: container?.width ?? 0,
                      });
                    }}
                    onPointerLeave={() => setHovered(null)}
                  >
                    <span className={styles.timelineLabel} aria-hidden="true">
                      {entry.label}
                    </span>
                    <span className={styles.timelineTrack} aria-hidden="true">
                      {ticks.map((date) => (
                        <span key={date.getTime()} className={styles.timelineGrid} style={{ left: `${x(date)}%` }} />
                      ))}
                      <span
                        className={cx(styles.timelineBar, patterns && PATTERN_CLASS[seriesPattern(colorIndex)])}
                        style={{ left: `${left}%`, width: `${width}%`, backgroundColor: seriesColor(colorIndex) }}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
            {hoveredEntry && hovered ? (
              <ChartTooltip
                x={hovered.x}
                y={hovered.y}
                containerWidth={hovered.width}
                title={hoveredEntry.label}
                lines={[
                  `${formatClock(hoveredEntry.start)} – ${formatClock(hoveredEntry.end)} · ${formatValue(durationSeconds(hoveredEntry))}`,
                  ...(hoveredEntry.detail ? [hoveredEntry.detail] : []),
                ]}
              />
            ) : null}
          </div>
          <p id={instructionsId} className="visually-hidden">
            Use the Up and Down Arrow keys to move between entries, Return to select one
            {onZoomToEntry ? ', plus to zoom to it' : ''}, and Page Up or Page Down to change pages.
          </p>
        </div>
      )}
    </ChartFrame>
  );
}
