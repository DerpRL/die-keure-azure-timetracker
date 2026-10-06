import { useCallback } from 'react';
import { isTauri } from '../../ipc';
import { showMain } from '../../ipc/shell';
import type { PageId } from '../../layout/navigation';
import { useRegisteredCommands } from '../../shortcuts/hooks';

/**
 * Opens another sidebar page from a page ("Open this day in History"). The main window registers
 * one palette command per visible page (`page.<id>`), so this runs that command; in the desktop
 * app it falls back to the shell's navigate event. Returns false when the page is not reachable
 * (hidden by the user), so callers can hide the button.
 */
export function useOpenPage(): { openPage: (page: PageId) => boolean; canOpen: (page: PageId) => boolean } {
  const commands = useRegisteredCommands();
  const canOpen = useCallback((page: PageId) => commands.some((command) => command.id === `page.${page}` && !command.isDisabled), [commands]);
  const openPage = useCallback(
    (page: PageId) => {
      const command = commands.find((entry) => entry.id === `page.${page}` && !entry.isDisabled);
      if (command) {
        command.onAction();
        return true;
      }
      if (isTauri()) {
        void showMain(page);
        return true;
      }
      return false;
    },
    [commands],
  );
  return { openPage, canOpen };
}
