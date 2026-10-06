import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import type { IpcError } from '../../ipc';
import type { Intent } from '../../ipc/contract';
import { ipcErrorKind, useAction, useSlice } from '../../state/hooks';
import styles from './tracking.module.css';

/** What the tracking controls need to know before they write (Swift `busy`, `connected`, `preview`). */
export interface WriteGuards {
  /** A 7pace or Azure write is in flight (`app.busy`): writes are disabled. */
  busy: boolean;
  /** 7pace is reachable. */
  connected: boolean;
  /** The 7pace timer is confirmed (health `confirmed`). */
  confirmed: boolean;
  preview: boolean;
  running: boolean;
}

export function useWriteGuards(): WriteGuards {
  const app = useSlice('app');
  const connection = useSlice('connection');
  const tracking = useSlice('tracking');
  return {
    busy: app?.busy ?? false,
    connected: connection?.connected ?? false,
    confirmed: connection?.health === 'confirmed',
    preview: app?.preview ?? false,
    running: tracking?.running ?? false,
  };
}

/** The intent again, marked as confirmed by the user (see the contract requests). */
function confirmed(intent: Intent): Intent {
  return Object.assign({}, intent, { confirmed: true });
}

interface PendingConfirmation {
  key: string;
  message: string;
  intents: Intent[];
}

export interface IntentRunner {
  /**
   * Sends `intents` in order and stops at the first refusal. `key` names the pressed control so
   * only that button shows a spinner. Resolves to true when every intent was accepted.
   */
  run: (key: string, ...intents: Intent[]) => Promise<boolean>;
  /** Something from this runner is in flight (any key, or the given one). */
  isPending: (key?: string) => boolean;
  /** The last refusal, shown verbatim; `needsConfirmation` refusals open the dialog instead. */
  error: IpcError | null;
  clearError: () => void;
  /** Render once next to the controls: asks before resending a `needsConfirmation` refusal. */
  confirmation: ReactNode;
}

/**
 * Runs intents for one group of controls (a prompt card, the tracking card, the chooser). The
 * engine decides; the UI only shows its pending state, its message and, when the engine asks for
 * it, a confirmation before resending.
 */
export function useIntents(): IntentRunner {
  const action = useAction();
  const { run: dispatchIntent, clearError } = action;
  const [pressed, setPressed] = useState<string | null>(null);
  const [ask, setAsk] = useState<PendingConfirmation | null>(null);
  const inFlight = useRef(0);

  const sequence = useCallback(
    async (key: string, intents: Intent[]): Promise<boolean> => {
      inFlight.current += 1;
      setPressed(key);
      try {
        for (let index = 0; index < intents.length; index++) {
          const intent = intents[index]!;
          const result = await dispatchIntent(intent);
          if (result.ok) continue;
          if (ipcErrorKind(result.error) === 'needsConfirmation') {
            setAsk({ key, message: result.error.message, intents: intents.slice(index) });
          }
          return false;
        }
        return true;
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) setPressed(null);
      }
    },
    [dispatchIntent],
  );

  const run = useCallback((key: string, ...intents: Intent[]) => sequence(key, intents), [sequence]);

  const confirm = useCallback(() => {
    if (!ask) return;
    const [first, ...rest] = ask.intents;
    setAsk(null);
    if (first) void sequence(ask.key, [confirmed(first), ...rest]);
  }, [ask, sequence]);

  const isPending = useCallback(
    (key?: string) => action.pending && (key === undefined || pressed === key),
    [action.pending, pressed],
  );

  const error = action.errorKind === 'needsConfirmation' ? null : action.error;

  const confirmation = (
    <Dialog
      isOpen={ask !== null}
      onOpenChange={(open) => {
        if (!open) setAsk(null);
      }}
      role="alertdialog"
      size="small"
      title="Confirm this change"
      description={ask?.message}
      primaryAction={{ label: 'Continue', onAction: confirm }}
    />
  );

  return { run, isPending, error, clearError, confirmation };
}

/** An engine refusal, verbatim, next to the controls that caused it. */
export function ActionError({ error, className }: { error: IpcError | null; className?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={className ?? styles.actionError}>
      {error.message}
    </p>
  );
}
