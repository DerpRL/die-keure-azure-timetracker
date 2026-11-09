import { Button } from '../../components/Button';
import type { BranchPromptView, Intent } from '../../ipc/contract';
import { useWorkItem } from '../../state/hooks';
import { useIntents, useWriteGuards } from '../tracking/actions';
import { flowSurface } from '../tracking/CurrentTracking';
import { BranchIcon } from '../tracking/icons';
import { PromptCard, promptStyles as styles, usePromptContext } from './PromptCard';
import { t } from '../../i18n';

/**
 * "Branch changed" (1.14 `BranchPrompt` + `BranchBreakActions`): switch to the branch's ticket,
 * choose another, or keep the timer. Integration branches (`develop`, `long-feature/*`) offer
 * Pause, Stop or Keep instead.
 */
export function BranchPrompt({ view }: { view: BranchPromptView }) {
  const { surface } = usePromptContext();
  const { busy, connected, running } = useWriteGuards();
  const actions = useIntents();
  const { change } = view;
  const ticketId = change.ticketId ?? null;
  const item = useWorkItem(ticketId);
  const title = view.ticketTitle ?? item?.title ?? null;
  const writeDisabled = busy || !connected;

  // The engine runs the choice where the user clicked: the panel flow or the window's picker.
  const where = flowSurface(surface);
  const track: Intent = { type: 'branch.track', id: change.id, surface: where };
  const another: Intent = { type: 'branch.chooseAnother', id: change.id, surface: where };

  const keep = (
    <Button
      isDisabled={busy}
      isPending={actions.isPending('keep')}
      data-prompt-primary={view.suggestsBreak && !running ? '' : undefined}
      onPress={() => void actions.run('keep', { type: 'branch.keep', id: change.id })}
    >
      {running ? (view.suggestsBreak ? t('Keep current') : t('Keep tracking')) : t('Dismiss')}
    </Button>
  );

  const buttons = view.suggestsBreak ? (
    <>
      {keep}
      <span className={styles.spacer} />
      {running ? (
        <>
          <Button
            isDisabled={writeDisabled}
            isPending={actions.isPending('pause')}
            onPress={() => void actions.run('pause', { type: 'branch.pause', id: change.id })}
          >
            {t('Pause')}
          </Button>
          <Button
            variant="primary"
            data-prompt-primary=""
            isDisabled={writeDisabled}
            isPending={actions.isPending('stop')}
            onPress={() => void actions.run('stop', { type: 'branch.stop', id: change.id })}
          >
            {t('Stop')}
          </Button>
        </>
      ) : (
        <span className={styles.caption}>{t('No active timer')}</span>
      )}
    </>
  ) : (
    <>
      {keep}
      <Button
        variant="primary"
        data-prompt-primary=""
        isDisabled={writeDisabled}
        isPending={actions.isPending('track')}
        onPress={() => void actions.run('track', track)}
      >
        {ticketId !== null ? t('Track #{id}…', { id: ticketId }) : t('Choose activity…')}
      </Button>
      {ticketId !== null ? (
        <Button
          variant="plain"
          className={styles.another}
          isDisabled={writeDisabled}
          isPending={actions.isPending('another')}
          onPress={() => void actions.run('another', another)}
        >
          {t('Choose another ticket…')}
        </Button>
      ) : null}
    </>
  );

  return (
    <PromptCard
      kind="branch"
      icon={BranchIcon}
      tone="warning"
      title={t('Branch changed')}
      subtitle={change.repositoryName}
      badge={t('Needs review')}
      actions={buttons}
      runner={actions}
    >
      <dl className={styles.branchLines}>
        {change.previousBranch ? (
          <>
            <dt className={styles.branchLabel}>{t('From')}</dt>
            <dd className={styles.branchName}>{change.previousBranch}</dd>
          </>
        ) : null}
        <dt className={styles.branchLabel}>{t('To')}</dt>
        <dd className={`${styles.branchName} ${styles.branchCurrent}`}>{change.branch}</dd>
      </dl>
      {view.suggestsBreak ? (
        <p className={styles.caption}>{t('This is an integration branch. Pause, stop or keep your timer.')}</p>
      ) : ticketId !== null ? (
        <>
          <p className={styles.strong}>{`${t('Suggested: #{id}', { id: ticketId })}${title ? ` · ${title}` : ''}`}</p>
          <p className={styles.caption}>{t('Choose an activity to switch. Your timer stays unchanged until you confirm.')}</p>
        </>
      ) : (
        <p className={styles.caption}>{t('No ticket number found. Track an activity without a ticket, or keep your timer.')}</p>
      )}
    </PromptCard>
  );
}
