import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { RunningIcon } from '../../components/icons';
import { Table, type Selection, type TableColumn } from '../../components/Table';
import type { WorkItemsSlice, WorkLog } from '../../ipc/contract';
import { formatClockTime, formatDateTime, logEnd, logStart, logTicket, timeEditorTitle } from '../../features/ticketContext/format';
import { TicketLink } from '../../features/ticketContext/TicketLink';
import { formatShortDuration } from '../../utils/duration';
import styles from './TimeEditor.module.css';

type Column = 'task' | 'start' | 'end' | 'duration' | 'activity' | 'comment' | 'action';

const COLUMNS: TableColumn<Column>[] = [
  { id: 'task', title: 'Task', isRowHeader: true, minWidth: '12rem' },
  { id: 'start', title: 'Start' },
  { id: 'end', title: 'End' },
  { id: 'duration', title: 'Duration', align: 'end' },
  { id: 'activity', title: 'Activity' },
  { id: 'comment', title: 'Comment', minWidth: '10rem' },
  { id: 'action', title: 'Action' },
];

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
  disabled: boolean;
  labelledBy: string;
  emptyMessage: string;
  onSelectionChange: (ids: string[]) => void;
  onEdit: (log: WorkLog) => void;
}

/** The day's entries with checkboxes for merging (1.14 `timeTable`). */
export function EntriesTable({
  logs,
  items,
  selection,
  runningLogId,
  disabled,
  labelledBy,
  emptyMessage,
  onSelectionChange,
  onEdit,
}: EntriesTableProps) {
  return (
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
      renderEmptyState={() => emptyMessage}
      renderCell={(log, column) => {
        switch (column) {
          case 'task': {
            const ticket = logTicket(log);
            return ticket !== null ? (
              <TicketLink ticketId={ticket} title={items?.[String(ticket)]?.title ?? 'Azure task'} />
            ) : (
              <span>No Azure ticket</span>
            );
          }
          case 'start':
            return <TimeCell date={logStart(log)} />;
          case 'end':
            return <TimeCell date={logEnd(log)} />;
          case 'duration':
            return <span className={styles.mono}>{formatShortDuration(log.length)}</span>;
          case 'activity':
            return log.activityType?.name ?? 'Default activity';
          case 'comment':
            return log.comment?.trim() || '—';
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
              <Button size="small" isDisabled={disabled} onPress={() => onEdit(log)} aria-label={`Edit time for ${timeEditorTitle(log, items)}`}>
                Edit
              </Button>
            );
        }
      }}
    />
  );
}
