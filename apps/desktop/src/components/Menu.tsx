import type { ReactNode } from 'react';
import {
  Header,
  Menu as AriaMenu,
  MenuItem as AriaMenuItem,
  MenuSection as AriaMenuSection,
  MenuTrigger,
  Popover as AriaPopover,
  Separator,
  Text,
  type Key,
  type MenuItemProps as AriaMenuItemProps,
  type MenuProps as AriaMenuProps,
  type MenuTriggerProps,
} from 'react-aria-components';
import type { KeyCombo } from '../shortcuts/keys';
import { cx } from '../utils/cx';
import { Button, IconButton, type ButtonVariant } from './Button';
import { CheckIcon, MoreIcon, type IconComponent } from './icons';
import { KeyboardShortcut } from './KeyboardShortcut';
import { popoverClassNames } from './Popover';
import styles from './Menu.module.css';

export { MenuTrigger };

export function Menu<T extends object>({ className, ...props }: AriaMenuProps<T>) {
  return <AriaMenu {...props} className={cx(styles.menu, typeof className === 'string' ? className : undefined)} />;
}

/** The popover that hosts a `Menu` inside a `MenuTrigger`. */
export function MenuPopover({ children, placement = 'bottom start' }: { children: ReactNode; placement?: 'bottom start' | 'bottom end' | 'top start' | 'top end' }) {
  return (
    <AriaPopover placement={placement} className={cx(popoverClassNames.popover, popoverClassNames.listPopover)}>
      {children}
    </AriaPopover>
  );
}

export interface MenuItemProps extends Omit<AriaMenuItemProps, 'children' | 'className' | 'style'> {
  children: ReactNode;
  description?: string;
  icon?: IconComponent;
  shortcut?: KeyCombo;
  isDestructive?: boolean;
}

export function MenuItem({ children, description, icon: Icon, shortcut, isDestructive, ...props }: MenuItemProps) {
  const textValue = props.textValue ?? (typeof children === 'string' ? children : undefined);
  return (
    <AriaMenuItem {...props} textValue={textValue} className={cx(styles.item, isDestructive && styles.destructive)}>
      {({ isSelected }) => (
        <>
          {Icon ? <Icon className={styles.icon} /> : null}
          <span className={styles.text}>
            <Text slot="label">{children}</Text>
            {description ? (
              <Text slot="description" className={styles.description}>
                {description}
              </Text>
            ) : null}
          </span>
          {isSelected ? <CheckIcon className={styles.check} /> : null}
          {shortcut ? <KeyboardShortcut shortcut={shortcut} decorative className={styles.shortcut} /> : null}
        </>
      )}
    </AriaMenuItem>
  );
}

export function MenuSection<T extends object>({ title, children }: { title?: string; children: ReactNode | ((item: T) => ReactNode) }) {
  return (
    <AriaMenuSection className={styles.section}>
      {title ? <Header className={styles.sectionHeader}>{title}</Header> : null}
      {children as ReactNode}
    </AriaMenuSection>
  );
}

export function MenuSeparator() {
  return <Separator className={styles.separator} />;
}

export interface MenuButtonItem {
  id: Key;
  label: string;
  description?: string;
  icon?: IconComponent;
  shortcut?: KeyCombo;
  isDisabled?: boolean;
  isDestructive?: boolean;
}

export interface MenuButtonProps extends Omit<MenuTriggerProps, 'children'> {
  /** Visible label, or the accessible label of an icon-only trigger. */
  label: string;
  /** Icon-only trigger when set without `showLabel`. */
  icon?: IconComponent;
  showLabel?: boolean;
  variant?: ButtonVariant;
  items: ReadonlyArray<MenuButtonItem>;
  onAction: (id: Key) => void;
  placement?: 'bottom start' | 'bottom end';
}

/** Convenience: a trigger button with a flat list of actions. */
export function MenuButton({
  label,
  icon = MoreIcon,
  showLabel = false,
  variant = 'secondary',
  items,
  onAction,
  placement = 'bottom end',
  ...props
}: MenuButtonProps) {
  const disabledKeys = items.filter((item) => item.isDisabled).map((item) => item.id);
  return (
    <MenuTrigger {...props}>
      {showLabel ? (
        <Button variant={variant} icon={icon}>
          {label}
        </Button>
      ) : (
        <IconButton label={label} icon={icon} variant={variant === 'secondary' ? 'plain' : variant} tooltip={false} />
      )}
      <MenuPopover placement={placement}>
        <Menu items={items} disabledKeys={disabledKeys} onAction={(key) => onAction(key)}>
          {(item) => (
            <MenuItem
              id={item.id}
              icon={item.icon}
              description={item.description}
              shortcut={item.shortcut}
              isDestructive={item.isDestructive}
              textValue={item.label}
            >
              {item.label}
            </MenuItem>
          )}
        </Menu>
      </MenuPopover>
    </MenuTrigger>
  );
}
