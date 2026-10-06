/**
 * Display helpers over the `statistics` slice: chart series, filter chips and labels. Nothing here
 * decides what is analysed; the engine filters, clips and totals, the page only presents.
 */
import type { ChartSeries } from '../../charts/palette';
import type { AnalysisView, ExplorerActivity, ExplorerFilter, ExplorerRecord, StatisticsSlice } from '../../ipc/contract';
import { lengthBandName, weekdayName } from './format';

/** `StatisticsZoom::MINIMUM`: the engine never zooms below 15 minutes. */
export const MIN_WINDOW_SECONDS = 15 * 60;

export const EMPTY_FILTER: ExplorerFilter = { query: '', activityId: null, taskId: null, weekday: null, lengthBand: null };

/** `ExplorerFilter::is_active`. */
export function isFilterActive(filter: ExplorerFilter): boolean {
  return (
    filter.query.trim() !== '' ||
    filter.activityId !== null ||
    filter.taskId !== null ||
    filter.weekday !== null ||
    filter.lengthBand !== null
  );
}

/**
 * Identifies one analysis result. Paged entries and view selections (a chosen bar, a page of
 * entries) belong to the analysis they came from and reset when this changes.
 */
export function analysisKey(slice: StatisticsSlice): string {
  const { filter } = slice;
  return [
    slice.range.start,
    slice.range.end,
    slice.window.start,
    slice.window.end,
    filter.query,
    filter.activityId ?? '',
    filter.taskId ?? '',
    filter.weekday ?? '',
    filter.lengthBand ?? '',
    slice.syncedAt ?? '',
    slice.analysis?.entryCount ?? '',
  ].join('|');
}

/**
 * Colour index per activity, stable while filters change: activities of the downloaded period in
 * ID order, as 1.14 assigned its palette.
 */
export function activityColors(available: readonly ExplorerActivity[], analysis: AnalysisView): Map<string, number> {
  const ids = [...new Set([...available.map((activity) => activity.id), ...analysis.activities.map((activity) => activity.id)])].sort();
  return new Map(ids.map((id, index) => [id, index]));
}

/** Stack order of the time chart: activity ID order, like the engine's segments. */
export function activitySeries(analysis: AnalysisView, colors: ReadonlyMap<string, number>): ChartSeries[] {
  return [...analysis.activities]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((activity) => ({ id: activity.id, name: activity.name, colorIndex: colors.get(activity.id) ?? 0 }));
}

/** `ExplorerRecord.fallbackTitle`. */
export function fallbackTitle(record: ExplorerRecord): string {
  if (record.ticketId) return `Azure ticket #${record.ticketId}`;
  return record.log.comment?.trim() || record.activityName;
}

/** The title the engine resolved for a record's task, else the 1.14 fallback. */
export function recordTitle(record: ExplorerRecord, titles: ReadonlyMap<string, string>): string {
  return titles.get(record.taskId) ?? fallbackTitle(record);
}

/** "#4821 · Checkout: retry failed card payments" or the ticket-free title. */
export function recordLabel(record: ExplorerRecord, titles: ReadonlyMap<string, string>): string {
  const title = recordTitle(record, titles);
  return record.ticketId ? `#${record.ticketId} · ${title}` : title;
}

export function taskTitles(analysis: AnalysisView): Map<string, string> {
  return new Map(analysis.tasks.map((task) => [task.id, task.title]));
}

export interface FilterChip {
  id: keyof ExplorerFilter;
  label: string;
  /** The filter without this part. */
  without: ExplorerFilter;
}

/** The active filters as removable chips, in the order of the filter bar. */
export function filterChips(filter: ExplorerFilter, analysis: AnalysisView | null, available: readonly ExplorerActivity[]): FilterChip[] {
  const chips: FilterChip[] = [];
  const query = filter.query.trim();
  if (query) chips.push({ id: 'query', label: `Search: “${query}”`, without: { ...filter, query: '' } });
  if (filter.activityId !== null) {
    const name = available.find((activity) => activity.id === filter.activityId)?.name ?? 'Selected activity (no entries)';
    chips.push({ id: 'activityId', label: `Activity: ${name}`, without: { ...filter, activityId: null } });
  }
  if (filter.taskId !== null) {
    const task = analysis?.tasks.find((item) => item.id === filter.taskId);
    const title = task ? (task.ticketId ? `#${task.ticketId} ${task.title}` : task.title) : 'Selected task';
    chips.push({ id: 'taskId', label: `Task: ${title}`, without: { ...filter, taskId: null } });
  }
  if (filter.weekday !== null) {
    chips.push({ id: 'weekday', label: `Weekday: ${weekdayName(filter.weekday)}`, without: { ...filter, weekday: null } });
  }
  if (filter.lengthBand !== null) {
    chips.push({ id: 'lengthBand', label: `Entries: ${lengthBandName(filter.lengthBand)}`, without: { ...filter, lengthBand: null } });
  }
  return chips;
}
