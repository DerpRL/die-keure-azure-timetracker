import { Skeleton } from '../components/EmptyState';
import { t } from '../i18n';

/** While a view's code loads. */
export function PageFallback() {
  return (
    <div aria-busy="true" aria-label={t('Loading')}>
      <Skeleton lines={4} />
    </div>
  );
}
