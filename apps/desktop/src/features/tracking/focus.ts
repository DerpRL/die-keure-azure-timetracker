import { useEffect, useRef, type RefObject } from 'react';

/** Focuses the first match of `selectors` (in order) inside `root`. */
export function focusFirst(root: ParentNode | null, selectors: readonly string[]): boolean {
  if (!root) return false;
  for (const selector of selectors) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) {
      element.focus();
      return true;
    }
  }
  return false;
}

/**
 * Keeps keyboard focus in the surface when the focused control disappears because the engine
 * changed state (a prompt was resolved, the tracking choice moved to its next step or ended):
 * focus moves to the first match of `fallbacks` instead of falling back to the document.
 */
export function useFocusRecovery(rootRef: RefObject<HTMLElement | null>, fallbacks: readonly string[]): void {
  const last = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) last.current = event.target;
    };
    root.addEventListener('focusin', onFocusIn);
    return () => root.removeEventListener('focusin', onFocusIn);
  }, [rootRef]);

  // After every render: the removal that lost focus came with the slice change that rendered.
  useEffect(() => {
    const previous = last.current;
    if (!previous || previous.isConnected) return;
    last.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    focusFirst(rootRef.current, fallbacks);
  });
}
