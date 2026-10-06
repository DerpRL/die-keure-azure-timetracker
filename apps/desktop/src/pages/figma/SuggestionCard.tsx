import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { FigmaIcon } from '../../components/icons';
import { TicketLink } from '../../features/ticketContext/TicketLink';
import type { FigmaPromptView } from '../../ipc/contract';
import { useAction, useSlice } from '../../state/hooks';
import styles from './figma.module.css';

/**
 * "Figma file active" (1.14 `FigmaPrompt`). Start Design… only opens the activity chooser
 * (`figma.track`); the timer starts when the user confirms there.
 */
export function SuggestionCard({ prompt }: { prompt: FigmaPromptView }) {
  const app = useSlice('app');
  const connection = useSlice('connection');
  const action = useAction();
  const { suggestion } = prompt;
  const busy = app?.busy ?? false;
  const offline = !(connection?.connected ?? false);
  const ticketId = suggestion.ticketId ?? null;
  return (
    <Card as="article" aria-label={`Figma file active: ${suggestion.name}`}>
      <div className={styles.suggestion}>
        <h3 className={styles.suggestionTitle}>
          <FigmaIcon />
          Figma file active
        </h3>
        <p className={styles.fileName}>{suggestion.name}</p>
        {ticketId !== null ? (
          <p className={styles.ticket}>
            <TicketLink ticketId={ticketId} title={prompt.ticketTitle ?? 'Azure ticket'} />
          </p>
        ) : (
          <p className={styles.text}>Track Design without a ticket. The file name becomes the comment.</p>
        )}
        <p className={styles.text}>An active file suggests context; it does not prove the design was edited.</p>
        <div className={styles.buttons}>
          <Button
            variant="primary"
            isDisabled={busy || offline || action.pending}
            onPress={() => void action.run({ type: 'figma.track', suggestionId: suggestion.id, useLinkedTicket: true })}
          >
            Start Design…
          </Button>
          {ticketId !== null ? (
            <Button
              isDisabled={busy || offline || action.pending}
              onPress={() => void action.run({ type: 'figma.track', suggestionId: suggestion.id, useLinkedTicket: false })}
            >
              Other ticket
            </Button>
          ) : null}
          <Button
            isDisabled={busy || action.pending}
            onPress={() => void action.run({ type: 'figma.keep', suggestionId: suggestion.id })}
          >
            Keep tracking
          </Button>
        </div>
        {action.error ? (
          <p role="alert" className={styles.error}>
            {action.error.message}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
