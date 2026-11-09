import { StatusDot } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Skeleton } from '../../components/EmptyState';
import { Popover, PopoverTrigger } from '../../components/Popover';
import type { ConnectionSlice } from '../../ipc/contract';
import { useSlice } from '../../state/hooks';
import { connectionTone } from '../app/ConnectionStatus';
import { ActionError, useIntents, useWriteGuards } from '../tracking/actions';
import { openMainPage } from '../tracking/platform';
import { deviceName } from '../tracking/status';
import { ConnectionDetails, LocalDraftStatus } from './ConnectionDetails';
import styles from './connection.module.css';
import { t } from '../../i18n';

/** States the user fixes in Settings rather than by reconnecting. */
export function needsSetup(connection: ConnectionSlice): boolean {
  return connection.health === 'unconfigured' || connection.health === 'authentication' || connection.health === 'accessDenied';
}

/**
 * The panel's connection line (1.14 `ConnectionHealthView`, compact): status, Set up or
 * Reconnect, and the details in a popover.
 */
export function ConnectionHealth() {
  const connection = useSlice('connection');
  const tracking = useSlice('tracking');
  const app = useSlice('app');
  const { busy } = useWriteGuards();
  const actions = useIntents();

  if (!connection) {
    return (
      <div aria-busy="true" className={styles.health}>
        <span role="status" className="visually-hidden">
          {t('Loading the connection')}
        </span>
        <Skeleton lines={1} />
      </div>
    );
  }

  const health = connection.health;
  const settled = health === 'confirmed' || health === 'connecting';
  const detailIssue = Boolean(connection.azureIssue || connection.progressIssue);

  return (
    <div className={styles.health}>
      <div className={styles.healthLine}>
        <StatusDot
          tone={connectionTone(connection)}
          label={connection.status}
          showLabel
          pulse={health === 'connecting'}
          className={styles.status}
        />
        <div className={styles.actions}>
          {needsSetup(connection) ? (
            <Button size="small" onPress={() => openMainPage('settings')}>
              {t('Set up')}
            </Button>
          ) : !settled ? (
            <Button
              size="small"
              isDisabled={busy}
              isPending={actions.isPending('retry')}
              onPress={() => void actions.run('retry', { type: 'connection.retry' })}
            >
              {t('Reconnect')}
            </Button>
          ) : null}
          <PopoverTrigger>
            <Button variant="plain" size="small" aria-label={t('7pace connection details')}>
              {t('Details')}
            </Button>
            <Popover title={t('Connection details')} placement="top" width="medium">
              <ConnectionDetails headingLevel={null} />
            </Popover>
          </PopoverTrigger>
        </div>
      </div>
      {!settled && health !== 'unconfigured' ? (
        <p className={styles.warning}>
          {tracking?.showsLocalTimer
            ? t('Local tracking continues on {device}. Reconnect to confirm the 7pace timer.', { device: deviceName(app?.os) })
            : t('Showing the last known timer. Check 7pace before changing it.')}
        </p>
      ) : detailIssue ? (
        <p className={styles.warning}>{t('Some details could not refresh')}</p>
      ) : null}
      {tracking?.local ? null : <LocalDraftStatus />}
      <ActionError error={actions.error} />
    </div>
  );
}
