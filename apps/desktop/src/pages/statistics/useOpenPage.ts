import { useCallback, useLayoutEffect, useRef } from 'react';
import { isTauri } from '../../ipc';
import { showMain } from '../../ipc/shell';
import type { PageId } from '../../layout/navigation';
import { useRegisteredCommands } from '../../shortcuts/hooks';

/**
 * A callback with a stable identity that always runs the latest `handler`. Table cells keep the
 * elements of unchanged rows (React Aria caches them per row object), so handlers used inside
 * cells must not capture values from an older render.
 */
export function useStableHandler<A extends unknown[]>(handler: (...args: A) => void): (...args: A) => void {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}

/**
 * Opens another sidebar page from inside a page (1.14 "Open original entry's day in Time
 * editor"). Runs the sidebar's own page command, so hidden pages and the page shortcuts stay in
 * one place; without one (an isolated page), the shell is asked to show the page.
 */
export function useOpenPage(): (page: PageId) => void {
  const commands = useRegisteredCommands();
  return useStableHandler((page: PageId) => {
    const command = commands.find((entry) => entry.id === `page.${page}`);
    if (command && !command.isDisabled) command.onAction();
    else if (isTauri()) void showMain(page);
  });
}
