import { Skeleton } from '../components/EmptyState';

/** While a view's code loads. */
export function PageFallback() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton lines={4} />
    </div>
  );
}
