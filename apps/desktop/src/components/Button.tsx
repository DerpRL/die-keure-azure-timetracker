import { useCallback, type ReactNode } from 'react';
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import { formatKeyCombo, type KeyCombo } from '../shortcuts/keys';
import { usePlatform } from '../shortcuts/platform';
import { cx } from '../utils/cx';
import { SpinnerIcon, type IconComponent } from './icons';
import { KeyboardShortcut } from './KeyboardShortcut';
import { Tooltip } from './Tooltip';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'destructive';
export type ButtonSize = 'small' | 'medium' | 'large';

interface SharedButtonProps extends Omit<AriaButtonProps, 'className' | 'children' | 'style'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Exposed as `aria-keyshortcuts`; buttons show it as a hint when `showShortcut` is set. */
  shortcut?: KeyCombo;
  className?: string;
}

export interface ButtonProps extends SharedButtonProps {
  /** Visible label. */
  children: ReactNode;
  icon?: IconComponent;
  trailingIcon?: IconComponent;
  showShortcut?: boolean;
  fullWidth?: boolean;
}

/**
 * React Aria's Button filters unknown DOM props, so `aria-keyshortcuts` is written through a ref.
 */
function useShortcutAttribute(shortcut: KeyCombo | undefined): (element: HTMLButtonElement | null) => void {
  const platform = usePlatform();
  const value = shortcut ? formatKeyCombo(shortcut, platform).aria : undefined;
  return useCallback(
    (element: HTMLButtonElement | null) => {
      if (!element) return;
      if (value) element.setAttribute('aria-keyshortcuts', value);
      else element.removeAttribute('aria-keyshortcuts');
    },
    [value],
  );
}

/** Text button. Primary is the dark-teal filled action; destructive is reserved for irreversible ones. */
export function Button({
  variant = 'secondary',
  size = 'medium',
  icon: Icon,
  trailingIcon: TrailingIcon,
  shortcut,
  showShortcut = false,
  fullWidth = false,
  isPending,
  className,
  children,
  ...props
}: ButtonProps) {
  const keyshortcuts = useShortcutAttribute(shortcut);
  return (
    <AriaButton
      {...props}
      ref={keyshortcuts}
      isPending={isPending}
      className={cx(styles.button, styles[variant], styles[size], fullWidth && styles.fullWidth, className)}
    >
      {isPending ? <SpinnerIcon className={styles.spinner} /> : Icon ? <Icon className={styles.icon} /> : null}
      <span className={styles.label}>{children}</span>
      {TrailingIcon ? <TrailingIcon className={styles.icon} /> : null}
      {showShortcut && shortcut ? <KeyboardShortcut shortcut={shortcut} decorative className={styles.shortcut} /> : null}
    </AriaButton>
  );
}

export interface IconButtonProps extends SharedButtonProps {
  /** Accessible name. Required: an icon alone has no name. */
  label: string;
  icon: IconComponent;
  /** Shows the label (and shortcut) as a tooltip on hover and keyboard focus. Default true. */
  tooltip?: boolean;
}

/** Icon-only button with a required accessible label and a larger hit area. */
export function IconButton({
  label,
  icon: Icon,
  variant = 'plain',
  size = 'medium',
  shortcut,
  tooltip = true,
  isPending,
  className,
  ...props
}: IconButtonProps) {
  const keyshortcuts = useShortcutAttribute(shortcut);
  const button = (
    <AriaButton
      {...props}
      ref={keyshortcuts}
      isPending={isPending}
      aria-label={label}
      className={cx(styles.button, styles.iconOnly, styles[variant], styles[size], className)}
    >
      {isPending ? <SpinnerIcon className={styles.spinner} /> : <Icon className={styles.icon} />}
    </AriaButton>
  );
  if (!tooltip) return button;
  return (
    <Tooltip
      content={
        <>
          {label}
          {shortcut ? <KeyboardShortcut shortcut={shortcut} className={styles.tooltipShortcut} /> : null}
        </>
      }
    >
      {button}
    </Tooltip>
  );
}
