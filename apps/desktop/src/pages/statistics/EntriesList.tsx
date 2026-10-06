import { useRef, useState, type ReactNode } from 'react';
import { Banner } from '../../components/Banner';
import { Button, IconButton } from '../../components/Button';
import { Section } from '../../components/Card';
import { Skeleton } from '../../components/EmptyState';
import { TimeEditorIcon } from '../../components/icons';
import { Table, type TableColumn } from '../../components/Table';
import { SeriesSwatch } from '../../charts/palette';
import type { AnalysisView, ExplorerEntry, Interval } from '../../ipc/contract';
import { TicketLink } from '../../features/ticketContext/TicketLink';
import { useAction } from '../../state/hooks';
import { duration, entryTimes, instant, localDay, plural } from './format';
import { recordTitle, taskTitles } from './model';
import { useEntriesPage } from './useEntriesPage';
import { useOpenPage, useStableHandler } from './useOpenPage';
import styles from './Statistics.module.css';

/** Entries per `statistics.entries` page. The table never holds more than one page. */
export const ENTRIES_PAGE_SIZE = 100;

type Column = 'task' | 'when' | 'activity' | 'comment' | 'duration' | 'actions';

const COLUMNS: ReadonlyArray<TableColumn<Column>> = [
  { id: 'task', title: 'Task', isRowHeader: true, minWidth: '14rem' },
  { id: 'when', title: 'When', minWidth: '10rem' },
  { id: 'activity', title: 'Activity' },
  { id: 'comment', title: 'Comment', minWidth: '10rem' },
  { id: 'duration', title: 'Duration', align: 'end' },
  { id: 'actions', title: 'Actions', hideTitle: true },
];

export function entryId(entry: ExplorerEntry): string {
  return `${entry.record.log.id}:${entry.start}`;
}

interface ShownPart {
  start: string;
  end: string;
  seconds: number;
  /** Only part of the original worklog: clipped, split at midnight or cut to `clip`. */
  partial: boolean;
}

/**
 * The part of an entry shown: inside `clip` when set (1.14 `entryRow(clip:)`, a chart bar), else
 * the entry as the engine clipped it to the window and split it at midnight.
 */
function shownPart(entry: ExplorerEntry, clip: Interval | null): ShownPart {
  let start = Date.parse(entry.start);
  let end = Date.parse(entry.end);
  if (clip) {
    start = Math.max(start, Date.parse(clip.start));
    end = Math.min(end, Date.parse(clip.end));
  }
  const partial = start !== Date.parse(entry.record.start) || end !== Date.parse(entry.record.end);
  return { start: instant(new Date(start)), end: instant(new Date(end)), seconds: Math.max(0, (end - start) / 1000), partial };
}

export interface EntryTableProps {
  label: string;
  entries: readonly ExplorerEntry[];
  analysis: AnalysisView;
  colors: ReadonlyMap<string, number>;
  /** Show only the time inside this interval. */
  clip?: Interval | null;
}

/** Entry rows (1.14 `entryRow`): task, times, activity, comment, duration, Time editor. */
export function EntryTable({ label, entries, analysis, colors, clip = null }: EntryTableProps) {
  const titles = taskTitles(analysis);
  const editor = useAction();
  const openPage = useOpenPage();
  const openInEditor = useStableHandler((entry: ExplorerEntry) => {
    const { record } = entry;
    void editor.run({ type: 'timeEditor.setDay', day: localDay(record.start) });
    void editor.run({ type: 'timeEditor.setFilter', text: record.ticketId ? String(record.ticketId) : (record.log.comment ?? '') });
    openPage('timeEditor');
  });

  return (
    <Table<ExplorerEntry, Column>
      aria-label={label}
      density="compact"
      columns={COLUMNS}
      rows={entries}
      getRowId={entryId}
      getRowText={(entry) => recordTitle(entry.record, titles)}
      renderEmptyState={() => 'No matching entries. Try a different interval or clear your filters.'}
      renderCell={(entry, column) => {
        const { record } = entry;
        const title = recordTitle(record, titles);
        const part = shownPart(entry, clip);
        switch (column) {
          case 'task':
            return record.ticketId ? (
              <span className={styles.ticketCell}>
                <TicketLink ticketId={record.ticketId} title={titles.get(record.taskId) ?? null} />
              </span>
            ) : (
              <span className={styles.strong}>{title}</span>
            );
          case 'when':
            return <span className={styles.number}>{entryTimes(part.start, part.end)}</span>;
          case 'activity':
            return (
              <span className={styles.activityCell}>
                <SeriesSwatch index={colors.get(record.activityId) ?? 0} shape="circle" />
                {record.activityName}
              </span>
            );
          case 'comment':
            return record.log.comment ? <span className={styles.comment}>{record.log.comment}</span> : null;
          case 'duration':
            return (
              <span className={styles.durationCell}>
                <span className={styles.number}>{duration(part.seconds)}</span>
                {part.partial ? <span className={styles.note}>in selection</span> : null}
              </span>
            );
          case 'actions':
            return (
              <IconButton
                size="small"
                icon={TimeEditorIcon}
                label={`Edit entries for ${title} in Time editor`}
                onPress={() => openInEditor(entry)}
              />
            );
        }
      }}
    />
  );
}

export interface EntriesListProps {
  title: string;
  detail: string;
  analysis: AnalysisView;
  /** `analysisKey` of the slice: a new analysis starts again from the preview. */
  analysisKey: string;
  colors: ReadonlyMap<string, number>;
  /**
   * Only the entries overlapping this interval (a chart bar), from `statistics.entries {start,
   * end}`, each shown with its time inside it. Without it: the whole window, from the preview on.
   */
  within?: Interval | null;
  /** Controls next to the heading. */
  actions?: ReactNode;
  /** Content above the entries, e.g. the interval's activity breakdown. */
  children?: ReactNode;
}

/**
 * The entries behind the totals. The first entries (`entriesPreview`) show at once; "Show all"
 * pages through `statistics.entries`, one page of 100 at a time. A drill-down (`within`) starts
 * on its first page.
 */
export function EntriesList({ title, detail, analysis, analysisKey, colors, within = null, actions, children }: EntriesListProps) {
  const statusRef = useRef<HTMLParagraphElement>(null);
  const listKey = within ? `${analysisKey}|${within.start}|${within.end}` : analysisKey;
  const firstPage = within ? 0 : null;
  const [view, setView] = useState<{ key: string; page: number | null }>({ key: listKey, page: firstPage });
  const page = view.key === listKey ? view.page : firstPage;
  const offset = page === null ? null : page * ENTRIES_PAGE_SIZE;
  const loaded = useEntriesPage(analysisKey, offset, ENTRIES_PAGE_SIZE, within);
  const total = loaded.page?.total ?? (within ? 0 : analysis.entryCount);
  const pageCount = Math.max(1, Math.ceil(total / ENTRIES_PAGE_SIZE));

  const goTo = (next: number | null) => {
    setView({ key: listKey, page: next });
    // Keep keyboard focus in the list when the pressed button disappears or becomes disabled.
    requestAnimationFrame(() => statusRef.current?.focus());
  };

  const rows = page === null ? analysis.entriesPreview : (loaded.page?.entries ?? []);
  const first = offset ?? 0;
  const status =
    page === null
      ? analysis.entryCount > rows.length
        ? `Showing the first ${rows.length} of ${plural(analysis.entryCount, 'entry', 'entries')}`
        : plural(analysis.entryCount, 'entry', 'entries')
      : loaded.loading
        ? 'Loading entries…'
        : loaded.error
          ? 'Entries unavailable'
          : `Entries ${total === 0 ? 0 : first + 1}–${Math.min(total, first + rows.length)} of ${total}`;

  return (
    <Section title={title} subtitle={detail} actions={actions}>
      {children}
      {page !== null && loaded.error ? (
        <Banner
          tone="error"
          title="Could not load entries"
          actions={
            <Button size="small" onPress={loaded.retry}>
              Retry
            </Button>
          }
        >
          {loaded.error}
        </Banner>
      ) : null}
      {page !== null && loaded.loading ? (
        <div aria-hidden="true" className={styles.tableSkeleton}>
          <Skeleton lines={6} />
        </div>
      ) : (
        <EntryTable label={title} entries={rows} analysis={analysis} colors={colors} clip={within} />
      )}
      <div className={styles.pager}>
        <p ref={statusRef} tabIndex={-1} className={styles.pagerStatus} aria-live="polite">
          {status}
        </p>
        {page === null ? (
          analysis.entryCount > rows.length ? (
            <Button size="small" onPress={() => goTo(0)}>{`Show all ${analysis.entryCount} entries`}</Button>
          ) : null
        ) : (
          <>
            {pageCount > 1 ? (
              <>
                <Button size="small" isDisabled={page === 0 || loaded.loading} onPress={() => goTo(page - 1)}>
                  Previous entries
                </Button>
                <Button size="small" isDisabled={page >= pageCount - 1 || loaded.loading} onPress={() => goTo(page + 1)}>
                  Next entries
                </Button>
              </>
            ) : null}
            {within ? null : (
              <Button size="small" variant="plain" onPress={() => goTo(null)}>
                Show fewer
              </Button>
            )}
          </>
        )}
      </div>
    </Section>
  );
}
