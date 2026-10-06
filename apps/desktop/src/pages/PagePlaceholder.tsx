import { EmptyState } from '../components/EmptyState';
import { PAGES, type PageId } from '../layout/navigation';

/** Shown by a page that is not built yet. */
export function PagePlaceholder({ page }: { page: PageId }) {
  const definition = PAGES[page];
  return (
    <EmptyState
      icon={definition.icon}
      title={definition.title}
      description="This page is being rebuilt for Azure timetracker 2.0."
      headingLevel={2}
    />
  );
}
