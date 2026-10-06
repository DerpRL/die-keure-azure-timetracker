import { Button } from '../../components/Button';
import { useAction, useWorkItem } from '../../state/hooks';

export interface TicketLinkProps {
  ticketId: number;
  /** Shown after the number; defaults to the cached title from the `workItems` slice. */
  title?: string | null;
  /** Number only (compact tables). */
  compact?: boolean;
}

/**
 * "#4821 Title" as a button that opens the ticket's details (`ticket.showContext`) over the
 * main window. Reused by every page that lists tickets.
 */
export function TicketLink({ ticketId, title, compact = false }: TicketLinkProps) {
  const item = useWorkItem(ticketId);
  const show = useAction();
  const name = title ?? item?.title ?? null;
  const text = compact || !name ? `#${ticketId}` : `#${ticketId} ${name}`;
  return (
    <Button
      variant="plain"
      size="small"
      onPress={() => void show.run({ type: 'ticket.showContext', ticketId })}
      // The visible text comes first in the accessible name (WCAG 2.5.3).
      aria-label={compact && name ? `${text} ${name}, show details` : `${text}, show details`}
    >
      {text}
    </Button>
  );
}
