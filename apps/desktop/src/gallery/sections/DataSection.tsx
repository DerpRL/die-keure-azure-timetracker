import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { TimeEditorIcon } from '../../components/icons';
import { Table, type Selection, type SortDescriptor, type TableColumn } from '../../components/Table';
import { formatTime } from '../../charts/format';
import { formatShortDuration } from '../../utils/duration';
import { GallerySection, Specimen } from '../GalleryLayout';
import { sampleWorklogs, type SampleWorklog } from '../sampleData';

type Column = 'task' | 'start' | 'end' | 'duration' | 'activity' | 'comment' | 'actions';

const COLUMNS: TableColumn<Column>[] = [
  { id: 'task', title: 'Task', isRowHeader: true, allowsSorting: true, minWidth: '14rem' },
  { id: 'start', title: 'Start', allowsSorting: true },
  { id: 'end', title: 'End' },
  { id: 'duration', title: 'Duration', align: 'end', allowsSorting: true },
  { id: 'activity', title: 'Activity', allowsSorting: true },
  { id: 'comment', title: 'Comment', minWidth: '10rem' },
  { id: 'actions', title: 'Actions', hideTitle: true },
];

const seconds = (log: SampleWorklog) => (log.end.getTime() - log.start.getTime()) / 1000;

export function DataSection() {
  const [selected, setSelected] = useState<Selection>(new Set());
  const [sort, setSort] = useState<SortDescriptor>({ column: 'start', direction: 'ascending' });
  const [edited, setEdited] = useState<string | null>(null);
  const rows = useMemo(() => {
    const logs = sampleWorklogs();
    const value = (log: SampleWorklog): string | number =>
      sort.column === 'duration' ? seconds(log) : sort.column === 'task' ? log.task : sort.column === 'activity' ? log.activity : log.start.getTime();
    return logs.sort((a, b) => {
      const order = value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0;
      return sort.direction === 'ascending' ? order : -order;
    });
  }, [sort]);
  const count = selected === 'all' ? rows.length : selected.size;

  return (
    <GallerySection
      id="table"
      title="Table"
      description="Checkbox column plus ⌘-click (Ctrl-click on Windows) and Shift-click; arrow keys move, Space toggles, ⌘A selects all, headers sort."
    >
      <Specimen title="Time editor entries" wide>
        <div className="gallery-stack">
          <div className="gallery-row">
            <Button variant="primary" isDisabled={count < 2}>
              Merge selected
            </Button>
            <span className="gallery-note">
              {count} selected{edited ? ` · Edit requested for ${edited}` : ''}
            </span>
          </div>
          <Table
            aria-label="Entries on Tuesday 6 October"
            columns={COLUMNS}
            rows={rows}
            getRowId={(row) => row.id}
            getRowText={(row) => row.task}
            selectionMode="multiple"
            selectedKeys={selected}
            onSelectionChange={setSelected}
            sortDescriptor={sort}
            onSortChange={setSort}
            onRowAction={(key) => setEdited(String(key))}
            renderCell={(row, column) => {
              switch (column) {
                case 'task':
                  return row.task;
                case 'start':
                  return formatTime(row.start);
                case 'end':
                  return formatTime(row.end);
                case 'duration':
                  return formatShortDuration(seconds(row));
                case 'activity':
                  return row.activity;
                case 'comment':
                  return row.comment || '—';
                case 'actions':
                  return (
                    <Button size="small" icon={TimeEditorIcon} onPress={() => setEdited(row.task)}>
                      Edit time
                    </Button>
                  );
              }
            }}
            renderEmptyState={() => 'No entries on this day.'}
          />
        </div>
      </Specimen>
    </GallerySection>
  );
}
