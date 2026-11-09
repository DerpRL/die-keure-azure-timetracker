import { Button } from '../../components/Button';
import type { MicrophoneSession } from '../../ipc/contract';
import { useIntents, useWriteGuards } from '../tracking/actions';
import { MicrophoneIcon } from '../tracking/icons';
import { PromptCard, promptStyles as styles } from './PromptCard';
import { t } from '../../i18n';

/**
 * "Microphone in use · possible meeting" (1.14 `MicrophonePrompt`): track a meeting or a daily
 * stand-up without a ticket, or dismiss.
 */
export function MicrophonePrompt({ session }: { session: MicrophoneSession }) {
  const { busy, connected, running } = useWriteGuards();
  const actions = useIntents();
  const writeDisabled = busy || !connected;
  return (
    <PromptCard
      kind="microphone"
      icon={MicrophoneIcon}
      title={t('Microphone in use · possible meeting')}
      runner={actions}
      actions={
        <>
          <Button
            isDisabled={busy}
            isPending={actions.isPending('dismiss')}
            onPress={() => void actions.run('dismiss', { type: 'microphone.dismiss', sessionId: session.id })}
          >
            {running ? t('Keep current') : t('Dismiss')}
          </Button>
          <span className={styles.spacer} />
          <Button
            variant="primary"
            data-prompt-primary=""
            isDisabled={writeDisabled}
            isPending={actions.isPending('meeting')}
            onPress={() => void actions.run('meeting', { type: 'microphone.choose', sessionId: session.id, standup: false })}
          >
            {t('Meeting…')}
          </Button>
          <Button
            isDisabled={writeDisabled}
            isPending={actions.isPending('standup')}
            onPress={() => void actions.run('standup', { type: 'microphone.choose', sessionId: session.id, standup: true })}
          >
            {t('Daily standup…')}
          </Button>
        </>
      }
    >
      <p className={styles.strong}>{session.owner.name}</p>
      <p className={styles.caption}>
        {t('Track a meeting, or a daily standup with the Standup activity and comment ‘daily standup’. Both use no Azure ticket.')}
      </p>
    </PromptCard>
  );
}
