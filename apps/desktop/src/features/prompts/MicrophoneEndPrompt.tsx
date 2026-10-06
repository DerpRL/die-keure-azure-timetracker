import { Button } from '../../components/Button';
import type { MicrophoneEndPrompt as MicrophoneEndView } from '../../ipc/contract';
import { useSlice } from '../../state/hooks';
import { useIntents, useWriteGuards } from '../tracking/actions';
import { MicrophoneOffIcon } from '../tracking/icons';
import { PromptCard, promptStyles as styles } from './PromptCard';

/**
 * "Microphone use stopped" (1.14 `MicrophoneEndPromptView`): has the meeting finished? Keep,
 * pause or stop the timer that ran during the call, or resume the ticket from before it.
 */
export function MicrophoneEndPrompt({ prompt, canReturn }: { prompt: MicrophoneEndView; canReturn: boolean }) {
  const tracking = useSlice('tracking');
  const { busy, connected, preview } = useWriteGuards();
  const actions = useIntents();
  const writeDisabled = busy || !connected || preview;
  return (
    <PromptCard
      kind="microphoneEnd"
      icon={MicrophoneOffIcon}
      title="Microphone use stopped"
      runner={actions}
      actions={
        <>
          <Button
            data-prompt-primary=""
            isDisabled={busy}
            isPending={actions.isPending('keep')}
            onPress={() => void actions.run('keep', { type: 'microphone.endKeep' })}
          >
            Keep tracking
          </Button>
          <span className={styles.spacer} />
          <Button
            isDisabled={writeDisabled}
            isPending={actions.isPending('pause')}
            onPress={() => void actions.run('pause', { type: 'microphone.endPause' })}
          >
            Pause
          </Button>
          <Button
            isDisabled={writeDisabled}
            isPending={actions.isPending('stop')}
            onPress={() => void actions.run('stop', { type: 'microphone.endStop' })}
          >
            Stop
          </Button>
          {canReturn ? (
            <Button
              variant="plain"
              isDisabled={writeDisabled}
              isPending={actions.isPending('return')}
              onPress={() => void actions.run('return', { type: 'meeting.returnResume' })}
            >
              Resume previous ticket…
            </Button>
          ) : null}
        </>
      }
    >
      <p className={styles.text}>
        {`${prompt.appNames.join(', ')} has not used the microphone for at least a minute. Has your meeting finished?`}
      </p>
      <p className={styles.strong}>{`Your timer is still running: ${tracking?.title ?? 'Tracking'}`}</p>
      <p className={styles.caption}>
        If you only muted, keep tracking. Pause saves this task for resuming; Stop finishes tracking.
      </p>
    </PromptCard>
  );
}
