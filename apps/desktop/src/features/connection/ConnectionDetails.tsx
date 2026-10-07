import { useId } from 'react';
import { useDateFormatter } from 'react-aria';
import { StatusDot } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Heading, type HeadingLevel } from '../../components/Card';
import { Skeleton } from '../../components/EmptyState';
import { RefreshIcon } from '../../components/icons';
import { useSlice } from '../../state/hooks';
import { connectionTone } from '../app/ConnectionStatus';
import { ActionError, useIntents, useWriteGuards } from '../tracking/actions';
import { openMainPage } from '../tracking/platform';
import styles from './connection.module.css';

function useStamp(): (iso: string) => string {
  const formatter = useDateFormatter({
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : formatter.format(date);
  };
}

/** Offline drafts waiting for upload, or the way to track locally while 7pace is away. */
export function LocalDraftStatus() {
  const offline = useSlice('offline');
  const connection = useSlice('connection');
  const ready = offline?.readyCount ?? 0;
  if (offline?.active) return null;
  if (ready > 0) {
    return (
      <Button variant="plain" size="small" onPress={() => openMainPage('offlineDrafts')}>
        {`Review ${ready} offline ${ready === 1 ? 'draft' : 'drafts'}`}
      </Button>
    );
  }
  if (connection && connection.health !== 'confirmed') {
    return (
      <Button variant="plain" size="small" onPress={() => openMainPage('offlineDrafts')}>
        Track locally…
      </Button>
    );
  }
  return null;
}

export interface ConnectionDetailsProps {
  /** `null` leaves the heading to the container (the panel's popover has its own title). */
  headingLevel: HeadingLevel | null;
}

/**
 * Connection details (1.14 `ConnectionDetailsView`): the 7pace status, when the timer and the
 * time entries were last checked, and each issue on its own line. Azure problems are reported
 * separately: they never mark a healthy 7pace connection as disconnected.
 */
export function ConnectionDetails({ headingLevel }: ConnectionDetailsProps) {
  const connection = useSlice('connection');
  const settings = useSlice('settings');
  const { busy, preview } = useWriteGuards();
  const actions = useIntents();
  const stamp = useStamp();
  const headingId = useId();

  const heading =
    headingLevel !== null ? (
      <Heading level={headingLevel} id={headingId} className={styles.heading}>
        Connection details
      </Heading>
    ) : null;

  if (!connection) {
    return (
      <div className={styles.details} aria-busy="true">
        {heading}
        <span role="status" className="visually-hidden">
          Loading the connection
        </span>
        <Skeleton lines={3} />
      </div>
    );
  }

  const completionReminders = settings?.configuration.completionReminders ?? false;
  return (
    <div className={styles.details}>
      {heading}
      <StatusDot tone={connectionTone(connection)} label={connection.status} showLabel />
      {connection.detail ? <p className={styles.caption}>{connection.detail}</p> : null}
      <p className={styles.caption}>
        {connection.lastSync ? `Timer checked ${stamp(connection.lastSync)}` : 'The timer has not been checked yet.'}
      </p>
      {connection.worklogSync ? (
        <p className={styles.caption}>{`Time entries checked ${stamp(connection.worklogSync)}`}</p>
      ) : null}
      {connection.connectionIssue ? <p className={styles.warning}>{connection.connectionIssue}</p> : null}
      {connection.azureIssue ? <p className={styles.warning}>{`Azure tickets: ${connection.azureIssue}`}</p> : null}
      {connection.progressIssue ? <p className={styles.warning}>{`Time totals: ${connection.progressIssue}`}</p> : null}
      {connection.completionIssue ? (
        <p className={styles.warning}>{`Ticket completion check: ${connection.completionIssue}`}</p>
      ) : null}
      {connection.shortcutIssue ? <p className={styles.warning}>{connection.shortcutIssue}</p> : null}
      {completionReminders && !connection.hasAzurePat ? (
        <p className={styles.caption}>Add an Azure PAT in Accounts to enable ticket completion reminders.</p>
      ) : null}
      <LocalDraftStatus />
      <div className={styles.actions}>
        <Button
          size="small"
          icon={RefreshIcon}
          isDisabled={busy || preview}
          isPending={actions.isPending('retry')}
          // 1.14: retry, then check the tracked ticket's completion state now.
          onPress={() => void actions.run('retry', { type: 'connection.recheck' })}
        >
          Refresh connection
        </Button>
      </div>
      <ActionError error={actions.error} />
    </div>
  );
}
