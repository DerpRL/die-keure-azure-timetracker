import { useId, type ReactNode } from 'react';
import {
  Checkbox as AriaCheckbox,
  Switch as AriaSwitch,
  type CheckboxProps as AriaCheckboxProps,
  type SwitchProps as AriaSwitchProps,
} from 'react-aria-components';
import { cx } from '../utils/cx';
import { CheckIcon, MinusIcon } from './icons';
import styles from './Toggles.module.css';

export interface SwitchProps extends Omit<AriaSwitchProps, 'children' | 'className' | 'style'> {
  /** Visible label. */
  children: ReactNode;
  /** Secondary text, linked with `aria-describedby` so it is not part of the name. */
  description?: ReactNode;
  className?: string;
}

/** On/off setting that applies immediately (feature toggles, launch at login). */
export function Switch({ children, description, className, ...props }: SwitchProps) {
  const descriptionId = useId();
  return (
    <div className={cx(styles.field, className)}>
      <AriaSwitch {...props} aria-describedby={description ? descriptionId : undefined} className={styles.switch}>
        <span className={styles.track} aria-hidden="true">
          <span className={styles.thumb} />
        </span>
        <span className={styles.label}>{children}</span>
      </AriaSwitch>
      {description ? (
        <span id={descriptionId} className={cx(styles.description, styles.switchDescription)}>
          {description}
        </span>
      ) : null}
    </div>
  );
}

export interface CheckboxProps extends Omit<AriaCheckboxProps, 'children' | 'className' | 'style'> {
  /** Visible label. Omit only for table selection checkboxes, which React Aria labels itself. */
  children?: ReactNode;
  description?: ReactNode;
  className?: string;
}

export function Checkbox({ children, description, className, ...props }: CheckboxProps) {
  const descriptionId = useId();
  const box = (
    <AriaCheckbox
      {...props}
      aria-describedby={description ? descriptionId : undefined}
      className={cx(styles.checkbox, !children && styles.bare, !description && className)}
    >
      {({ isSelected, isIndeterminate }) => (
        <>
          <span className={styles.box} aria-hidden="true">
            {isIndeterminate ? <MinusIcon strokeWidth={3} /> : isSelected ? <CheckIcon strokeWidth={3} /> : null}
          </span>
          {children ? <span className={styles.label}>{children}</span> : null}
        </>
      )}
    </AriaCheckbox>
  );
  if (!description) return box;
  return (
    <div className={cx(styles.field, className)}>
      {box}
      <span id={descriptionId} className={cx(styles.description, styles.checkboxDescription)}>
        {description}
      </span>
    </div>
  );
}
