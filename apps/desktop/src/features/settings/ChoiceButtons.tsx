import { ToggleButton, ToggleButtonGroup, type Key } from 'react-aria-components';
import { cx } from '../../utils/cx';
import styles from './settings.module.css';

export interface ChoiceButton<K extends Key> {
  id: K;
  label: string;
  /** The full name for screen readers when `label` is short ("Mon" → "Monday"). */
  accessibleLabel?: string;
}

interface ChoiceButtonsProps<K extends Key> {
  /** The group's accessible name. */
  label: string;
  items: ReadonlyArray<ChoiceButton<K>>;
  selected: ReadonlySet<K>;
  onChange: (selected: Set<K>) => void;
  /** `single`: at most one is pressed (presets); `multiple`: any number (days). */
  selectionMode: 'single' | 'multiple';
  className?: string;
}

/**
 * A row of toggle buttons (design "dp"): review days, target presets. Arrow keys move between
 * them; Space or Enter presses one.
 */
export function ChoiceButtons<K extends Key>({ label, items, selected, onChange, selectionMode, className }: ChoiceButtonsProps<K>) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode={selectionMode}
      selectedKeys={selected}
      disallowEmptySelection={false}
      onSelectionChange={(keys) => onChange(new Set(keys as Set<K>))}
      className={cx(styles.choices, className)}
    >
      {items.map((item) => (
        <ToggleButton key={String(item.id)} id={item.id} aria-label={item.accessibleLabel} className={styles.choice}>
          {item.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
