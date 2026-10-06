import { Button } from '../../components/Button';
import type { IdlePeriod } from '../../ipc/contract';
import { formatShortDuration } from '../../utils/duration';
import { useIntents, useWriteGuards } from '../tracking/actions';
import { IdleIcon } from '../tracking/icons';
import { PromptCard, promptStyles as styles, useTimeOfDay } from './PromptCard';

function idleSeconds(idle: IdlePeriod): number {
  const start = Date.parse(idle.start);
  const end = Date.parse(idle.end ?? idle.start);
  return Number.isNaN(start) || Number.isNaN(end) ? 0 : Math.max(0, (end - start) / 1000);
}

/**
 * "Review time away" (1.14 `WorkAwarenessPrompts`, idle part): keep the recorded time, or pause
 * now and preview removing or separating the interval. Nothing is edited until saved.
 */
export function IdlePrompt({ idle }: { idle: IdlePeriod }) {
  const { busy, confirmed } = useWriteGuards();
  const actions = useIntents();
  const time = useTimeOfDay();
  return (
    <PromptCard
      kind="idle"
      icon={IdleIcon}
      tone="warning"
      title="Review time away"
      runner={actions}
      actions={
        <>
          <Button
            isDisabled={busy}
            isPending={actions.isPending('keep')}
            onPress={() => void actions.run('keep', { type: 'awareness.keepIdle' })}
          >
            Keep time
          </Button>
          <Button
            variant="primary"
            data-prompt-primary=""
            isDisabled={busy || !confirmed}
            isPending={actions.isPending('review')}
            onPress={() => void actions.run('review', { type: 'awareness.reviewIdle', promptId: idle.id })}
          >
            Pause & review…
          </Button>
        </>
      }
    >
      <p className={styles.strong}>{idle.session.title}</p>
      <p className={styles.text}>{`${idle.reason} · ${formatShortDuration(idleSeconds(idle))}`}</p>
      <p className={styles.time}>{`${time(idle.start)} – ${time(idle.end ?? idle.start)}`}</p>
      <p className={styles.caption}>
        Keep the recorded time, or pause now and preview removing or separating this interval. Nothing is edited until
        you save.
      </p>
    </PromptCard>
  );
}

/**
 * "Saved idle-time review": the interval saved by Pause & review, waiting to be applied in the
 * Time editor or discarded.
 */
export function IdleCorrectionPrompt() {
  const { busy, connected } = useWriteGuards();
  const actions = useIntents();
  return (
    <PromptCard
      kind="idleCorrection"
      icon={IdleIcon}
      title="Saved idle-time review"
      runner={actions}
      actions={
        <>
          <Button
            variant="primary"
            data-prompt-primary=""
            isDisabled={busy || !connected}
            isPending={actions.isPending('open')}
            onPress={() => void actions.run('open', { type: 'awareness.openCorrection' })}
          >
            Open correction preview…
          </Button>
          <Button
            isDisabled={busy}
            isPending={actions.isPending('discard')}
            onPress={() => void actions.run('discard', { type: 'awareness.discardCorrection' })}
          >
            Keep recorded time
          </Button>
        </>
      }
    >
      <p className={styles.caption}>
        Review the detected interval before changing recorded time. Your timer may already be paused.
      </p>
    </PromptCard>
  );
}
