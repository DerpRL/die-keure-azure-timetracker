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

type Column = 'task' | 'time' | 'duration' | 'activity' | 'comment' | 'action';

const COLUMNS: TableColumn<Column>[] = [
  { id: 'task', title: 'Work item', isRowHeader: true, minWidth: '14rem' },
  { id: 'time', title: 'Time' },
  { id: 'duration', title: 'Duration', align: 'end' },
  { id: 'activity', title: 'Activity' },
  { id: 'comment', title: 'Comment', minWidth: '10rem' },
  { id: 'action', title: 'Action' },
];

/** "10m", or "1h 5m" from an hour. */
function formatOverlap(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes < 60 ? `${minutes}m` : formatShortDuration(minutes * 60);
}

function TimeCell({ date }: { date: Date | null }) {
  if (!date) return <span>Unknown</span>;
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
        columns={COLUMNS}
        rows={logs}
        getRowId={(log) => log.id}
        getRowText={(log) => `${timeEditorTitle(log, items)} at ${formatClockTime(logStart(log))}`}
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
                    <TicketLink ticketId={ticket} title={items?.[String(ticket)]?.title ?? 'Azure task'} />
                  ) : (
                    <span className={styles.noTicket}>No Azure ticket</span>
                  )}
                  {long ? <Badge tone="warning">Long</Badge> : null}
                  {overlap ? <Badge tone="danger">Overlap</Badge> : null}
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
                  name={log.activityType?.name ?? 'Default activity'}
                  colorIndex={activityColorIndex(colors, log.activityType?.id)}
                />
              );
            case 'comment': {
              const overlap = overlaps?.get(log.id) ?? 0;
              return (
                <>
                  {log.comment?.trim() || '—'}
                  {overlap > 0 ? <span className={styles.overlapNote}>{` · overlaps ${formatOverlap(overlap)}`}</span> : null}
                </>
              );
            }
            case 'action':
              if (log.id === runningLogId) {
                return (
                  <Badge tone="running" icon={RunningIcon}>
                    Running
                  </Badge>
                );
              }
              if (log.isCanEdit === false) {
                return (
                  <Badge tone="neutral" accessibleLabel="Locked by 7pace">
                    Locked
                  </Badge>
                );
              }
              return (
                <Button
                  size="small"
                  isDisabled={disabled}
                  onPress={() => onEdit(log)}
                  aria-label={`Edit time for ${timeEditorTitle(log, items)}`}
                >
                  Edit
                </Button>
              );
          }
        }}
      />
      {logs.length > 0 ? (
        <p className={styles.tableSummary}>
          <span className={styles.summaryCount}>{logs.length === 1 ? '1 entry' : `${logs.length} entries`}</span>
          <span className={styles.summaryTotal}>{formatShortDuration(total)}</span>
          {overlapCount > 0 ? (
            <span className={styles.summaryNote}>{overlapCount === 1 ? '1 overlap' : `${overlapCount} overlaps`}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
