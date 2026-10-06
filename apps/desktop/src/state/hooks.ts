/**
 * React access to the engine: `useSlice` subscribes to one slice, `useAction` runs intents with
 * pending and error state, `useLiveSeconds` turns `elapsedBase + confirmedAt` into a ticking
 * clock without the engine publishing every second.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IpcError } from '../ipc';
import type { Intent, IntentResult, SliceMap, SliceName, WorkItem } from '../ipc/contract';
import { dispatch } from '../ipc/engine';
import { store as defaultStore, type SliceStore } from './store';

export const StoreContext = createContext<SliceStore>(defaultStore);

export function useStore(): SliceStore {
  return useContext(StoreContext);
}

/** The latest value of one slice, `undefined` until it first arrives. */
export function useSlice<K extends SliceName>(name: K): SliceMap[K] | undefined {
  const target = useStore();
  const subscribe = useCallback((listener: () => void) => target.subscribe(name, listener), [target, name]);
  const read = useCallback(() => target.get(name), [target, name]);
  return useSyncExternalStore(subscribe, read, read);
}

/** A ticket from the shared title cache (`workItems` slice). */
export function useWorkItem(id: number | null | undefined): WorkItem | undefined {
  const items = useSlice('workItems');
  return id === null || id === undefined ? undefined : items?.[String(id)];
}

export type ActionResult<T extends Intent['type']> =
  | { ok: true; value: IntentResult<T> }
  | { ok: false; error: IpcError };

/** The `{ kind, message }` of a rejected intent, whatever produced it. */
export function ipcErrorKind(error: unknown): string | undefined {
  const payload = error instanceof IpcError ? error.payload : error;
  if (payload && typeof payload === 'object' && 'kind' in payload && typeof payload.kind === 'string') {
    return payload.kind;
  }
  return undefined;
}

function asIpcError(error: unknown): IpcError {
  return error instanceof IpcError ? error : new IpcError('engine_dispatch', error);
}

export interface Action {
  /** Runs the intent. Never throws: failures resolve to `{ ok: false, error }`. */
  run: <I extends Intent>(intent: I) => Promise<ActionResult<I['type']>>;
  /** An intent from this hook is in flight. */
  pending: boolean;
  /** The last failure, until the next run or `clearError()`. */
  error: IpcError | null;
  /** `kind` of the last failure (`busy`, `needsConfirmation`, …). */
  errorKind: string | undefined;
  clearError: () => void;
}

/**
 * Runs intents for one control or form: tracks pending state (for `isPending` / disabling
 * buttons) and the last error (for inline messages). State changes arrive as slices.
 */
export function useAction(): Action {
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<IpcError | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <I extends Intent>(intent: I): Promise<ActionResult<I['type']>> => {
    setPending((count) => count + 1);
    setError(null);
    try {
      const value = await dispatch(intent);
      return { ok: true, value };
    } catch (caught) {
      const failure = asIpcError(caught);
      if (mounted.current) setError(failure);
      return { ok: false, error: failure };
    } finally {
      if (mounted.current) setPending((count) => count - 1);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { run, pending: pending > 0, error, errorKind: error ? ipcErrorKind(error) : undefined, clearError };
}

// -- live clocks ------------------------------------------------------------------------------

type Tick = () => void;
const tickers = new Set<Tick>();
let timer: ReturnType<typeof setTimeout> | null = null;
let tickNow = Date.now();

function schedule(): void {
  if (timer !== null || tickers.size === 0) return;
  // Align to the next whole second so every clock on screen changes together.
  const delay = 1000 - (Date.now() % 1000) + 5;
  timer = setTimeout(() => {
    timer = null;
    tickNow = Date.now();
    for (const tick of [...tickers]) tick();
    schedule();
  }, delay);
}

function subscribeTicker(tick: Tick): () => void {
  // The first clock on screen starts from the real time, not from when the ticker last ran.
  if (tickers.size === 0) tickNow = Date.now();
  tickers.add(tick);
  schedule();
  return () => {
    tickers.delete(tick);
    if (tickers.size === 0 && timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

const noSubscription = () => () => {};
const readTickNow = () => tickNow;

/** `Date.now()`, updated every second while `active` (one shared timer for the window). */
export function useNow(active = true): number {
  return useSyncExternalStore(active ? subscribeTicker : noSubscription, readTickNow, readTickNow);
}

/** Seconds at `now` for a value published as `base` at `since` (RFC 3339). */
export function liveSeconds(base: number, since: string | null | undefined, extrapolate: boolean, now: number): number {
  if (!extrapolate || !since) return base;
  const start = Date.parse(since);
  if (Number.isNaN(start)) return base;
  return base + Math.max(0, (now - start) / 1000);
}

/**
 * A running clock from a slice's `elapsedBase` + `confirmedAt` + `extrapolate` (or progress's
 * totals + `computedAt`): ticks once per second only while `extrapolate` is true.
 */
export function useLiveSeconds(base: number, since: string | null | undefined, extrapolate: boolean): number {
  const now = useNow(extrapolate && !!since);
  return liveSeconds(base, since, extrapolate, now);
}
