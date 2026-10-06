import { useState } from 'react';
import { announce } from '../../components/Announcer';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Heading, type HeadingLevel } from '../../components/Card';
import { ExternalLinkIcon, SuccessIcon, WarningIcon } from '../../components/icons';
import { ProgressBar } from '../../components/Progress';
import { useSlice } from '../../state/hooks';
import { openDownloadsPage, type UpdateStatus } from './api';
import {
  ACTION_LABELS,
  canCheck,
  downloadPercent,
  downloadText,
  formatDate,
  formatDateTime,
  updateAction,
} from './model';
import { useUpdateActions } from './useUpdateStatus';
import styles from './updates.module.css';

export interface UpdateDetailsProps {
  status: UpdateStatus;
  /** Level of the "Version 2.0.1" heading in the surrounding outline. */
  headingLevel?: HeadingLevel;
  /**
   * Announce the result of "Check for updates" when it does not change the update banner
   * ("You're up to date.", a failed check). The banner announces offered updates itself.
   */
  announceChecks?: boolean;
}

/** Installed version, the offered release, progress and the update actions (1.14 `UpdateDetailsView`). */
export function UpdateDetails({ status, headingLevel = 3, announceChecks = true }: UpdateDetailsProps) {
  const app = useSlice('app');
  const actions = useUpdateActions();
  const [linkError, setLinkError] = useState<string | null>(null);
  const action = updateAction(status);
  const busy = app?.busy ?? false;
  const restartBlocked = action === 'restart' && busy;
  const installedVersion = status.currentVersion || app?.version || '';
  const checked = formatDateTime(status.checkedAt);
  const published = formatDate(status.date);
  const failed = status.phase === 'failed';
  const percent = downloadPercent(status);

  const check = async () => {
    const result = await actions.check();
    if (announceChecks && result && (result.phase === 'idle' || result.phase === 'failed')) announce(result.message);
  };

  const openDownloads = () => {
    setLinkError(null);
    openDownloadsPage().catch((error: unknown) => setLinkError(error instanceof Error ? error.message : String(error)));
  };

  return (
    <div className={styles.details}>
      <p className={styles.installed}>
        <SuccessIcon />
        {installedVersion ? `Installed version ${installedVersion}` : 'Installed version unknown'}
      </p>
      {status.phase === 'ready' && status.error ? (
        <Banner tone="warning" title="Installation needs attention" live="off">
          {status.error}
        </Banner>
      ) : (
        <p className={failed ? `${styles.message} ${styles.warning}` : styles.message}>
          {failed ? <WarningIcon /> : null}
          <span>{status.message}</span>
        </p>
      )}
      {checked ? <p className={styles.meta}>Last checked: {checked}</p> : null}
      {status.version ? (
        <div className={styles.release}>
          <Heading level={headingLevel} className={styles.releaseTitle}>
            Version {status.version}
          </Heading>
          {published ? <p className={styles.meta}>Published {published}</p> : null}
          {status.notes ? <p className={styles.notes}>{status.notes}</p> : null}
          {status.phase === 'downloading' ? (
            <ProgressBar
              label="Update download"
              value={percent ?? 0}
              isIndeterminate={percent === null}
              valueLabel={percent === null ? downloadText(status) : `${percent}% · ${downloadText(status)}`}
              detail={percent === null ? downloadText(status) : undefined}
            />
          ) : null}
          {action === 'download' || action === 'restart' || action === 'retry' ? (
            <p className={styles.hint}>Restarting keeps your 7pace timer running. Save any open edits first.</p>
          ) : null}
        </div>
      ) : null}
      <div className={styles.buttons}>
        <Button
          onPress={() => void check()}
          isDisabled={!canCheck(status) || actions.pending === 'install'}
          isPending={actions.pending === 'check' || status.phase === 'checking'}
        >
          Check for updates
        </Button>
        {action ? (
          <Button
            variant="primary"
            onPress={() => void actions.install()}
            isDisabled={restartBlocked || actions.pending === 'check'}
            isPending={actions.pending === 'install'}
          >
            {ACTION_LABELS[action]}
          </Button>
        ) : null}
        <Button variant="plain" trailingIcon={ExternalLinkIcon} onPress={openDownloads}>
          Download installer on GitHub<span className="visually-hidden"> (opens in your browser)</span>
        </Button>
      </div>
      {restartBlocked ? <p className={styles.hint}>Waiting for the current operation to finish…</p> : null}
      {actions.error ? (
        <p role="alert" className={styles.error}>
          {actions.error}
        </p>
      ) : null}
      {linkError ? (
        <p role="alert" className={styles.error}>
          {linkError}
        </p>
      ) : null}
      <p className={styles.hint}>
        Downloads are verified with the app’s release key. Operating system security and account permission prompts may
        still appear.
      </p>
    </div>
  );
}
