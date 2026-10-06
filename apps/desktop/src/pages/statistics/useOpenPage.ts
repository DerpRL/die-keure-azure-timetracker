import { useCallback } from 'react';
import { isTauri } from '../../ipc';
import { showMain } from '../../ipc/shell';
import type { PageId } from '../../layout/navigation';
import { useRegisteredCommands } from '../../shortcuts/hooks';

/**
 * Opens another sidebar page from inside a page (1.14 "Open original entry's day in Time
 * editor"). Runs the sidebar's own page command, so hidden pages and the page shortcuts stay in
 * one place; without one (an isolated page), the shell is asked to show the page.
 */
export function useOpenPage(): (page: PageId) => void {
  const commands = useRegisteredCommands();
  return useCallback(
    (page: PageId) => {
      const command = commands.find((entry) => entry.id === `page.${page}`);
      if (command && !command.isDisabled) command.onAction();
      else if (isTauri()) void showMain(page);
    },
    [commands],
  );
}
