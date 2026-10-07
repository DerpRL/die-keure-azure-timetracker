import { Button } from '../../components/Button';
import { SuccessIcon } from '../../components/icons';
import type { TicketCompletionPrompt as CompletionView } from '../../ipc/contract';
import { useIntents, useWriteGuards } from '../tracking/actions';
import { flowSurface } from '../tracking/CurrentTracking';
import { PromptCard, promptStyles as styles, usePromptContext } from './PromptCard';

/**
 * "Tracked ticket completed" (1.14 `TicketCompletionView`): the running ticket is done in Azure.
 * Keep tracking, stop, or switch to another ticket.
 */
export function TicketCompletionPrompt({ prompt }: { prompt: CompletionView }) {
  const { surface } = usePromptContext();
  const { busy, preview } = useWriteGuards();
  const actions = useIntents();
  return (
    <PromptCard
      kind="ticketCompletion"
      icon={SuccessIcon}
      title="Tracked ticket completed"
      runner={actions}
      actions={
        <>
          <Button
            isDisabled={busy}
            isPending={actions.isPending('keep')}
            onPress={() => void actions.run('keep', { type: 'completion.keep' })}
          >
            Keep tracking
          </Button>
          <Button
            isDisabled={busy || preview}
            isPending={actions.isPending('stop')}
            onPress={() => void actions.run('stop', { type: 'completion.stop' })}
          >
            Stop
          </Button>
          <Button
            variant="primary"
            data-prompt-primary=""
            isDisabled={busy || preview}
            isPending={actions.isPending('switch')}
            // The panel's ticket search there, the main window's picker sheet otherwise.
            onPress={() => void actions.run('switch', { type: 'completion.switch', surface: flowSurface(surface) })}
          >
            Switch ticket…
          </Button>
        </>
      }
    >
      <p className={styles.strong}>{`#${prompt.ticketId} · ${prompt.title}`}</p>
      <p className={styles.caption}>{`Azure status: ${prompt.workflowState}. Your timer is still running.`}</p>
    </PromptCard>
  );
}
