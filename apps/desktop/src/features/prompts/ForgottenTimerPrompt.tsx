import { Button } from '../../components/Button';
import type { ForgottenReminder, ForgottenTicketView } from '../../ipc/contract';
import { useIntents, useWriteGuards } from '../tracking/actions';
import { ForgottenIcon } from '../tracking/icons';
import { PromptCard, promptStyles as styles } from './PromptCard';

/**
 * "Working without a timer?" (1.14 `WorkAwarenessPrompts`, forgotten-timer part): pick a ticket
 * from a watched branch or any ticket, snooze, or ignore for today. Starting tracks from now.
 */
export function ForgottenTimerPrompt({ reminder, tickets }: { reminder: ForgottenReminder; tickets: ForgottenTicketView[] }) {
  const { busy, connected } = useWriteGuards();
  const actions = useIntents();
  const writeDisabled = busy || !connected;
  return (
    <PromptCard
      kind="forgottenTimer"
      icon={ForgottenIcon}
      tone="warning"
      title="Working without a timer?"
      runner={actions}
      actions={
        <>
          <Button
            variant="primary"
            data-prompt-primary=""
            isDisabled={writeDisabled}
            isPending={actions.isPending('choose')}
            onPress={() => void actions.run('choose', { type: 'awareness.chooseForgottenTicket', ticketId: null })}
          >
            Choose a ticket…
          </Button>
          <Button
            isPending={actions.isPending('snooze')}
            onPress={() => void actions.run('snooze', { type: 'awareness.deferForgotten', untilTomorrow: false })}
          >
            Snooze 15 min
          </Button>
          <Button
            isPending={actions.isPending('ignore')}
            onPress={() => void actions.run('ignore', { type: 'awareness.deferForgotten', untilTomorrow: true })}
          >
            Ignore today
          </Button>
        </>
      }
    >
      <p className={styles.text}>
        {`You’ve been active in selected work apps, including ${reminder.appName}, with no timer running.`}
      </p>
      {tickets.length > 0 ? (
        <>
          <p className={styles.caption}>Tickets on your watched branches</p>
          <div className={styles.ticketChoices}>
            {tickets.slice(0, 4).map((ticket) => (
              <Button
                key={`${ticket.repository}:${ticket.ticketId}`}
                size="small"
                isDisabled={writeDisabled}
                isPending={actions.isPending(`ticket:${ticket.ticketId}`)}
                aria-label={`${ticket.repository} · #${ticket.ticketId}${ticket.title ? ` ${ticket.title}` : ''}`}
                onPress={() =>
                  void actions.run(`ticket:${ticket.ticketId}`, {
                    type: 'awareness.chooseForgottenTicket',
                    ticketId: ticket.ticketId,
                  })
                }
              >
                {`${ticket.repository} · #${ticket.ticketId}`}
              </Button>
            ))}
          </div>
        </>
      ) : null}
      <p className={styles.caption}>Starting tracks from now. Use the Time editor to review earlier gaps.</p>
    </PromptCard>
  );
}
