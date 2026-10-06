import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../test/axe';
import { renderWithProviders } from '../test/render';
import { Table, type Selection, type SortDescriptor, type TableColumn } from './Table';

// React Aria reads the platform once to choose ⌘ (macOS) or Ctrl (Windows) for multi-select;
// this file runs as macOS. jsdom reports an empty platform otherwise.
Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });

interface Entry {
  id: string;
  task: string;
  start: string;
  minutes: number;
}

const ENTRIES: Entry[] = [
  { id: 'a', task: '#33624 · Improve loading', start: '09:00', minutes: 90 },
  { id: 'b', task: '#33984 · Daily standup', start: '10:30', minutes: 15 },
  { id: 'c', task: 'Meeting', start: '11:00', minutes: 60 },
  { id: 'd', task: '#34001 · Fix export', start: '13:00', minutes: 120 },
];

const COLUMNS: TableColumn<'task' | 'start' | 'duration'>[] = [
  { id: 'task', title: 'Task', isRowHeader: true, allowsSorting: true },
  { id: 'start', title: 'Start', allowsSorting: true },
  { id: 'duration', title: 'Duration', align: 'end', allowsSorting: true },
];

function Editor({ onSelection, onRowAction }: { onSelection?: (keys: Selection) => void; onRowAction?: (key: unknown) => void }) {
  const [selected, setSelected] = useState<Selection>(new Set());
  const [sort, setSort] = useState<SortDescriptor>({ column: 'start', direction: 'ascending' });
  const rows = [...ENTRIES].sort((a, b) => {
    const value = (entry: Entry) => (sort.column === 'duration' ? entry.minutes : sort.column === 'task' ? entry.task : entry.start);
    const order = value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0;
    return sort.direction === 'ascending' ? order : -order;
  });
  return (
    <Table
      aria-label="Entries on Tuesday 6 October"
      columns={COLUMNS}
      rows={rows}
      getRowId={(row) => row.id}
      getRowText={(row) => row.task}
      renderCell={(row, column) => (column === 'task' ? row.task : column === 'start' ? row.start : `${row.minutes}m`)}
      selectionMode="multiple"
      selectedKeys={selected}
      onSelectionChange={(keys) => {
        setSelected(keys);
        onSelection?.(keys);
      }}
      sortDescriptor={sort}
      onSortChange={setSort}
      onRowAction={onRowAction}
    />
  );
}

const selectedIds = (keys: Selection | undefined) => (keys === 'all' ? 'all' : [...(keys ?? [])].sort());

describe('Table', () => {
  it('renders a labelled grid with a checkbox column and passes axe', async () => {
    renderWithProviders(<Editor />);
    const grid = screen.getByRole('grid', { name: 'Entries on Tuesday 6 October' });
    expect(within(grid).getAllByRole('row')).toHaveLength(5);
    expect(within(grid).getByRole('checkbox', { name: 'Select All' })).toBeInTheDocument();
    expect(within(grid).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual([
      '#33624 · Improve loading',
      '#33984 · Daily standup',
      'Meeting',
      '#34001 · Fix export',
    ]);
    await expectNoA11yViolations();
  });

  it('supports checkbox selection plus ⌘-click multi-select', async () => {
    const onSelection = vi.fn();
    const { user } = renderWithProviders(<Editor onSelection={onSelection} />);
    const rows = screen.getAllByRole('row').slice(1);
    await user.click(within(rows[0]!).getByRole('checkbox'));
    await user.click(within(rows[2]!).getByRole('checkbox'));
    expect(selectedIds(onSelection.mock.lastCall?.[0] as Selection)).toEqual(['a', 'c']);

    // A plain click replaces the selection; ⌘-click adds to it (Ctrl-click on Windows).
    await user.click(within(rows[1]!).getByRole('rowheader'));
    expect(selectedIds(onSelection.mock.lastCall?.[0] as Selection)).toEqual(['b']);
    await user.keyboard('{Meta>}');
    await user.click(within(rows[3]!).getByRole('rowheader'));
    await user.keyboard('{/Meta}');
    expect(selectedIds(onSelection.mock.lastCall?.[0] as Selection)).toEqual(['b', 'd']);
    expect(rows[3]).toHaveAttribute('aria-selected', 'true');
  });

  it('moves with the arrow keys, extends with Shift and selects all with ⌘A', async () => {
    const onSelection = vi.fn();
    const onRowAction = vi.fn();
    const { user } = renderWithProviders(<Editor onSelection={onSelection} onRowAction={onRowAction} />);
    // Tab enters on the first row; with native-table ("replace") behaviour, arrows move the
    // selection and Shift extends it.
    await user.tab();
    expect(document.activeElement?.closest('[role="row"]')).toHaveTextContent('#33624 · Improve loading');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.closest('[role="row"]')).toHaveTextContent('#33984 · Daily standup');
    expect(selectedIds(onSelection.mock.lastCall?.[0] as Selection)).toEqual(['b']);
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(selectedIds(onSelection.mock.lastCall?.[0] as Selection)).toEqual(['b', 'c']);
    await user.keyboard('{Meta>}a{/Meta}');
    expect(selectedIds(onSelection.mock.lastCall?.[0] as Selection)).toEqual('all');
    await user.keyboard('{Enter}');
    expect(onRowAction).toHaveBeenCalled();
  });

  it('sorts from the column headers with a click or the keyboard', async () => {
    const { user } = renderWithProviders(<Editor />);
    const duration = screen.getByRole('columnheader', { name: 'Duration' });
    await user.click(duration);
    expect(duration).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getAllByRole('rowheader')[0]).toHaveTextContent('Daily standup');
    await user.keyboard('{Enter}');
    expect(duration).toHaveAttribute('aria-sort', 'descending');
    expect(screen.getAllByRole('rowheader')[0]).toHaveTextContent('Fix export');
  });
});
