/**
 * Test-only helpers for the worklog pages and the ticket context sheet.
 */
import { destroyAnnouncer } from 'react-aria/private/live-announcer/LiveAnnouncer';

/**
 * React Aria announces pending buttons through `aria-labelledby` messages in its own live region,
 * which outlives a test's render. Drop it between tests so axe never sees references to elements
 * of an earlier test.
 */
export function resetAriaAnnouncer(): void {
  destroyAnnouncer();
}
