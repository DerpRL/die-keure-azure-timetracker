import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Autocomplete,
  Collection,
  Dialog,
  Header,
  Input,
  Menu,
  MenuItem,
  MenuSection,
  Modal,
  ModalOverlay,
  SearchField,
  Text,
  useFilter,
  type Key,
} from 'react-aria-components';
import { KeyboardShortcut } from '../components/KeyboardShortcut';
import { SearchIcon } from '../components/icons';
import { useRegisteredCommands } from './hooks';
import { usePlatform } from './platform';
import { PALETTE_GROUP_ORDER, PALETTE_GROUP_TITLES, type Command, type CommandGroup } from './store';
import styles from './CommandPalette.module.css';

export interface CommandPaletteProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

interface PaletteSection {
  id: CommandGroup;
  commands: Command[];
}

function Hint({ keys, label }: { keys: readonly string[]; label: string }) {
  return (
    <span className={styles.hint}>
      <span aria-hidden="true" className={styles.hintKeys}>
        {keys.map((key) => (
          <kbd key={key} className={styles.kbd}>
            {key}
          </kbd>
        ))}
      </span>
      {label}
    </span>
  );
}

/**
 * Searchable list of tickets, actions and places (2.2 layout "S5 · Command palette"). Return runs
 * the highlighted entry; ⌘Return (Ctrl+Return) runs its alternate, e.g. "track" on a ticket.
 */
export function CommandPalette({ isOpen, onOpenChange }: CommandPaletteProps) {
  const registered = useRegisteredCommands();
  const platform = usePlatform();
  const mod = platform === 'macos' ? '⌘' : 'Ctrl';
  const { contains } = useFilter({ sensitivity: 'base' });
  const [query, setQuery] = useState('');
  // Whether the pointer that ran an entry held ⌘ / Ctrl (MenuItem's onAction has no event).
  const modifierHeld = useRef(false);

  const { sections, byId, hasAlternates } = useMemo(() => {
    // Latest registration wins for duplicate ids, matching shortcut dispatch.
    const unique = new Map<string, Command>();
    for (const command of registered) {
      if (command.showInPalette === false || command.isDisabled) continue;
      if (command.searchOnly && !query.trim()) continue;
      unique.delete(command.id);
      unique.set(command.id, command);
    }
    const groups = new Map<CommandGroup, Command[]>();
    for (const command of unique.values()) {
      const group = command.group ?? 'Actions';
      groups.set(group, [...(groups.get(group) ?? []), command]);
    }
    return {
      byId: unique,
      hasAlternates: [...unique.values()].some((command) => command.alternate),
      sections: PALETTE_GROUP_ORDER.flatMap((id): PaletteSection[] => {
        const commands = groups.get(id);
        return commands?.length ? [{ id, commands }] : [];
      }),
    };
  }, [registered, query]);

  const filter = (textValue: string, inputValue: string, node: { key: Key }) => {
    if (contains(textValue, inputValue)) return true;
    const command = byId.get(String(node.key));
    return command?.keywords?.some((keyword) => contains(keyword, inputValue)) ?? false;
  };

  const close = (open: boolean) => {
    if (!open) setQuery('');
    onOpenChange(open);
  };

  const run = (key: Key) => {
    const command = byId.get(String(key));
    const alternate = modifierHeld.current ? command?.alternate : undefined;
    modifierHeld.current = false;
    close(false);
    // Run after the palette has closed and returned focus, so the command sees the app state.
    if (command) setTimeout(() => (alternate ?? command).onAction(), 0);
  };

  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={close} isDismissable className={styles.overlay}>
      <Modal className={styles.modal}>
        <Dialog aria-label="Command palette" className={styles.dialog}>
          <div
            className={styles.content}
            onKeyDownCapture={(event) => {
              // ⌘Return / Ctrl+Return: React Aria does not run a menu item's action with a
              // modifier held, so run the highlighted entry's alternate here.
              if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
              const key = event.currentTarget.querySelector('[role="menuitem"][data-focused]')?.getAttribute('data-key');
              const command = key ? byId.get(key) : undefined;
              if (!command) return;
              event.preventDefault();
              event.stopPropagation();
              close(false);
              setTimeout(() => (command.alternate ?? command).onAction(), 0);
            }}
            onPointerDownCapture={(event) => {
              modifierHeld.current = event.metaKey || event.ctrlKey;
            }}
          >
            <Autocomplete filter={filter} inputValue={query} onInputChange={setQuery}>
              <SearchField
                aria-label="Search pages and actions"
                autoFocus
                className={styles.search}
                // Escape closes the palette at once instead of first clearing the query.
                onKeyDown={(event) => {
                  if (event.key === 'Escape') close(false);
                  else event.continuePropagation();
                }}
              >
                <SearchIcon className={styles.searchIcon} />
                <Input placeholder="Search tickets, actions and views…" className={styles.input} />
                <kbd className={styles.kbd} aria-hidden="true">
                  esc
                </kbd>
              </SearchField>
              <Menu
                items={sections}
                onAction={run}
                className={styles.menu}
                renderEmptyState={() => <p className={styles.empty}>No matching tickets, actions or views</p>}
              >
                {(section) => (
                  <MenuSection id={section.id} className={styles.section}>
                    <Header className={styles.sectionHeader}>{PALETTE_GROUP_TITLES[section.id]}</Header>
                    <Collection items={section.commands}>
                      {(command) => {
                        const Icon = command.icon;
                        const label = command.group === 'Pages' ? `Go to ${command.label}` : command.label;
                        return (
                          <MenuItem id={command.id} textValue={command.label} className={styles.item}>
                            <span className={styles.lead} aria-hidden="true">
                              {Icon ? (
                                <Icon className={styles.icon} />
                              ) : command.swatch ? (
                                <span className={styles.swatch} style={{ '--swatch': command.swatch } as CSSProperties} />
                              ) : null}
                            </span>
                            <span className={styles.text}>
                              <Text slot="label" className={styles.label}>
                                {label}
                              </Text>
                              {command.description ? (
                                <Text slot="description" className={styles.description}>
                                  {command.description}
                                </Text>
                              ) : null}
                            </span>
                            {command.shortcut ? (
                              <KeyboardShortcut shortcut={command.shortcut} decorative className={styles.shortcut} />
                            ) : command.actionHint || command.alternate ? (
                              <span className={styles.rowHint} aria-hidden="true">
                                {command.actionHint ? <span className={styles.onlySelected}>{`↵ ${command.actionHint}`}</span> : null}
                                {command.alternate ? <span>{`${mod}↵ ${command.alternate.hint}`}</span> : null}
                              </span>
                            ) : null}
                          </MenuItem>
                        );
                      }}
                    </Collection>
                  </MenuSection>
                )}
              </Menu>
            </Autocomplete>
            <footer className={styles.footer} aria-hidden="true">
              <Hint keys={['↑', '↓']} label="Move" />
              <Hint keys={['↵']} label="Open" />
              {hasAlternates ? <Hint keys={[mod, '↵']} label="Track" /> : null}
              <span className={styles.footerEnd}>
                <Hint keys={['esc']} label="Close" />
              </span>
            </footer>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
