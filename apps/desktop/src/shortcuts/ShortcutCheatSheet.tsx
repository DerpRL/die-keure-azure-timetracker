import { useMemo } from 'react';
import { Dialog } from '../components/Dialog';
import { KeyboardShortcut } from '../components/KeyboardShortcut';
import { t } from '../i18n';
import type { KeyCombo } from './keys';
import { useRegisteredCommands } from './hooks';
import { COMMAND_GROUP_ORDER, PALETTE_GROUP_TITLES, type CommandGroup } from './store';
import styles from './ShortcutCheatSheet.module.css';

export interface ShortcutInfo {
  label: string;
  shortcut: KeyCombo;
  group: CommandGroup;
}

export interface ShortcutCheatSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  info?: readonly ShortcutInfo[];
}

/** Lists every registered shortcut, grouped, with platform-specific keys (`?` opens it). */
export function ShortcutCheatSheet({ isOpen, onOpenChange, info = [] }: ShortcutCheatSheetProps) {
  const commands = useRegisteredCommands();
  const groups = useMemo(() => {
    const rows = new Map<string, ShortcutInfo>();
    for (const command of commands) {
      if (!command.shortcut) continue;
      const label = command.group === 'Pages' ? t('Go to {page}', { page: command.label }) : command.label;
      // Keep the latest registration per command id, as dispatch does.
      rows.delete(command.id);
      rows.set(command.id, { label, shortcut: command.shortcut, group: command.group ?? 'Actions' });
    }
    // Info labels are English constants (`mark`) or already translated; `t` leaves the latter as they are.
    info.forEach((entry, index) => rows.set(`info:${index}`, { ...entry, label: t(entry.label) }));
    return COMMAND_GROUP_ORDER.map((group) => ({
      group,
      rows: [...rows.values()].filter((row) => row.group === group),
    })).filter((entry) => entry.rows.length > 0);
  }, [commands, info]);

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      title={t('Keyboard shortcuts')}
      description={t('Shortcuts do not fire while you type in a text field, except Save, Refresh, page navigation and the command palette.')}
      cancelLabel={t('Close')}
      isDismissable
      size="medium"
    >
      <div className={styles.groups}>
        {groups.map(({ group, rows }) => (
          <table key={group} className={styles.table}>
            <caption className={styles.caption}>{group === 'Pages' ? t('Navigation') : t(PALETTE_GROUP_TITLES[group])}</caption>
            <thead className="visually-hidden">
              <tr>
                <th scope="col">{t('Action')}</th>
                <th scope="col">{t('Shortcut')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.label}-${row.shortcut.key}`} className={styles.row}>
                  <th scope="row" className={styles.action}>
                    {row.label}
                  </th>
                  <td className={styles.keys}>
                    <KeyboardShortcut shortcut={row.shortcut} variant="standalone" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </Dialog>
  );
}
