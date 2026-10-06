import { Button } from '../../components/Button';
import type { AttentionView } from '../../ipc/contract';
import { useWorkItem } from '../../state/hooks';
import { useIntents, useWriteGuards } from '../tracking/actions';
import { CorrectionIcon } from '../tracking/icons';
import { PromptCard, promptStyles as styles } from './PromptCard';

/**
 * 7pace's activity check, time limit or activity timeout (1.14 `TrackingAttentionPrompt`). It
 * leads the list because 7pace stops the timer when the check goes unanswered. Continue is the
 * primary action.
 */
export function TrackingAttentionPrompt({ attention }: { attention: AttentionView }) {
  const { busy, connected } = useWriteGuards();
  const actions = useIntents();
  const item = useWorkItem(attention.ticketId);
  const disabled = busy || !connected;
  const title = attention.ticketId !== null ? (item?.title ?? attention.title) : attention.title;
  return (
    <PromptCard
      kind="trackingAttention"
      icon={CorrectionIcon}
      tone="warning"
      title={attention.heading}
      runner={actions}
      actions={
        <>
          <Button
            isDisabled={disabled}
            isPending={actions.isPending('first')}
            onPress={() =>
              void actions.run('first', attention.stopped ? { type: 'attention.keepStopped' } : { type: 'tracking.stop' })
            }
          >
            {attention.stopped ? 'Keep stopped' : 'Stop tracking'}
          </Button>
          <span className={styles.spacer} />
          <Button
            variant="primary"
            data-prompt-primary=""
            isDisabled={disabled}
            isPending={actions.isPending('continue')}
            onPress={() => void actions.run('continue', { type: 'attention.continue' })}
          >
            {attention.stopped ? 'Continue…' : 'Continue tracking'}
          </Button>
        </>
      }
    >
      <p className={styles.strong}>{(attention.ticketId !== null ? `#${attention.ticketId} · ` : '') + title}</p>
      <p className={styles.caption}>{attention.detail}</p>
    </PromptCard>
  );
}
