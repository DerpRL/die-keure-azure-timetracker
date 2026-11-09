import { useEffect, useRef, useState, type ReactNode } from 'react';
import { announce } from '../../components/Announcer';
import { Banner, type BannerTone } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { ProgressBar } from '../../components/Progress';
import { useSlice } from '../../state/hooks';
import type { UpdatePhase, UpdateStatus } from './api';
import { ACTION_LABELS, downloadPercent, downloadText, hasUpdate, phaseAnnouncement, updateAction } from './model';
import { UpdateDetails } from './UpdateDetails';
import { useUpdateActions, useUpdateStatus } from './useUpdateStatus';
import styles from './updates.module.css';
import { mark, t } from '../../i18n';

const TITLES: Partial<Record<UpdatePhase, string>> = {
  available: mark('App update available'),
  downloading: mark('Downloading update'),
  ready: mark('Update ready to install'),
  installing: mark('Installing update'),
  failed: mark('Update needs attention'),
};

function toneOf(status: UpdateStatus): BannerTone {
  if (status.phase === 'failed' || (status.phase === 'ready' && status.error)) return 'warning';
  if (status.phase === 'ready') return 'success';
  return 'info';
}

/** Announces phase changes once (the banner itself is not a live region, so progress stays quiet). */
function usePhaseAnnouncements(status: UpdateStatus | undefined) {
  const previous = useRef<string | null>(null);
  const key = status ? `${status.phase}|${status.version ?? ''}|${status.error ?? ''}` : null;
  useEffect(() => {
    if (!status || key === null) return;
    const before = previous.current;
    previous.current = key;
    // The state found on mount is shown, not announced.
    if (before === null || before === key || !hasUpdate(status)) return;
    const message = phaseAnnouncement(status);
    if (message) announce(message);
  }, [key, status]);
}

/**
 * The main window's update banner (1.14 `AppUpdateBanner`): an offered update, the download
 * progress, "Restart to update" once it is verified, and failures with their details. Failed
 * background checks stay in Settings → App updates.
 */
export function UpdateBanner() {
  const { status } = useUpdateStatus();
  const app = useSlice('app');
  const actions = useUpdateActions();
  const [showDetails, setShowDetails] = useState(false);
  usePhaseAnnouncements(status);

  if (!hasUpdate(status)) return null;
  const action = updateAction(status);
  const restartBlocked = action === 'restart' && (app?.busy ?? false);
  const percent = downloadPercent(status);

  let body: ReactNode;
  switch (status.phase) {
    case 'downloading':
      body = (
        <ProgressBar
          label={t('Update download')}
          value={percent ?? 0}
          isIndeterminate={percent === null}
          valueLabel={percent === null ? downloadText(status) : `${percent}% · ${downloadText(status)}`}
          detail={percent === null ? downloadText(status) : undefined}
        />
      );
      break;
    case 'ready':
      body = (
        <>
          <p>{status.error ?? status.message}</p>
          <p>{t('Restarting keeps your 7pace timer running. Save any open edits first.')}</p>
          {restartBlocked ? <p>{t('Waiting for the current operation to finish…')}</p> : null}
        </>
      );
      break;
    case 'failed':
      body = <p>{status.error ?? status.message}</p>;
      break;
    default:
      body = <p>{status.message}</p>;
  }

  return (
    <>
      <Banner
        tone={toneOf(status)}
        title={TITLES[status.phase] ? t(TITLES[status.phase]!) : undefined}
        live="off"
        actions={
          <>
            {action ? (
              <Button
                variant="primary"
                size="small"
                onPress={() => void actions.install()}
                isDisabled={restartBlocked}
                isPending={actions.pending === 'install'}
              >
                {t(ACTION_LABELS[action])}
              </Button>
            ) : null}
            <Button size="small" onPress={() => setShowDetails(true)} aria-label={t('View details of the app update')}>
              {t('View details')}
            </Button>
          </>
        }
      >
        <div className={styles.bannerBody}>
          {body}
          {actions.error ? (
            <p role="alert" className={styles.error}>
              {actions.error}
            </p>
          ) : null}
        </div>
      </Banner>
      <Dialog
        isOpen={showDetails}
        onOpenChange={setShowDetails}
        title={t('App updates')}
        cancelLabel={t('Done')}
        size="medium"
      >
        <UpdateDetails status={status} headingLevel={3} />
      </Dialog>
    </>
  );
}
