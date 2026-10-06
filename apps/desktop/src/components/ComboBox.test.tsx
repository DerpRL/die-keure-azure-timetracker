import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../test/axe';
import { renderWithProviders } from '../test/render';
import { AsyncComboBox } from './Pickers';

interface Ticket {
  id: number;
  title: string;
}

const TICKETS: Ticket[] = [
  { id: 33624, title: 'Improve loading' },
  { id: 33984, title: 'Daily standup board' },
  { id: 34001, title: 'Fix CSV export' },
];

function search(query: string): Promise<Ticket[]> {
  const q = query.toLowerCase();
  return Promise.resolve(TICKETS.filter((ticket) => `${ticket.id} ${ticket.title}`.toLowerCase().includes(q)));
}

describe('AsyncComboBox (ticket search)', () => {
  it('searches as you type, then selects with the keyboard', async () => {
    const load = vi.fn((query: string) => search(query));
    const onSelectionChange = vi.fn();
    const { user } = renderWithProviders(
      <AsyncComboBox<Ticket>
        label="Ticket"
        load={load}
        debounceMs={0}
        getLabel={(ticket) => `#${ticket.id} · ${ticket.title}`}
        onSelectionChange={onSelectionChange}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Ticket' });
    await user.type(input, 'export');
    const listbox = await screen.findByRole('listbox');
    await waitFor(() => expect(within(listbox).getAllByRole('option')).toHaveLength(1));
    expect(load).toHaveBeenLastCalledWith('export', expect.any(AbortSignal));
    await expectNoA11yViolations();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelectionChange).toHaveBeenLastCalledWith(TICKETS[2]);
    expect(input).toHaveValue('#34001 · Fix CSV export');
  });

  it('aborts superseded searches and shows the empty message', async () => {
    const signals: AbortSignal[] = [];
    const { user } = renderWithProviders(
      <AsyncComboBox<Ticket>
        label="Ticket"
        debounceMs={0}
        load={async (query, signal) => {
          signals.push(signal);
          // A slow server: later keystrokes arrive while earlier searches are still running.
          await new Promise((resolve) => setTimeout(resolve, 30));
          return search(query);
        }}
        getLabel={(ticket) => ticket.title}
        emptyMessage="No matching tickets"
      />,
    );
    await user.type(screen.getByRole('combobox', { name: 'Ticket' }), 'zzz');
    expect(await screen.findByText('No matching tickets')).toBeInTheDocument();
    // Every keystroke started a new search; all but the latest were aborted.
    expect(signals.length).toBeGreaterThan(1);
    expect(signals.slice(0, -1).every((signal) => signal.aborted)).toBe(true);
    expect(signals.at(-1)?.aborted).toBe(false);
  });

  it('reports a failed search without throwing', async () => {
    const { user } = renderWithProviders(
      <AsyncComboBox<Ticket>
        label="Ticket"
        debounceMs={0}
        load={() => Promise.reject(new Error('offline'))}
        getLabel={(ticket) => ticket.title}
        errorText="Search failed. Try again."
      />,
    );
    await user.type(screen.getByRole('combobox', { name: 'Ticket' }), 'a');
    expect(await screen.findByText('Search failed. Try again.')).toBeInTheDocument();
  });
});
