import { useId, type ReactNode } from 'react';
import { useKeyboard, type KeyboardEvents } from 'react-aria';
import { Dialog as AriaDialog, Modal, ModalOverlay } from 'react-aria-components';
import { cx } from '../utils/cx';
import { Button } from './Button';
import styles from './Dialog.module.css';

export interface DialogAction {
  label: string;
  onAction: () => void;
  isDisabled?: boolean;
  isPending?: boolean;
  variant?: 'primary' | 'destructive';
}

export interface DialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  /** Short explanation under the title, linked as the dialog's description. */
  description?: ReactNode;
  children?: ReactNode;
  /** The default action: its button is filled and Return triggers it. */
  primaryAction?: DialogAction;
  /** Additional footer buttons, placed before Cancel. */
  secondaryActions?: ReactNode;
  /** Label of the cancel button; `null` removes it (Escape still cancels). */
  cancelLabel?: string | null;
  /** Called when the dialog is cancelled: Escape, the cancel button, or an outside click. */
  onCancel?: () => void;
  /** Allows closing with a click outside. Off by default, like macOS sheets. */
  isDismissable?: boolean;
  /** `sheet` attaches to the top edge like a macOS sheet; `dialog` is centred. */
  presentation?: 'dialog' | 'sheet';
  size?: 'small' | 'medium' | 'large';
  role?: 'dialog' | 'alertdialog';
  className?: string;
}

type KeyboardEvent = Parameters<NonNullable<KeyboardEvents['onKeyDown']>>[0];

/** Elements that use Return themselves; Return there must not trigger the default action. */
const HANDLES_RETURN = 'button, a[href], textarea, select, summary, [role="button"], [role="link"], [role="option"], [role="menuitem"], [role="tab"], [aria-expanded="true"], [data-return-handled]';

function returnTriggersDefault(event: KeyboardEvent): boolean {
  if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.altKey || event.shiftKey) return false;
  if (event.isDefaultPrevented()) return false;
  const target = event.target;
  return !(target instanceof Element && target.closest(HANDLES_RETURN));
}

/**
 * Modal dialog. Focus moves inside, is trapped while open and returns to the trigger on close.
 * Escape cancels; Return triggers the primary action unless a control handles Return itself.
 */
export function Dialog({
  isOpen,
  onOpenChange,
  title,
  description,
  children,
  primaryAction,
  secondaryActions,
  cancelLabel = 'Cancel',
  onCancel,
  isDismissable = false,
  presentation = 'dialog',
  size = 'medium',
  role = 'dialog',
  className,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  const cancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) cancel();
    else onOpenChange(true);
  };

  // React Aria controls stop propagation of the keys they handle, so Return only reaches this
  // handler when nothing inside used it. Every other key keeps propagating (Escape must reach
  // the modal overlay to cancel).
  const { keyboardProps } = useKeyboard({
    onKeyDown(event) {
      const action = primaryAction;
      if (!action || action.isDisabled || action.isPending || !returnTriggersDefault(event)) {
        event.continuePropagation();
        return;
      }
      event.preventDefault();
      action.onAction();
    },
  });

  const hasFooter = Boolean(primaryAction || secondaryActions || cancelLabel);

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      isDismissable={isDismissable}
      className={cx(styles.overlay, styles[`overlay-${presentation}`])}
    >
      <Modal className={cx(styles.modal, styles[`present-${presentation}`], styles[size], className)}>
        <AriaDialog
          role={role}
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          className={styles.dialog}
        >
          <div {...keyboardProps} className={styles.content}>
          <header className={styles.header}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {description ? (
              <div id={descriptionId} className={styles.description}>
                {description}
              </div>
            ) : null}
          </header>
          {children ? <div className={styles.body}>{children}</div> : null}
          {hasFooter ? (
            <footer className={styles.footer}>
              {secondaryActions ? <div className={styles.secondary}>{secondaryActions}</div> : null}
              <div className={styles.primaryGroup}>
                {cancelLabel ? <Button onPress={cancel}>{cancelLabel}</Button> : null}
                {primaryAction ? (
                  <Button
                    variant={primaryAction.variant ?? 'primary'}
                    onPress={primaryAction.onAction}
                    isDisabled={primaryAction.isDisabled}
                    isPending={primaryAction.isPending}
                  >
                    {primaryAction.label}
                  </Button>
                ) : null}
              </div>
            </footer>
          ) : null}
          </div>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

/** A dialog presented as a sheet attached to the window's top edge. */
export function Sheet(props: Omit<DialogProps, 'presentation'>) {
  return <Dialog {...props} presentation="sheet" />;
}
