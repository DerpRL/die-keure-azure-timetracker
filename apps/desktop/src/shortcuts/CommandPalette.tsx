import { useMemo } from 'react';
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
import { COMMAND_GROUP_ORDER, type Command, type CommandGroup } from './store';
import styles from './CommandPalette.module.css';

export interface CommandPaletteProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

interface PaletteSection {
  id: CommandGroup;
  commands: Command[];
}

/** Searchable list of every page and registered action. Return runs the highlighted command. */
export function CommandPalette({ isOpen, onOpenChange }: CommandPaletteProps) {
  const registered = useRegisteredCommands();
  const { contains } = useFilter({ sensitivity: 'base' });

  const { sections, byId } = useMemo(() => {
    // Latest registration wins for duplicate ids, matching shortcut dispatch.
    const unique = new Map<string, Command>();
    for (const command of registered) {
      if (command.showInPalette === false || command.isDisabled) continue;
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
      sections: COMMAND_GROUP_ORDER.flatMap((id): PaletteSection[] => {
        const commands = groups.get(id);
        return commands?.length ? [{ id, commands }] : [];
      }),
    };
  }, [registered]);

  const filter = (textValue: string, inputValue: string, node: { key: Key }) => {
    if (contains(textValue, inputValue)) return true;
    const command = byId.get(String(node.key));
    return command?.keywords?.some((keyword) => contains(keyword, inputValue)) ?? false;
  };

  const run = (key: Key) => {
    const command = byId.get(String(key));
    onOpenChange(false);
    // Run after the palette has closed and returned focus, so the command sees the app state.
    if (command) setTimeout(() => command.onAction(), 0);
  };

  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={onOpenChange} isDismissable className={styles.overlay}>
      <Modal className={styles.modal}>
        <Dialog aria-label="Command palette" className={styles.dialog}>
          <Autocomplete filter={filter}>
            <SearchField
              aria-label="Search pages and actions"
              autoFocus
              className={styles.search}
              // Escape closes the palette at once instead of first clearing the query.
              onKeyDown={(event) => {
                if (event.key === 'Escape') onOpenChange(false);
                else event.continuePropagation();
              }}
            >
              <SearchIcon className={styles.searchIcon} />
              <Input placeholder="Search pages and actions…" className={styles.input} />
            </SearchField>
            <Menu
              items={sections}
              onAction={run}
              className={styles.menu}
              renderEmptyState={() => <p className={styles.empty}>No matching pages or actions</p>}
            >
              {(section) => (
                <MenuSection id={section.id} className={styles.section}>
                  <Header className={styles.sectionHeader}>{section.id}</Header>
                  <Collection items={section.commands}>
                    {(command) => (
                      <MenuItem id={command.id} textValue={command.label} className={styles.item}>
                        <Text slot="label" className={styles.label}>
                          {command.group === 'Pages' ? `Go to ${command.label}` : command.label}
                        </Text>
                        {command.shortcut ? (
                          <KeyboardShortcut shortcut={command.shortcut} decorative className={styles.shortcut} />
                        ) : null}
                      </MenuItem>
                    )}
                  </Collection>
                </MenuSection>
              )}
            </Menu>
          </Autocomplete>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
