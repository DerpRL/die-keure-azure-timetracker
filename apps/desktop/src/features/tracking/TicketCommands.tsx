import { useMemo } from 'react';
import type { Intent } from '../../ipc/contract';
import { useCommands } from '../../shortcuts/hooks';
import type { Command } from '../../shortcuts/store';
import { useSlice } from '../../state/hooks';
import { activityColor, useActivityColors } from '../activity';
import { useIntents, useWriteGuards } from './actions';

/**
 * Tickets in the command palette (2.2 layout "S5"): the running ticket and the quick tickets
 * (favourites first), found by number or title while typing. Return shows the ticket's details;
 * ⌘Return / Ctrl+Return opens the picker with it chosen, ready to pick an activity and start.
 */
export function TicketCommands() {
  const tracking = useSlice('tracking');
  const flow = useSlice('flow');
  const workItems = useSlice('workItems');
  const colors = useActivityColors();
  const { busy } = useWriteGuards();
  const actions = useIntents();

  const commands = useMemo((): Command[] => {
    const tickets = new Map<number, { title: string; note: string; activityId: string | null }>();
    const runningId = tracking?.running ? tracking.ticketId : null;
    if (runningId !== null && tracking) {
      tickets.set(runningId, { title: tracking.title, note: 'tracking now', activityId: tracking.activityId });
    }
    const quick = [...(flow?.quickTickets ?? [])].sort((a, b) => Number(b.favorite) - Number(a.favorite));
    for (const ticket of quick) {
      if (tickets.has(ticket.ticketId)) continue;
      const title = ticket.title ?? workItems?.[String(ticket.ticketId)]?.title ?? '';
      tickets.set(ticket.ticketId, { title, note: ticket.favorite ? 'favourite' : 'recent', activityId: null });
    }
    return [...tickets.entries()].map(([ticketId, ticket]): Command => {
      const type = workItems?.[String(ticketId)]?.type;
      const track: Intent[] = [{ type: 'tracking.openPicker' }, { type: 'tracking.chooseTicket', ticketId }];
      return {
        id: `ticket.${ticketId}`,
        label: ticket.title ? `#${ticketId} ${ticket.title}` : `#${ticketId}`,
        group: 'Tickets',
        keywords: [String(ticketId), `#${ticketId}`],
        description: [type, ticket.note].filter(Boolean).join(' · '),
        swatch: activityColor(colors, ticket.activityId),
        searchOnly: true,
        actionHint: 'details',
        onAction: () => void actions.run(`details-${ticketId}`, { type: 'ticket.showContext', ticketId }),
        alternate: busy || ticketId === runningId ? undefined : { hint: 'track', onAction: () => void actions.run(`track-${ticketId}`, ...track) },
      };
    });
    // `actions.run` is stable enough: useCommands always calls the latest handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, flow?.quickTickets, workItems, colors, busy]);
  useCommands(commands);
  return <>{actions.confirmation}</>;
}
