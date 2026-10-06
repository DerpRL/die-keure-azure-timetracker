/**
 * Form drafts for values the engine owns. The field updates at once while the intent travels to
 * the engine; when the engine publishes a different value (another surface, a reload, a generated
 * report), the field follows it. These hold a copy only for the duration of an edit.
 */
import { useCallback, useState } from 'react';

interface DraftState<T> {
  source: T;
  value: T;
}

/** A value that follows `source` whenever the engine changes it, and updates locally on `set`. */
export function useEngineDraft<T>(source: T, equals: (a: T, b: T) => boolean = Object.is): [T, (next: T) => void] {
  const [state, setState] = useState<DraftState<T>>({ source, value: source });
  let current = state;
  if (!equals(state.source, source)) {
    // Adjusting state while rendering, as React documents for "previous props" (no effect pass).
    current = { source, value: source };
    setState(current);
  }
  const set = useCallback((value: T) => setState((previous) => ({ ...previous, value })), []);
  return [current.value, set];
}

interface EchoState {
  source: string;
  value: string;
  /** Values sent to the engine whose echo has not arrived yet, oldest first. */
  sent: string[];
}

/**
 * Text the user types and the engine stores (the weekly report). Echoes of what was typed are
 * ignored, so a slow round trip never moves the cursor or drops keystrokes; any other new value
 * from the engine (a generated draft, another week) replaces the field.
 */
export function useEchoDraft(source: string): [string, (next: string) => void] {
  const [state, setState] = useState<EchoState>({ source, value: source, sent: [] });
  let current = state;
  if (state.source !== source) {
    const echo = state.sent.indexOf(source);
    current =
      echo >= 0
        ? { source, value: state.value, sent: state.sent.slice(echo + 1) }
        : { source, value: source, sent: [] };
    setState(current);
  }
  const set = useCallback(
    (value: string) => setState((previous) => ({ ...previous, value, sent: [...previous.sent, value].slice(-100) })),
    [],
  );
  return [current.value, set];
}
