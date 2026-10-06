import { Button } from '../../components/Button';
import type { MeetingPromptView } from '../../ipc/contract';
import { useIntents, useWriteGuards } from '../tracking/actions';
import { MeetingIcon } from '../tracking/icons';
import { PromptCard, promptStyles as styles, useTimeOfDay } from './PromptCard';

/**
 * "Meeting started" (1.14 `MeetingPrompt`): choose the activity for the meeting's ticket (its
 * `#id`, work-item link or the default meeting ticket), another ticket, or none.
 */
export function MeetingPrompt({ view }: { view: MeetingPromptView }) {
  const { busy, connected, running } = useWriteGuards();
  const actions = useIntents();
  const time = useTimeOfDay();
  const { event, ticketId } = view;
  return (
    <PromptCard
      kind="meeting"
      icon={MeetingIcon}
      title="Meeting started"
      runner={actions}
      actions={
        <>
          <Button
            isPending={actions.isPending('dismiss')}
            onPress={() => void actions.run('dismiss', { type: 'meeting.dismiss', id: event.id })}
          >
            {running ? 'Keep current' : 'Dismiss'}
          </Button>
          <span className={styles.spacer} />
          {ticketId !== null ? (
            <Button
              isDisabled={busy || !connected}
              isPending={actions.isPending('other')}
              onPress={() => void actions.run('other', { type: 'meeting.begin', id: event.id, useSuggestedTicket: false })}
            >
              Other ticket…
            </Button>
          ) : null}
          <Button
            variant="primary"
            data-prompt-primary=""
            isDisabled={busy || !connected}
            isPending={actions.isPending('begin')}
            onPress={() => void actions.run('begin', { type: 'meeting.begin', id: event.id, useSuggestedTicket: true })}
          >
            Choose activity…
          </Button>
        </>
      }
    >
      <p className={styles.strong}>{event.title}</p>
      <p className={styles.caption}>
        <span className={styles.time}>{`${time(event.start)} – ${time(event.end)}`}</span>
        {event.calendar ? ` · ${event.calendar}` : ''}
      </p>
      <p className={styles.caption}>
        {ticketId !== null
          ? event.ticketId === null
            ? `Default meeting ticket #${ticketId}`
            : `Linked ticket #${ticketId}`
          : 'No ticket needed. The meeting title becomes the comment.'}
      </p>
    </PromptCard>
  );
}
