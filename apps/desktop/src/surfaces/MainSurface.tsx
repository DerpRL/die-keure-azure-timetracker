import { useState } from 'react';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { StatusDot } from '../components/Badge';
import { AppShell } from '../layout/AppShell';
import { PAGES, type PageId } from '../layout/navigation';
import { PageHeader } from '../layout/PageHeader';
import styles from './surfaces.module.css';

/**
 * Main window. Business pages arrive with the typed IPC contract; until then every page is an
 * empty state so the shell, navigation and shortcuts can be exercised end to end.
 */
export function MainSurface() {
  const [page, setPage] = useState<PageId>('overview');
  const definition = PAGES[page];
  return (
    <AppShell
      currentPage={page}
      onNavigate={setPage}
      header={<PageHeader title={definition.title} status={<StatusDot tone="neutral" label="Not connected" showLabel />} />}
      sidebarFooter={
        <div className={styles.sidebarFooter}>
          <StatusDot tone="neutral" label="Observations paused" showLabel />
          <Button size="small" fullWidth isDisabled>
            Resume watching
          </Button>
        </div>
      }
    >
      <EmptyState
        icon={definition.icon}
        title={definition.title}
        description="This page is being rebuilt for Azure timetracker 2.0."
        headingLevel={2}
      />
    </AppShell>
  );
}
