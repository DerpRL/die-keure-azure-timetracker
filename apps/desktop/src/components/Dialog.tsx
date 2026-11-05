import { useId, type ReactNode } from 'react';
import { useKeyboard, type KeyboardEvents } from 'react-aria';
import { Dialog as AriaDialog, Modal, ModalOverlay } from 'react-aria-components';
import { cx } from '../utils/cx';
import { Button, IconButton } from './Button';
import { CloseIcon } from './icons';
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
  /** Above the title: status chips, the ticket number. */
  eyebrow?: ReactNode;
  /** Under the description, still in the header: facts about the subject (a `dl`). */
  headerContent?: ReactNode;
  /** A larger title (ticket details). */
  titleSize?: 'default' | 'large';
  /** An × button in the header that cancels, besides the footer's cancel button. */
  showCloseButton?: boolean;
  children?: ReactNode;
  /** The default action: its button is filled and Return triggers it. */
  primaryAction?: DialogAction;
  /** Additional footer buttons on the leading side. */
  secondaryActions?: ReactNode;
  /** Buttons next to Cancel and the primary action, on the trailing side. */
  footerExtra?: ReactNode;
  /** Label of the cancel button; `null` removes it (Escape still cancels). */
  cancelLabel?: string | null;
  /** Called when the dialog is cancelled: Escape, the cancel button, or an outside click. */
  onCancel?: () => void;
  /** Allows closing with a click outside. Off by default, like macOS sheets. */
  isDismissable?: boolean;
  /**
   * `dialog` is centred in the window; `drawer` is a full-height panel on the right (ticket
   * picker, ticket details), with a tinted footer.
   */
  presentation?: 'dialog' | 'drawer';
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
  eyebrow,
  headerContent,
  titleSize = 'default',
  showCloseButton = false,
  children,
  primaryAction,
  secondaryActions,
  footerExtra,
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

  const hasFooter = Boolean(primaryAction || secondaryActions || footerExtra || cancelLabel);

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
          <header className={cx(styles.header, headerContent ? styles.headerRich : undefined)}>
            {eyebrow || showCloseButton ? (
              <div className={styles.headerTop}>
                {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : <span />}
                {showCloseButton ? <IconButton label="Close" icon={CloseIcon} size="small" variant="secondary" tooltip={false} onPress={cancel} /> : null}
              </div>
            ) : null}
            <h2 id={titleId} className={cx(styles.title, titleSize === 'large' && styles.titleLarge)}>
              {title}
            </h2>
            {description ? (
              <div id={descriptionId} className={styles.description}>
                {description}
              </div>
            ) : null}
            {headerContent}
          </header>
          {children ? <div className={styles.body}>{children}</div> : null}
          {hasFooter ? (
            <footer className={styles.footer}>
              {secondaryActions ? <div className={styles.secondary}>{secondaryActions}</div> : null}
              <div className={styles.primaryGroup}>
                {footerExtra}
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
