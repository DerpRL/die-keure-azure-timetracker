import { useCallback } from 'react';

export type Politeness = 'polite' | 'assertive';

const CLEAR_AFTER_MS = 7000;
const regions = new Map<Politeness, HTMLElement>();
const timers = new Map<Politeness, ReturnType<typeof setTimeout>>();

/**
 * One persistent, visually hidden live region per politeness level, appended to <body>.
 * `data-live-announcer` keeps React Aria's modal `aria-hidden` handling from hiding it, so
 * announcements still work while a dialog is open.
 */
function region(politeness: Politeness): HTMLElement {
  const existing = regions.get(politeness);
  if (existing?.isConnected) return existing;
  const element = document.createElement('div');
  element.className = 'visually-hidden';
  element.setAttribute('aria-live', politeness);
  element.setAttribute('aria-atomic', 'true');
  element.setAttribute('aria-relevant', 'additions text');
  element.dataset.liveAnnouncer = 'true';
  element.dataset.announcer = politeness;
  document.body.appendChild(element);
  regions.set(politeness, element);
  return element;
}

/**
 * Announces a message to screen readers without moving focus. Repeated identical messages are
 * announced again (the region is cleared first). Use `polite` for tracking state changes and
 * prompt arrival; `assertive` only for errors that block the current task.
 */
export function announce(message: string, politeness: Politeness = 'polite'): void {
  if (typeof document === 'undefined' || !message) return;
  const element = region(politeness);
  element.textContent = '';
  clearTimeout(timers.get(politeness));
  // A separate task, so assistive technology sees a change even for the same text.
  timers.set(
    politeness,
    setTimeout(() => {
      element.textContent = message;
      timers.set(
        politeness,
        setTimeout(() => {
          element.textContent = '';
        }, CLEAR_AFTER_MS),
      );
    }, 50),
  );
}

/** Clears pending and visible announcements (tests and surface teardown). */
export function clearAnnouncements(): void {
  for (const [politeness, element] of regions) {
    clearTimeout(timers.get(politeness));
    element.textContent = '';
  }
}

/** Hook form of `announce`, stable across renders. */
export function useAnnounce(): (message: string, politeness?: Politeness) => void {
  return useCallback((message: string, politeness: Politeness = 'polite') => announce(message, politeness), []);
}
