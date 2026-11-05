import type { IconComponent } from '../components/icons';
import type { KeyCombo } from './keys';

/** Something the user can trigger from the command palette and, optionally, a shortcut. */
export interface Command {
  id: string;
  label: string;
  /** Palette section and cheat-sheet group. */
  group?: CommandGroup;
  /** Extra search terms for the palette. */
  keywords?: readonly string[];
  shortcut?: KeyCombo;
  /** Fire while focus is in a text field. Off by default: typing never triggers shortcuts. */
  allowInInputs?: boolean;
  /** Fire while focus is inside a dialog or popover. Off by default. */
  allowInDialogs?: boolean;
  /** List in the command palette (default true). */
  showInPalette?: boolean;
  isDisabled?: boolean;
  onAction: () => void;
  /** Palette only: an icon before the label. */
  icon?: IconComponent;
  /** Palette only: a coloured square before the label (a CSS colour, e.g. a place's colour). */
  swatch?: string;
  /** Palette only: a second line under the label ("User Story · tracking now"). */
  description?: string;
  /** Palette only: what Return does, shown on the row ("details"). */
  actionHint?: string;
  /** Palette only: ⌘Return / Ctrl+Return runs this instead of `onAction` ("track"). */
  alternate?: { hint: string; onAction: () => void };
  /** Palette only: listed only while the user types (tickets would crowd the empty palette). */
  searchOnly?: boolean;
}

export type CommandGroup = 'Tickets' | 'Pages' | 'Tracking' | 'Actions' | 'General';
/** Cheat sheet order. */
export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = ['Pages', 'Tracking', 'Actions', 'General', 'Tickets'];
/** Command palette order and headings (2.2 layout: Tickets, actions, then "Go to"). */
export const PALETTE_GROUP_ORDER: readonly CommandGroup[] = ['Tickets', 'Tracking', 'Actions', 'Pages', 'General'];
export const PALETTE_GROUP_TITLES: Readonly<Record<CommandGroup, string>> = {
  Tickets: 'Tickets',
  Tracking: 'Tracking',
  Actions: 'Actions',
  Pages: 'Go to',
  General: 'General',
};

interface Entry {
  token: string;
  command: Command;
}

/**
 * Ordered registry of commands. Later registrations win when two share a shortcut, so a page can
 * override an app-wide binding while it is mounted.
 */
export class CommandStore {
  private entries: Entry[] = [];
  private cached: readonly Command[] = [];
  private readonly listeners = new Set<() => void>();

  register(token: string, command: Command): () => void {
    const index = this.entries.findIndex((entry) => entry.token === token);
    if (index >= 0) this.entries[index] = { token, command };
    else this.entries.push({ token, command });
    this.emit();
    return () => {
      this.entries = this.entries.filter((entry) => entry.token !== token);
      this.emit();
    };
  }

  /** Commands in registration order. Stable identity until something changes. */
  readonly snapshot = (): readonly Command[] => this.cached;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    this.cached = this.entries.map((entry) => entry.command);
    for (const listener of this.listeners) listener();
  }
}
