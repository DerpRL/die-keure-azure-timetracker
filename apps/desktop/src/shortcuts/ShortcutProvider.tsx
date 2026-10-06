import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CommandPalette } from './CommandPalette';
import { ShortcutContext, useCommands } from './hooks';
import { ShortcutCheatSheet, type ShortcutInfo } from './ShortcutCheatSheet';
import { isTextEntryTarget, matchesKeyCombo, type KeyCombo } from './keys';
import { getPlatform } from './platform';
import { CommandStore } from './store';

export const PALETTE_SHORTCUT: KeyCombo = { key: 'k', mod: true };
export const CHEAT_SHEET_SHORTCUT: KeyCombo = { key: '?' };

/** Keys that are not commands but belong in the cheat sheet. */
export const DEFAULT_SHORTCUT_INFO: readonly ShortcutInfo[] = [
  { label: 'Cancel or close a dialog', shortcut: { key: 'Escape' }, group: 'General' },
  { label: 'Confirm the default action in a dialog', shortcut: { key: 'Enter' }, group: 'General' },
];

function inDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]') !== null;
}

export interface ShortcutProviderProps {
  children: ReactNode;
  /** Extra informational rows for the cheat sheet, e.g. the configured global quick-switch key. */
  info?: readonly ShortcutInfo[];
  /** Disable the built-in ⌘/Ctrl+K palette and `?` cheat sheet (the mini timer has neither). */
  builtIns?: boolean;
}

/**
 * Owns the app's keyboard shortcuts: one keydown listener, a registry fed by `useCommand`, the
 * command palette (⌘K / Ctrl+K) and the cheat sheet (`?`).
 */
export function ShortcutProvider({ children, info = DEFAULT_SHORTCUT_INFO, builtIns = true }: ShortcutProviderProps) {
  const [store] = useState(() => new CommandStore());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const platform = getPlatform();
      const typing = isTextEntryTarget(event.target);
      const dialog = inDialog(event.target);
      const commands = store.snapshot();
      for (let index = commands.length - 1; index >= 0; index--) {
        const command = commands[index];
        if (!command?.shortcut || command.isDisabled) continue;
        if (!matchesKeyCombo(event, command.shortcut, platform)) continue;
        if (typing && !command.allowInInputs) continue;
        if (dialog && !command.allowInDialogs) continue;
        event.preventDefault();
        command.onAction();
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [store]);

  const value = useMemo(
    () => ({
      store,
      openPalette: () => setPaletteOpen(true),
      openCheatSheet: () => setCheatSheetOpen(true),
    }),
    [store],
  );

  return (
    <ShortcutContext.Provider value={value}>
      {builtIns ? (
        <BuiltInCommands onPalette={() => setPaletteOpen(true)} onCheatSheet={() => setCheatSheetOpen(true)} />
      ) : null}
      {children}
      {builtIns ? (
        <>
          <CommandPalette isOpen={paletteOpen} onOpenChange={setPaletteOpen} />
          <ShortcutCheatSheet isOpen={cheatSheetOpen} onOpenChange={setCheatSheetOpen} info={info} />
        </>
      ) : null}
    </ShortcutContext.Provider>
  );
}

function BuiltInCommands({ onPalette, onCheatSheet }: { onPalette: () => void; onCheatSheet: () => void }) {
  useCommands([
    {
      id: 'app.commandPalette',
      label: 'Show command palette',
      group: 'General',
      shortcut: PALETTE_SHORTCUT,
      allowInInputs: true,
      showInPalette: false,
      onAction: onPalette,
    },
    {
      id: 'app.keyboardShortcuts',
      label: 'Show keyboard shortcuts',
      group: 'General',
      keywords: ['help', 'keys', 'cheat sheet'],
      shortcut: CHEAT_SHEET_SHORTCUT,
      onAction: onCheatSheet,
    },
  ]);
  return null;
}

