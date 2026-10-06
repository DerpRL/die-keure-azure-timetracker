import { Button } from '../../components/Button';
import { FigmaIcon } from '../../components/icons';
import type { FigmaPromptView } from '../../ipc/contract';
import { useWorkItem } from '../../state/hooks';
import { useIntents, useWriteGuards } from '../tracking/actions';
import { PromptCard, promptStyles as styles, usePromptContext } from './PromptCard';

/**
 * "Figma file active" (1.14 `FigmaPrompt`): start Design for the file's linked ticket, another
 * ticket, or keep the current timer.
 */
export function FigmaPrompt({ view }: { view: FigmaPromptView }) {
  const { compact } = usePromptContext();
  const { busy, connected } = useWriteGuards();
  const actions = useIntents();
  const { suggestion } = view;
  const ticketId = suggestion.ticketId ?? null;
  const item = useWorkItem(ticketId);
  return (
    <PromptCard
      kind="figma"
      icon={FigmaIcon}
      title="Figma file active"
      runner={actions}
      actions={
        <>
          <Button
            variant="primary"
            data-prompt-primary=""
            isDisabled={busy || !connected}
            isPending={actions.isPending('track')}
            onPress={() =>
              void actions.run('track', { type: 'figma.track', suggestionId: suggestion.id, useLinkedTicket: true })
            }
          >
            Start Design…
          </Button>
          {ticketId !== null ? (
            <Button
              isDisabled={busy || !connected}
              isPending={actions.isPending('other')}
              onPress={() =>
                void actions.run('other', { type: 'figma.track', suggestionId: suggestion.id, useLinkedTicket: false })
              }
            >
              Other ticket
            </Button>
          ) : null}
          <Button
            isDisabled={busy}
            isPending={actions.isPending('keep')}
            onPress={() => void actions.run('keep', { type: 'figma.keep', suggestionId: suggestion.id })}
          >
            Keep tracking
          </Button>
        </>
      }
    >
      <p className={styles.strong}>{suggestion.name}</p>
      {ticketId !== null ? (
        <p className={styles.text}>{`#${ticketId} · ${view.ticketTitle ?? item?.title ?? 'Azure ticket'}`}</p>
      ) : (
        <p className={styles.caption}>Track Design without a ticket. The file name becomes the comment.</p>
      )}
      {!compact ? (
        <p className={styles.caption}>An active file suggests context; it does not prove the design was edited.</p>
      ) : null}
    </PromptCard>
  );
}
