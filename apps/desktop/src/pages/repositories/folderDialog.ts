import { open } from '@tauri-apps/plugin-dialog';
import { isTauri } from '../../ipc';

export const NO_DIALOG_MESSAGE = 'The folder chooser is only available in the desktop app.';

/**
 * The native folder chooser (1.14 `chooseRepositoryFolder`). Resolves with the chosen path, or
 * `null` when the user cancelled. The engine scans it (`repositories.scan`).
 */
export async function chooseRepositoryFolder(): Promise<string | null> {
  if (!isTauri()) throw new Error(NO_DIALOG_MESSAGE);
  const chosen = await open({
    directory: true,
    multiple: false,
    title: 'Choose a repository or a parent folder',
  });
  return typeof chosen === 'string' ? chosen : null;
}
