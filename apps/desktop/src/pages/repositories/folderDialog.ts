import { open } from '@tauri-apps/plugin-dialog';

/**
 * The native folder chooser (1.14 `chooseRepositoryFolder`). Resolves with the chosen path, or
 * `null` when the user cancelled. The engine scans it (`repositories.scan`).
 */
export async function chooseRepositoryFolder(): Promise<string | null> {
  const chosen = await open({
    directory: true,
    multiple: false,
    title: 'Choose a repository or a parent folder',
  });
  return typeof chosen === 'string' ? chosen : null;
}
