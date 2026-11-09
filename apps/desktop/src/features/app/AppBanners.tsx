import { Banner } from '../../components/Banner';
import { useAction, useSlice } from '../../state/hooks';
import { UpdateBanner } from '../updates/UpdateBanner';
import { t } from '../../i18n';

/**
 * App-wide messages above the page: storage problems, the latest error (dismissible), notices,
 * preview mode and updates. Page-specific issues stay on their pages.
 */
export function AppBanners() {
  const app = useSlice('app');
  const dismiss = useAction();
  if (!app) return <UpdateBanner />;
  return (
    <>
      {app.storageIssue ? (
        <Banner tone="error" title={t('Settings or tracking data could not be saved')}>
          {app.storageIssue}
        </Banner>
      ) : null}
      {app.error ? (
        <Banner
          tone="error"
          onDismiss={() => void dismiss.run({ type: 'app.dismissError' })}
          dismissLabel={t('Dismiss error')}
        >
          {app.error}
        </Banner>
      ) : null}
      {app.notice ? (
        <Banner tone="info" onDismiss={() => void dismiss.run({ type: 'app.dismissNotice' })} dismissLabel={t('Dismiss')}>
          {app.notice}
        </Banner>
      ) : null}
      {app.preview ? (
        <Banner tone="warning" title={t('Preview mode')}>
          {t('Network requests, credential changes and calendar access are turned off.')}
        </Banner>
      ) : null}
      <UpdateBanner />
    </>
  );
}
