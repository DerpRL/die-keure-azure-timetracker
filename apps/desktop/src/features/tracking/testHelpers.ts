/**
 * Test-only helpers for the tracking, prompt and panel tests (imported from `*.test.tsx` only).
 */
import { expectNoA11yViolations } from '../../test/axe';

/**
 * React Aria's Button announces its pending state through an `aria-labelledby` reference. When
 * the pressed button unmounts (a prompt resolved, a step changed), that entry points at nothing
 * until it expires a few seconds later, which axe reports. Drop such leftovers before a check.
 */
export function clearStaleButtonAnnouncements(): void {
  for (const node of document.querySelectorAll('[data-live-announcer] [role="img"][aria-labelledby]')) {
    const ids = (node.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    if (ids.some((id) => !document.getElementById(id))) node.remove();
  }
}

/** `expectNoA11yViolations` after dropping stale pending-button announcements. */
export async function expectAccessible(context?: Element | Document): Promise<void> {
  clearStaleButtonAnnouncements();
  await expectNoA11yViolations(context);
}
