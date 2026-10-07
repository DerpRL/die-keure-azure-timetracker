import { act, screen, waitFor, within } from '@testing-library/react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockEngineError } from '../../ipc/mockEngine';
import { contextFailed, contextLoaded, contextLoading, contextSparse } from '../../ipc/fixtures/slices/ticketContext';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine } from '../../test/engine';
import { TicketContextSheet } from './TicketContextSheet';
import { TicketLink } from './TicketLink';

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  vi.mocked(openUrl).mockClear();
});

describe('TicketContextSheet', () => {
  it('renders nothing while no ticket is requested', () => {
    renderWithEngine(<TicketContextSheet />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from a ticket link and closes with Done, returning focus', async () => {
    const { engine, user } = renderWithEngine(
      <>
        <TicketLink ticketId={4821} />
        <TicketContextSheet />
      </>,
    );
    engine.handle('ticket.showContext', (intent, mock) => mock.setSlice('ticketContext', { ...contextLoaded, ticketId: intent.ticketId }));
    engine.handle('ticket.closeContext', (_intent, mock) => mock.patchSlice('ticketContext', { ticketId: null, details: null }));

    const link = screen.getByRole('button', { name: '#4821 Checkout: retry failed card payments, show details' });
    await user.click(link);
    expect(engine.dispatched('ticket.showContext')).toEqual([{ type: 'ticket.showContext', ticketId: 4821 }]);

    const dialog = await screen.findByRole('dialog', { name: 'Ticket context' });
    expect(dialog).toHaveAccessibleDescription('#4821');
    expect(within(dialog).getByRole('heading', { level: 3, name: 'Checkout: retry failed card payments' })).toBeInTheDocument();
    expect(within(dialog).getByText('Sam Peeters')).toBeInTheDocument();
    expect(within(dialog).getByText(/retry it once before showing the error/)).toBeInTheDocument();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await expectNoA11yViolations();

    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(engine.dispatched('ticket.closeContext')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(link).toHaveFocus());
  });

  it('opens the ticket in Azure DevOps through the engine', async () => {
    const { engine, user } = renderWithEngine(<TicketContextSheet />, { with: { ticketContext: contextLoaded } });
    await user.click(screen.getByRole('button', { name: 'Open in Azure DevOps' }));
    expect(engine.dispatched('ticket.openInAzure')).toEqual([{ type: 'ticket.openInAzure', ticketId: 4821 }]);
  });

  it('shows an engine failure to open Azure verbatim', async () => {
    const { engine, user } = renderWithEngine(<TicketContextSheet />, { with: { ticketContext: contextLoaded } });
    engine.handle('ticket.openInAzure', () => {
      throw new MockEngineError('invalidIntent', 'Add your Azure organization in Settings first.');
    });
    await user.click(screen.getByRole('button', { name: 'Open in Azure DevOps' }));
    expect(await screen.findByText('Add your Azure organization in Settings first.')).toBeInTheDocument();
  });

  it('opens https related links with the opener plugin and refuses other schemes', async () => {
    const { user } = renderWithEngine(<TicketContextSheet />, { with: { ticketContext: contextLoaded } });
    await user.click(screen.getByRole('button', { name: 'Payment provider: retry guidance, opens in your browser' }));
    expect(openUrl).toHaveBeenCalledWith('https://docs.example.com/payments/retries');
    expect(screen.queryByRole('button', { name: /Internal wiki/ })).toBeNull();
    expect(screen.getByText(/only https links open from the app/)).toBeInTheDocument();
  });

  it('shows the loading state', async () => {
    renderWithEngine(<TicketContextSheet />, { with: { ticketContext: contextLoading } });
    const dialog = await screen.findByRole('dialog', { name: 'Ticket context' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('Loading ticket details…');
    await expectNoA11yViolations();
  });

  it('shows empty fields as "Not set" and empty text as "No details provided."', async () => {
    renderWithEngine(<TicketContextSheet />, { with: { ticketContext: contextSparse } });
    const dialog = await screen.findByRole('dialog', { name: 'Ticket context' });
    expect(within(dialog).getAllByText('Not set')).toHaveLength(3);
    expect(within(dialog).getAllByText('No details provided.')).toHaveLength(2);
    expect(within(dialog).queryByRole('heading', { name: 'Related links' })).toBeNull();
  });

  it('shows the issue and retries', async () => {
    const { engine, user } = renderWithEngine(<TicketContextSheet />, { with: { ticketContext: contextFailed } });
    const dialog = await screen.findByRole('dialog', { name: 'Ticket context' });
    expect(within(dialog).getByText('Add your Azure organization and PAT in Settings to load ticket details.')).toBeInTheDocument();
    await expectNoA11yViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(engine.dispatched('ticket.showContext')).toEqual([{ type: 'ticket.showContext', ticketId: 4821 }]);
  });

  it('ignores details that belong to another ticket', async () => {
    const { engine } = renderWithEngine(<TicketContextSheet />, { with: { ticketContext: contextLoaded } });
    act(() => engine.patchSlice('ticketContext', { ticketId: 4790, loading: true }));
    const dialog = await screen.findByRole('dialog', { name: 'Ticket context' });
    expect(within(dialog).queryByText('Checkout: retry failed card payments')).toBeNull();
    expect(dialog).toHaveAccessibleDescription('#4790');
  });
});
