import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { StoreContext } from './hooks';
import { connectStore, store as defaultStore, type SliceStore } from './store';

export type EngineStatus = 'connecting' | 'ready' | 'failed';

const EngineStatusContext = createContext<EngineStatus>('ready');

export interface EngineProviderProps {
  children: ReactNode;
  /** Defaults to the window's shared store; tests pass a fresh one. */
  store?: SliceStore;
  /** Subscribe and resync on mount (default). Tests that fill the store themselves pass false. */
  connect?: boolean;
}

/**
 * Connects this window's store to the engine: subscribes to `engine://slices`, then asks for
 * every slice once. Pages read slices with `useSlice`; until a slice arrives it is `undefined`.
 */
export function EngineProvider({ children, store = defaultStore, connect = true }: EngineProviderProps) {
  const [status, setStatus] = useState<EngineStatus>(connect ? 'connecting' : 'ready');

  useEffect(() => {
    if (!connect) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    connectStore(store).then(
      (stop) => {
        if (cancelled) {
          stop();
          return;
        }
        unlisten = stop;
        setStatus('ready');
      },
      (error: unknown) => {
        if (cancelled) return;
        console.error('Could not connect to the engine', error);
        setStatus('failed');
      },
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [store, connect]);

  return (
    <StoreContext.Provider value={store}>
      <EngineStatusContext.Provider value={status}>{children}</EngineStatusContext.Provider>
    </StoreContext.Provider>
  );
}

/** `connecting` until the first resync request returned, `failed` when the engine is unreachable. */
export function useEngineStatus(): EngineStatus {
  return useContext(EngineStatusContext);
}
