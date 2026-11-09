import { useId, useRef, useState, type ReactNode } from 'react';
import { Banner } from '../../../components/Banner';
import { Button, IconButton } from '../../../components/Button';
import { Card, SectionHeading } from '../../../components/Card';
import { Skeleton } from '../../../components/EmptyState';
import { TimeEditorIcon } from '../../../components/icons';
import { Table, type TableColumn } from '../../../components/Table';
import { mark, t, tn } from '../../../i18n';
import type { AnalysisView, ExplorerEntry, Interval } from '../../../ipc/contract';
import { ActivityChip } from '../../../features/activity';
import { TicketLink } from '../../../features/ticketContext/TicketLink';
import { useAction } from '../../../state/hooks';
import { duration, entryTimes, instant, localDay } from './format';
import { recordTitle, taskTitles } from './model';
import { useEntriesPage } from './useEntriesPage';
import { useOpenPage, useStableHandler } from './useOpenPage';
import styles from './Statistics.module.css';

/** Entries per `statistics.entries` page. The table never holds more than one page. */
export const ENTRIES_PAGE_SIZE = 100;

type Column = 'task' | 'when' | 'activity' | 'comment' | 'duration' | 'actions';

const COLUMNS: ReadonlyArray<TableColumn<Column>> = [
  { id: 'task', title: mark('Task'), isRowHeader: true, minWidth: '14rem' },
  { id: 'when', title: mark('When'), minWidth: '10rem' },
  { id: 'activity', title: mark('Activity') },
  { id: 'comment', title: mark('Comment'), minWidth: '10rem' },
  { id: 'duration', title: mark('Duration'), align: 'end' },
  { id: 'actions', title: mark('Actions'), hideTitle: true },
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
  /** Edge to edge inside a flush card: no frame of its own. */
  flush?: boolean;
}

/** Entry rows (1.14 `entryRow`): task, times, activity, comment, duration, Time editor. */
export function EntryTable({ label, entries, analysis, colors, clip = null, flush = false }: EntryTableProps) {
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
      className={flush ? styles.flushTable : undefined}
      columns={COLUMNS.map((column) => ({ ...column, title: t(column.title) }))}
      rows={entries}
      getRowId={entryId}
      getRowText={(entry) => recordTitle(entry.record, titles)}
      renderEmptyState={() => t('No matching entries. Try a different interval or clear your filters.')}
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
            return <span className={styles.when}>{entryTimes(part.start, part.end)}</span>;
          case 'activity':
            return <ActivityChip name={record.activityName} colorIndex={colors.get(record.activityId) ?? 0} />;
          case 'comment':
            return record.log.comment ? <span className={styles.comment}>{record.log.comment}</span> : null;
          case 'duration':
            return (
              <span className={styles.durationCell}>
                <span className={styles.duration}>{duration(part.seconds)}</span>
                {part.partial ? <span className={styles.note}>{t('in selection')}</span> : null}
              </span>
            );
          case 'actions':
            return (
              <IconButton
                size="small"
                icon={TimeEditorIcon}
                label={t('Edit entries for {title} in Time editor', { title })}
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
  const headingId = useId();
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
        ? tn(analysis.entryCount, 'Showing the first {shown} of {count} entry', 'Showing the first {shown} of {count} entries', { shown: rows.length })
        : tn(analysis.entryCount, '{count} entry', '{count} entries')
      : loaded.loading
        ? t('Loading entries…')
        : loaded.error
          ? t('Entries unavailable')
          : t('Entries {from}–{to} of {total}', { from: total === 0 ? 0 : first + 1, to: Math.min(total, first + rows.length), total });

  return (
    <Card as="section" aria-labelledby={headingId} padding="none" className={styles.entriesCard}>
      <div className={styles.entriesHead}>
        <SectionHeading id={headingId} level={2} title={title} subtitle={detail} actions={actions} size="group" />
        {children}
        {page !== null && loaded.error ? (
          <Banner
            tone="error"
            title={t('Could not load entries')}
            actions={
              <Button size="small" onPress={loaded.retry}>
                {t('Retry')}
              </Button>
            }
          >
            {loaded.error}
          </Banner>
        ) : null}
      </div>
      {page !== null && loaded.loading ? (
        <div aria-hidden="true" className={styles.tableSkeleton}>
          <Skeleton lines={6} />
        </div>
      ) : (
        <EntryTable label={title} entries={rows} analysis={analysis} colors={colors} clip={within} flush />
      )}
      <div className={styles.pager}>
        <p ref={statusRef} tabIndex={-1} className={styles.pagerStatus} aria-live="polite">
          {status}
        </p>
        {page === null ? (
          analysis.entryCount > rows.length ? (
            <Button size="small" onPress={() => goTo(0)}>{t('Show all {count} entries', { count: analysis.entryCount })}</Button>
          ) : null
        ) : (
          <>
            {pageCount > 1 ? (
              <>
                <Button size="small" isDisabled={page === 0 || loaded.loading} onPress={() => goTo(page - 1)}>
                  {t('Previous entries')}
                </Button>
                <Button size="small" isDisabled={page >= pageCount - 1 || loaded.loading} onPress={() => goTo(page + 1)}>
                  {t('Next entries')}
                </Button>
              </>
            ) : null}
            {within ? null : (
              <Button size="small" variant="plain" onPress={() => goTo(null)}>
                {t('Show fewer')}
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
