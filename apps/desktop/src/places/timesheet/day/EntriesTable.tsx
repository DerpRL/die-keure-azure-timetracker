import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { RunningIcon } from '../../../components/icons';
import { Table, type Selection, type TableColumn } from '../../../components/Table';
import { ActivityChip, activityColorIndex, useActivityColors } from '../../../features/activity';
import type { WorkItemsSlice, WorkLog } from '../../../ipc/contract';
import { formatClockTime, formatDateTime, logEnd, logStart, logTicket, timeEditorTitle } from '../../../features/ticketContext/format';
import { TicketLink } from '../../../features/ticketContext/TicketLink';
import { formatShortDuration } from '../../../utils/duration';
import styles from './TimeEditor.module.css';
import { cx } from '../../../utils/cx';
import { mark, t, tn } from '../../../i18n';

type Column = 'task' | 'time' | 'duration' | 'activity' | 'comment' | 'action';

const COLUMNS: TableColumn<Column>[] = [
  { id: 'task', title: mark('Work item'), isRowHeader: true, minWidth: '14rem' },
  { id: 'time', title: mark('Time') },
  { id: 'duration', title: mark('Duration'), align: 'end' },
  { id: 'activity', title: mark('Activity') },
  { id: 'comment', title: mark('Comment'), minWidth: '10rem' },
  { id: 'action', title: mark('Action') },
];

/** "10m", or "1h 5m" from an hour. */
function formatOverlap(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? t('{minutes}m', { minutes }) : formatShortDuration(minutes * 60);
}

function TimeCell({ date }: { date: Date | null }) {
  if (!date) return <span>{t('Unknown')}</span>;
  return (
    <time dateTime={date.toISOString()} title={formatDateTime(date)} className={styles.mono}>
      {formatClockTime(date)}
    </time>
  );
}

export interface EntriesTableProps {
  logs: readonly WorkLog[];
  items: WorkItemsSlice | undefined;
  selection: readonly string[];
  runningLogId: string | null;
  /** Overlapping seconds per entry, among the listed entries. */
  overlaps?: ReadonlyMap<string, number>;
  /** Overlaps among the listed entries, for the summary line. */
  overlapCount?: number;
  /** Entries at least this long get a "Long" chip (the day check's threshold). */
  longSeconds?: number;
  disabled: boolean;
  labelledBy: string;
  emptyMessage: string;
  className?: string;
  onSelectionChange: (ids: string[]) => void;
  onEdit: (log: WorkLog) => void;
}

/** The day's entries with checkboxes for merging (1.14 `timeTable`). */
export function EntriesTable({
  logs,
  items,
  selection,
  runningLogId,
  overlaps,
  overlapCount = 0,
  longSeconds,
  disabled,
  labelledBy,
  emptyMessage,
  className,
  onSelectionChange,
  onEdit,
}: EntriesTableProps) {
  const colors = useActivityColors();
  const total = logs.reduce((sum, log) => sum + (Number.isFinite(log.length) ? Math.max(log.length, 0) : 0), 0);
  return (
    <div className={cx(styles.tableCard, className)}>
      <Table<WorkLog, Column>
        aria-labelledby={labelledBy}
        columns={COLUMNS.map((column) => ({ ...column, title: t(column.title) }))}
        rows={logs}
        getRowId={(log) => log.id}
        getRowText={(log) => t('{title} at {time}', { title: timeEditorTitle(log, items), time: formatClockTime(logStart(log)) })}
        selectionMode="multiple"
        selectedKeys={new Set(selection)}
        onSelectionChange={(keys: Selection) => {
          if (disabled) return;
          onSelectionChange(keys === 'all' ? logs.map((log) => log.id) : [...keys].map(String));
        }}
        density="compact"
        className={styles.table}
        getRowClassName={(log) => ((overlaps?.get(log.id) ?? 0) > 0 ? styles.overlapRow : undefined)}
        renderEmptyState={() => emptyMessage}
        renderCell={(log, column) => {
          switch (column) {
            case 'task': {
              const ticket = logTicket(log);
              const overlap = (overlaps?.get(log.id) ?? 0) > 0;
              const long = longSeconds !== undefined && log.length >= longSeconds;
              return (
                <span className={styles.task}>
                  {ticket !== null ? (
                    <TicketLink ticketId={ticket} title={items?.[String(ticket)]?.title ?? t('Azure task')} />
                  ) : (
                    <span className={styles.noTicket}>{t('No Azure ticket')}</span>
                  )}
                  {long ? <Badge tone="warning">{t('Long')}</Badge> : null}
                  {overlap ? <Badge tone="danger">{t('Overlap')}</Badge> : null}
                </span>
              );
            }
            case 'time':
              return (
                <span className={styles.timeRange}>
                  <TimeCell date={logStart(log)} />
                  {' – '}
                  <TimeCell date={logEnd(log)} />
                </span>
              );
            case 'duration':
              return <span className={styles.duration}>{formatShortDuration(log.length)}</span>;
            case 'activity':
              return (
                <ActivityChip
                  name={log.activityType?.name ?? t('Default activity')}
                  colorIndex={activityColorIndex(colors, log.activityType?.id)}
                />
              );
            case 'comment': {
              const overlap = overlaps?.get(log.id) ?? 0;
              return (
                <>
                  {log.comment?.trim() || '—'}
                  {overlap > 0 ? <span className={styles.overlapNote}>{` · ${t('overlaps {duration}', { duration: formatOverlap(overlap) })}`}</span> : null}
                </>
              );
            }
            case 'action':
              if (log.id === runningLogId) {
                return (
                  <Badge tone="running" icon={RunningIcon}>
                    {t('Running')}
                  </Badge>
                );
              }
              if (log.isCanEdit === false) {
                return (
                  <Badge tone="neutral" accessibleLabel={t('Locked by 7pace')}>
                    {t('Locked')}
                  </Badge>
                );
              }
              return (
                <Button
                  size="small"
                  isDisabled={disabled}
                  onPress={() => onEdit(log)}
                  aria-label={t('Edit time for {title}', { title: timeEditorTitle(log, items) })}
                >
                  {t('Edit')}
                </Button>
              );
          }
        }}
      />
      {logs.length > 0 ? (
        <p className={styles.tableSummary}>
          <span className={styles.summaryCount}>{tn(logs.length, '{count} entry', '{count} entries')}</span>
          <span className={styles.summaryTotal}>{formatShortDuration(total)}</span>
          {overlapCount > 0 ? (
            <span className={styles.summaryNote}>{tn(overlapCount, '{count} overlap', '{count} overlaps')}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
