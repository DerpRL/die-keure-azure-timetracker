/**
 * Test-only helpers for the worklog pages and the ticket context sheet.
 */
import type { ReactNode } from 'react';
import { destroyAnnouncer } from 'react-aria/private/live-announcer/LiveAnnouncer';

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
