import { useState } from 'react';
import { Button } from '../../components/Button';
import { InfoIcon, WarningIcon } from '../../components/icons';
import { showMain } from '../../ipc/shell';
import { useSlice } from '../../state/hooks';
import { downloadPercent, hasUpdate } from './model';
import { useUpdateActions, useUpdateStatus } from './useUpdateStatus';
import styles from './updates.module.css';

/**
 * One compact update line for the tray panel (1.14 compact `AppUpdateBanner`): "Version 2.0.1 is
 * available" with View update, progress while downloading, Restart to update once verified.
 */
export function UpdateNotice() {
  const { status } = useUpdateStatus();
  const app = useSlice('app');
  const actions = useUpdateActions();
  const [openError, setOpenError] = useState<string | null>(null);
  if (!hasUpdate(status)) return null;

  const view = () => {
    setOpenError(null);
    showMain('settings').catch((error: unknown) => setOpenError(error instanceof Error ? error.message : String(error)));
  };
  const percent = downloadPercent(status);
  const attention = status.phase === 'failed' || (status.phase === 'ready' && !!status.error);
  const Icon = attention ? WarningIcon : InfoIcon;

  let text: string;
  switch (status.phase) {
    case 'available':
      text = `Version ${status.version ?? ''} is available`;
      break;
    case 'downloading':
      text = percent === null ? 'Downloading update…' : `Downloading update… ${percent}%`;
      break;
    case 'ready':
      text = status.error ? 'Update ready · waiting to restart' : 'Update ready to install';
      break;
    case 'installing':
      text = 'Installing update…';
      break;
    default:
      text = 'Update needs attention';
  }

  return (
    <div className={styles.notice}>
      <Icon />
      <span className={styles.noticeText}>
        <strong>{text}</strong>
        {actions.error || openError ? <span role="alert"> · {actions.error ?? openError}</span> : null}
      </span>
      {status.phase === 'ready' ? (
        <Button
          size="small"
          variant="primary"
          onPress={() => void actions.install()}
          isDisabled={app?.busy ?? false}
          isPending={actions.pending === 'install'}
        >
          Restart to update
        </Button>
      ) : status.phase === 'available' || status.phase === 'failed' ? (
        <Button size="small" onPress={view} aria-label="View update in Settings">
          View update
        </Button>
      ) : null}
    </div>
  );
}
