import { useCallback, useRef, type ReactNode } from 'react';
import {
  Button as AriaButton,
  ComboBox as AriaComboBox,
  Group,
  Input,
  ListBox,
  ListBoxItem,
  Popover as AriaPopover,
  Select as AriaSelect,
  SelectValue,
  Text,
  useAsyncList,
  type ComboBoxProps as AriaComboBoxProps,
  type Key,
  type ListBoxItemProps,
  type SelectProps as AriaSelectProps,
  type ValidationResult,
} from 'react-aria-components';
import { cx } from '../utils/cx';
import { FieldDescription, FieldErrorMessage, FieldLabel } from './Fields';
import { CheckIcon, ChevronDownIcon, SpinnerIcon } from './icons';
import { popoverClassNames } from './Popover';
import styles from './Pickers.module.css';

export interface PickerOption {
  id: Key;
  label: string;
  description?: string;
  isDisabled?: boolean;
}

interface PickerChromeProps {
  label: string;
  hideLabel?: boolean;
  description?: ReactNode;
  errorMessage?: string | ((validation: ValidationResult) => string);
  width?: 'auto' | 'full' | 'narrow';
  className?: string;
}

/** Option row shared by Select and ComboBox: label, optional description, checkmark when selected. */
export function PickerItem({ children, description, ...props }: ListBoxItemProps & { description?: string; children: ReactNode }) {
  const textValue = props.textValue ?? (typeof children === 'string' ? children : undefined);
  return (
    <ListBoxItem {...props} textValue={textValue} className={styles.item}>
      {({ isSelected }) => (
        <>
          <span className={styles.itemText}>
            <Text slot="label" className={styles.itemLabel}>
              {children}
            </Text>
            {description ? (
              <Text slot="description" className={styles.itemDescription}>
                {description}
              </Text>
            ) : null}
          </span>
          {isSelected ? <CheckIcon className={styles.check} /> : null}
        </>
      )}
    </ListBoxItem>
  );
}

export interface SelectProps<T extends PickerOption>
  extends PickerChromeProps,
    Omit<AriaSelectProps<T>, 'className' | 'style' | 'children' | 'items'> {
  items: Iterable<T>;
  placeholder?: string;
}

export function Select<T extends PickerOption>({
  label,
  hideLabel,
  description,
  errorMessage,
  width = 'full',
  items,
  placeholder = 'Choose…',
  className,
  ...props
}: SelectProps<T>) {
  return (
    <AriaSelect {...props} placeholder={placeholder} className={cx(styles.field, styles[`width-${width}`], className)}>
      <FieldLabel hidden={hideLabel}>{label}</FieldLabel>
      <AriaButton className={styles.trigger}>
        <SelectValue className={styles.value} />
        <ChevronDownIcon className={styles.chevron} />
      </AriaButton>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
      <AriaPopover className={cx(popoverClassNames.popover, popoverClassNames.listPopover)}>
        <ListBox items={items} className={styles.listBox}>
          {(item) => (
            <PickerItem id={item.id} description={item.description} isDisabled={item.isDisabled} textValue={item.label}>
              {item.label}
            </PickerItem>
          )}
        </ListBox>
      </AriaPopover>
    </AriaSelect>
  );
}

export interface ComboBoxProps<T extends object>
  extends PickerChromeProps,
    Omit<AriaComboBoxProps<T>, 'className' | 'style' | 'children'> {
  children: (item: T) => ReactNode;
  placeholder?: string;
  /** Shown in the popover when nothing matches. */
  emptyMessage?: ReactNode;
  /** Shows a spinner in the field while results load. */
  isLoading?: boolean;
}

/** Text field with a filterable list. Use `AsyncComboBox` for server-backed search. */
export function ComboBox<T extends object>({
  label,
  hideLabel,
  description,
  errorMessage,
  width = 'full',
  children,
  placeholder,
  emptyMessage = 'No matches',
  isLoading = false,
  className,
  ...props
}: ComboBoxProps<T>) {
  return (
    // `allowsEmptyCollection` keeps the popover open to show "no matches" or a search error.
    <AriaComboBox {...props} allowsEmptyCollection className={cx(styles.field, styles[`width-${width}`], className)}>
      <FieldLabel hidden={hideLabel}>{label}</FieldLabel>
      <Group className={styles.comboGroup}>
        <Input placeholder={placeholder} className={styles.comboInput} />
        {isLoading ? <SpinnerIcon className={styles.spinner} /> : null}
        <AriaButton className={styles.comboButton} aria-label="Show suggestions">
          <ChevronDownIcon />
        </AriaButton>
      </Group>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldErrorMessage>{errorMessage}</FieldErrorMessage>
      <AriaPopover className={cx(popoverClassNames.popover, popoverClassNames.listPopover)}>
        <ListBox
          className={styles.listBox}
          renderEmptyState={() => <p className={styles.empty}>{isLoading ? 'Searching…' : emptyMessage}</p>}
        >
          {children}
        </ListBox>
      </AriaPopover>
    </AriaComboBox>
  );
}

export interface AsyncComboBoxProps<T extends { id: Key }> extends PickerChromeProps {
  /** Loads matches for the typed text. Abort when `signal` fires (a newer query superseded it). */
  load: (query: string, signal: AbortSignal) => Promise<T[]>;
  getLabel: (item: T) => string;
  renderItem?: (item: T) => ReactNode;
  getDescription?: (item: T) => string | undefined;
  selectedKey?: Key | null;
  onSelectionChange?: (item: T | null) => void;
  placeholder?: string;
  /** Wait this long after the last keystroke before searching. */
  debounceMs?: number;
  emptyMessage?: ReactNode;
  errorText?: ReactNode;
  /** Open the list on focus (quick switch shows recents before typing). */
  menuTrigger?: 'focus' | 'input' | 'manual';
  autoFocus?: boolean;
  isDisabled?: boolean;
  allowsCustomValue?: boolean;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Server-backed search (ticket search). Results load as you type, debounced; superseded requests
 * are aborted, so a slow early response never replaces a newer one.
 */
export function AsyncComboBox<T extends { id: Key }>({
  load,
  getLabel,
  renderItem,
  getDescription,
  selectedKey,
  onSelectionChange,
  debounceMs = 200,
  emptyMessage = 'No matching results',
  errorText = 'Search failed. Try again.',
  menuTrigger = 'input',
  ...props
}: AsyncComboBoxProps<T>) {
  const itemsById = useRef(new Map<Key, T>());
  const list = useAsyncList<T>({
    async load({ signal, filterText }) {
      await delay(debounceMs, signal);
      const items = await load(filterText ?? '', signal);
      for (const item of items) itemsById.current.set(item.id, item);
      return { items };
    },
  });
  const failed = list.loadingState === 'error';
  const loading = list.loadingState === 'loading' || list.loadingState === 'filtering';

  const handleSelection = useCallback(
    (key: Key | null) => {
      onSelectionChange?.(key === null ? null : (itemsById.current.get(key) ?? null));
    },
    [onSelectionChange],
  );

  return (
    <ComboBox<T>
      {...props}
      items={list.items}
      inputValue={list.filterText}
      onInputChange={(text) => list.setFilterText(text)}
      selectedKey={selectedKey}
      onSelectionChange={handleSelection}
      menuTrigger={menuTrigger}
      isLoading={loading}
      emptyMessage={failed ? errorText : emptyMessage}
    >
      {(item) => (
        <PickerItem id={item.id} textValue={getLabel(item)} description={getDescription?.(item)}>
          {renderItem ? renderItem(item) : getLabel(item)}
        </PickerItem>
      )}
    </ComboBox>
  );
}
