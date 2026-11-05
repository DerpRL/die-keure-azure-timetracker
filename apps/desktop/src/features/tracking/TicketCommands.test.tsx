import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine } from '../../test/engine';
import { TicketCommands } from './TicketCommands';
import { TrackingCommands } from './TrackingCommands';

function Palette() {
  return (
    <>
      <TrackingCommands surface="main" />
      <TicketCommands />
    </>
  );
}

async function openPalette(user: ReturnType<typeof renderWithEngine>['user']) {
  await user.keyboard('{Meta>}k{/Meta}');
  return screen.findByRole('dialog', { name: 'Command palette' });
}

describe('tickets in the command palette', () => {
  it('stay out of the empty palette, which lists actions with icons', async () => {
    const { user } = renderWithEngine(<Palette />);
    const dialog = await openPalette(user);
    expect(within(dialog).queryByText('Tickets')).toBeNull();
    expect(within(dialog).getByText('Tracking')).toBeInTheDocument();
    expect(within(dialog).getByRole('menuitem', { name: /Track a ticket…/ })).toBeInTheDocument();
    expect(within(dialog).getByText('Move')).toBeInTheDocument();
    await expectNoA11yViolations(dialog);
  });

  it('are found by number: Return shows the details', async () => {
    const { engine, user } = renderWithEngine(<Palette />);
    const dialog = await openPalette(user);
    await user.keyboard('4821');
    const row = within(dialog).getByRole('menuitem', { name: /#4821 Checkout: retry failed card payments/ });
    expect(row).toHaveTextContent('tracking now');
    // The running ticket can only be opened, not tracked again.
    expect(row).not.toHaveTextContent('track ');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(engine.dispatched('ticket.showContext')).toEqual([{ type: 'ticket.showContext', ticketId: 4821 }]));
  });

  it('track with ⌘Return: the picker opens with the ticket chosen', async () => {
    const { engine, user } = renderWithEngine(<Palette />);
    const dialog = await openPalette(user);
    await user.keyboard('VAT');
    const row = within(dialog).getByRole('menuitem', { name: /#4790 Invoice PDF shows the wrong VAT number/ });
    expect(row).toHaveTextContent('⌘↵ track');
    expect(within(dialog).getByText('Track')).toBeInTheDocument();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(engine.dispatched('tracking.openPicker')).toHaveLength(1));
    await waitFor(() => expect(engine.dispatched('tracking.chooseTicket')).toHaveLength(1));
    expect(engine.dispatched('tracking.chooseTicket')).toEqual([{ type: 'tracking.chooseTicket', ticketId: 4790 }]);
    expect(engine.dispatched('ticket.showContext')).toHaveLength(0);
  });
});
