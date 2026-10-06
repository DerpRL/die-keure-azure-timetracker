import { Button } from '../../components/Button';
import type { MeetingReturnView } from '../../ipc/contract';
import { useWorkItem } from '../../state/hooks';
import { useIntents, useWriteGuards } from '../tracking/actions';
import { ReturnIcon } from '../tracking/icons';
import { PromptCard, promptStyles as styles } from './PromptCard';

/** "Meeting ended" (1.14 `MeetingReturnPrompt`): return to the ticket from before the meeting. */
export function MeetingReturnPrompt({ view }: { view: MeetingReturnView }) {
  const { busy, connected } = useWriteGuards();
  const actions = useIntents();
  const item = useWorkItem(view.ticketId);
  const title = view.title ?? item?.title ?? null;
  return (
    <PromptCard
      kind="meetingReturn"
      icon={ReturnIcon}
      title="Meeting ended"
      runner={actions}
      actions={
        <>
          <Button
            isDisabled={busy}
            isPending={actions.isPending('dismiss')}
            onPress={() => void actions.run('dismiss', { type: 'meeting.returnDismiss' })}
          >
            Keep current
          </Button>
          <span className={styles.spacer} />
          <Button
            variant="primary"
            data-prompt-primary=""
            isDisabled={busy || !connected}
            isPending={actions.isPending('resume')}
            onPress={() => void actions.run('resume', { type: 'meeting.returnResume' })}
          >
            Resume previous…
          </Button>
        </>
      }
    >
      <p className={styles.strong}>{`Return to #${view.ticketId}?`}</p>
      {title ? <p className={styles.text}>{title}</p> : null}
      {view.activityName ? <p className={styles.caption}>{view.activityName}</p> : null}
      <p className={styles.caption}>Confirm the activity to resume your previous work.</p>
    </PromptCard>
  );
}
