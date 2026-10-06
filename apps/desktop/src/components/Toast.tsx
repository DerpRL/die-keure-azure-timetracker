import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { mergeProps, useFocusWithin, useHover } from 'react-aria';
import { cx } from '../utils/cx';
import { announce } from './Announcer';
import { Button, IconButton } from './Button';
import { CloseIcon, ErrorIcon, InfoIcon, SuccessIcon, WarningIcon, type IconComponent } from './icons';
import styles from './Toast.module.css';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: { label: string; onAction: () => void };
  /**
   * Auto-dismiss delay in ms. Defaults to 6 s; toasts with an action or errors stay until
   * dismissed, so there is always enough time to act (WCAG 2.2.1).
   */
  timeout?: number | null;
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastApi {
  show: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastTone, IconComponent> = {
  info: InfoIcon,
  success: SuccessIcon,
  warning: WarningIcon,
  error: ErrorIcon,
};

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: number) => void }) {
  const tone = toast.tone ?? 'info';
  const Icon = ICONS[tone];
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const paused = hovered || focusWithin;
  // Hovering or focusing a toast pauses its timer, so it never disappears while being read.
  const { hoverProps } = useHover({ onHoverChange: setHovered });
  const { focusWithinProps } = useFocusWithin({ onFocusWithinChange: setFocusWithin });
  const timeout =
    toast.timeout === undefined ? (toast.action || tone === 'error' ? null : 6000) : toast.timeout;

  useEffect(() => {
    if (timeout === null || paused) return;
    const timer = setTimeout(() => onDismiss(toast.id), timeout);
    return () => clearTimeout(timer);
  }, [timeout, paused, onDismiss, toast.id]);

  return (
    <li {...mergeProps(hoverProps, focusWithinProps)} className={cx(styles.toast, styles[tone])}>
      <Icon className={styles.icon} />
      <div className={styles.content}>
        <p className={styles.title}>{toast.title}</p>
        {toast.description ? <p className={styles.description}>{toast.description}</p> : null}
        {toast.action ? (
          <div className={styles.actions}>
            <Button
              size="small"
              onPress={() => {
                toast.action?.onAction();
                onDismiss(toast.id);
              }}
            >
              {toast.action.label}
            </Button>
          </div>
        ) : null}
      </div>
      <IconButton label="Dismiss notification" icon={CloseIcon} size="small" tooltip={false} onPress={() => onDismiss(toast.id)} />
    </li>
  );
}

/**
 * Transient notifications in a labelled region. The text is announced through the polite (or,
 * for errors, assertive) live region; the visual list itself is not live, to avoid double speech.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-4), { ...options, id }]);
    announce(
      [options.title, options.description].filter(Boolean).join('. '),
      options.tone === 'error' ? 'assertive' : 'polite',
    );
    return id;
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <section aria-label="Notifications" className={cx(styles.region, toasts.length === 0 && styles.empty)}>
        {toasts.length > 0 ? (
          <ol className={styles.list}>
            {toasts.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
            ))}
          </ol>
        ) : null}
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
