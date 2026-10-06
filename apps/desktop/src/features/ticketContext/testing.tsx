/**
 * Test-only helpers for the worklog pages and the ticket context sheet.
 */
import type { ReactNode } from 'react';
import { destroyAnnouncer } from 'react-aria/private/live-announcer/LiveAnnouncer';
import type { PageId } from '../../layout/navigation';
import { useCommands } from '../../shortcuts/hooks';

/**
 * React Aria announces pending buttons through `aria-labelledby` messages in its own live region,
 * which outlives a test's render. Drop it between tests so axe never sees references to elements
 * of an earlier test.
 */
export function resetAriaAnnouncer(): void {
  destroyAnnouncer();
}

/** The main window's frame around a page: the `main` landmark with the page title as its h1. */
export function PageFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main aria-labelledby="page-title">
      <h1 id="page-title">{title}</h1>
      {children}
    </main>
  );
}

const PAGE_IDS: readonly PageId[] = ['overview', 'dayReview', 'offlineDrafts', 'statistics', 'weeklyReport', 'history', 'timeEditor', 'settings'];

/** Registers the main window's `page.<id>` commands (normally done by `AppShell`), reporting each open. */
export function FakePageCommands({ onOpen }: { onOpen: (page: PageId) => void }) {
  useCommands(PAGE_IDS.map((id) => ({ id: `page.${id}`, label: id, group: 'Pages' as const, onAction: () => onOpen(id) })));
  return null;
}
