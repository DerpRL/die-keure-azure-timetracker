import { Button } from '../../components/Button';
import { ArrowRightIcon, DayReviewIcon } from '../../components/icons';
import type { DayReviewPromptView } from '../../ipc/contract';
import { useIntents, useWriteGuards } from '../tracking/actions';
import { PromptCard, promptStyles as styles } from './PromptCard';

/** "Review your day" (1.14 `DayReviewPrompt`): open the review, snooze it, or mark the day reviewed. */
export function DayReviewPrompt({ view }: { view: DayReviewPromptView }) {
  const { running } = useWriteGuards();
  const actions = useIntents();
  return (
    <PromptCard
      kind="dayReview"
      icon={DayReviewIcon}
      title="Review your day"
      runner={actions}
      actions={
        <>
          <Button
            isDisabled={!view.canSnooze}
            isPending={actions.isPending('snooze')}
            onPress={() => void actions.run('snooze', { type: 'dayReview.snooze' })}
          >
            Snooze 30 min
          </Button>
          <Button
            variant="plain"
            isPending={actions.isPending('reviewed')}
            onPress={() => void actions.run('reviewed', { type: 'dayReview.markReviewed', day: view.day })}
          >
            Mark day reviewed
          </Button>
          <span className={styles.spacer} />
          <Button
            variant="primary"
            data-prompt-primary=""
            trailingIcon={ArrowRightIcon}
            isPending={actions.isPending('open')}
            onPress={() => void actions.run('open', { type: 'dayReview.open' })}
          >
            Open review
          </Button>
        </>
      }
    >
      <p className={styles.caption}>Check your time entries and current timer before finishing.</p>
      {running ? <p className={styles.caption}>Marking the day reviewed will leave this timer running.</p> : null}
    </PromptCard>
  );
}
