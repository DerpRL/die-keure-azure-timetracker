import { useId, type ReactNode } from 'react';
import {
  Dialog,
  DialogTrigger,
  OverlayArrow,
  Popover as AriaPopover,
  type DialogTriggerProps,
  type PopoverProps as AriaPopoverProps,
} from 'react-aria-components';
import { cx } from '../utils/cx';
import styles from './Popover.module.css';

/** Wraps a trigger (usually a Button) and a `Popover`; manages open state and focus return. */
export function PopoverTrigger(props: DialogTriggerProps) {
  return <DialogTrigger {...props} />;
}

export interface PopoverProps extends Omit<AriaPopoverProps, 'children' | 'className' | 'style'> {
  /** Heading shown at the top and used as the dialog's accessible name. */
  title?: string;
  /** Required when there is no `title`. */
  'aria-label'?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  showArrow?: boolean;
  width?: 'auto' | 'small' | 'medium' | 'large';
  className?: string;
}

/** Non-modal panel anchored to its trigger. Escape or an outside click closes it. */
export function Popover({
  title,
  'aria-label': ariaLabel,
  children,
  showArrow = false,
  width = 'medium',
  className,
  ...props
}: PopoverProps) {
  const titleId = useId();
  return (
    <AriaPopover {...props} offset={showArrow ? 10 : 6} className={cx(styles.popover, styles[`width-${width}`], className)}>
      {showArrow ? (
        <OverlayArrow className={styles.arrow}>
          <svg width={12} height={8} viewBox="0 0 12 8" aria-hidden="true">
            <path d="M0 0 L6 8 L12 0" />
          </svg>
        </OverlayArrow>
      ) : null}
      <Dialog
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        className={styles.dialog}
      >
        {({ close }) => (
          <>
            {title ? (
              <h2 id={titleId} className={styles.title}>
                {title}
              </h2>
            ) : null}
            {typeof children === 'function' ? children(close) : children}
          </>
        )}
      </Dialog>
    </AriaPopover>
  );
}

/** Class names shared with list popovers (Select, ComboBox, Menu, DatePicker). */
export const popoverClassNames = styles;
