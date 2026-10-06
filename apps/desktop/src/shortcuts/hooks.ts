import { createContext, useContext, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { CommandStore, Command } from './store';

export interface ShortcutContextValue {
  store: CommandStore;
  openPalette: () => void;
  openCheatSheet: () => void;
}

export const ShortcutContext = createContext<ShortcutContextValue | null>(null);

function useShortcutContext(): ShortcutContextValue {
  const context = useContext(ShortcutContext);
  if (!context) throw new Error('Shortcut hooks must be used inside <ShortcutProvider>');
  return context;
}

const EMPTY: readonly Command[] = [];
const noSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

/** Every registered command, in registration order (palette and cheat sheet use this). */
export function useRegisteredCommands(): readonly Command[] {
  const context = useContext(ShortcutContext);
  return useSyncExternalStore(
    context?.store.subscribe ?? noSubscribe,
    context?.store.snapshot ?? emptySnapshot,
    context?.store.snapshot ?? emptySnapshot,
  );
}

export function useShortcutUi(): { openPalette: () => void; openCheatSheet: () => void } {
  const { openPalette, openCheatSheet } = useShortcutContext();
  return { openPalette, openCheatSheet };
}

function signature(command: Command): string {
  // Everything but the handler; JSON.stringify drops the undefined onAction.
  return JSON.stringify({ ...command, onAction: undefined });
}

/**
 * Registers commands while the calling component is mounted. Handlers may change on every render;
 * the registry always calls the latest one.
 */
export function useCommands(commands: readonly Command[]): void {
  // Without a provider (isolated component tests, the gallery) registration is a no-op.
  const store = useContext(ShortcutContext)?.store;
  const baseToken = useId();
  const handlers = useRef(new Map<string, () => void>());
  const key = commands.map(signature).join('\n');

  useLayoutEffect(() => {
    handlers.current = new Map(commands.map((command) => [command.id, command.onAction]));
  });

  useLayoutEffect(() => {
    if (!store) return;
    const parsed = commands.map((command, index) => ({ command, token: `${baseToken}:${index}` }));
    const cleanups = parsed.map(({ command, token }) =>
      store.register(token, {
        ...command,
        onAction: () => handlers.current.get(command.id)?.(),
      }),
    );
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
    // `key` captures every field except the handlers, which are read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, baseToken, key]);
}

export function useCommand(command: Command): void {
  useCommands([command]);
}

export interface ShortcutHookOptions {
  isDisabled?: boolean;
  label?: string;
}

/** ⌘S / Ctrl+S, including while typing in a field (Settings → Save changes). */
export function useSaveShortcut(onSave: () => void, { isDisabled, label = 'Save changes' }: ShortcutHookOptions = {}): void {
  useCommand({
    id: 'app.save',
    label,
    group: 'Actions',
    shortcut: { key: 's', mod: true },
    allowInInputs: true,
    isDisabled,
    onAction: onSave,
  });
}

/** ⌘R / Ctrl+R; also stops the web view from reloading the page. */
export function useRefreshShortcut(onRefresh: () => void, { isDisabled, label = 'Refresh' }: ShortcutHookOptions = {}): void {
  useCommand({
    id: 'app.refresh',
    label,
    group: 'Actions',
    shortcut: { key: 'r', mod: true },
    allowInInputs: true,
    isDisabled,
    onAction: onRefresh,
  });
}

/** Shortcut digit for the n-th visible page: 1…9, then 0; later pages get none. */
export function pageShortcutDigit(index: number): string | null {
  if (index < 0 || index > 9) return null;
  return index === 9 ? '0' : String(index + 1);
}

/**
 * ⌘1…⌘9, ⌘0 (Ctrl on Windows) in the visible sidebar order, plus a palette entry per page.
 * Fixes 1.14, where hidden or unordered pages shared numbers.
 */
export function usePageCommands<Id extends string>(
  pages: ReadonlyArray<{ id: Id; title: string }>,
  onNavigate: (id: Id) => void,
): void {
  useCommands(
    pages.map((page, index) => {
      const digit = pageShortcutDigit(index);
      return {
        id: `page.${page.id}`,
        label: page.title,
        group: 'Pages' as const,
        keywords: ['go to', 'open', 'page'],
        shortcut: digit ? { key: digit, mod: true } : undefined,
        allowInInputs: true,
        onAction: () => onNavigate(page.id),
      };
    }),
  );
}
