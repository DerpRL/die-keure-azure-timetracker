/**
 * The update status of this window: one subscription to `shell://update` and one status request
 * for every component that reads it, released when the last one unmounts.
 */
import { useCallback, useState, useSyncExternalStore } from 'react';
import { IpcError } from '../../ipc';
import { checkForUpdates, getUpdateStatus, installUpdate, onUpdateStatus, type UpdateStatus } from './api';

export interface UpdateSnapshot {
  /** `undefined` until the first status arrived. */
  status: UpdateStatus | undefined;
  /** Why the status could not be read. */
  error: string | null;
}

const EMPTY: UpdateSnapshot = { status: undefined, error: null };

let snapshot: UpdateSnapshot = EMPTY;
const listeners = new Set<() => void>();
/** Bumped by every connect and disconnect; late results of an older connection are dropped. */
let connection = 0;
/** Counts status events, so a status request never overwrites a newer event. */
let events = 0;
let disconnect: (() => void) | null = null;

function publish(next: UpdateSnapshot): void {
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

function messageOf(error: unknown): string {
  if (error instanceof IpcError || error instanceof Error) return error.message;
  return String(error);
}

/** Applies a status returned by a command. */
export function applyUpdateStatus(status: UpdateStatus): void {
  events += 1;
  publish({ status, error: null });
}

function connect(): void {
  const token = ++connection;
  let unlisten: (() => void) | undefined;
  let closed = false;
  disconnect = () => {
    closed = true;
    unlisten?.();
  };
  onUpdateStatus((status) => {
    if (token === connection) applyUpdateStatus(status);
  })
    .then((stop) => {
      if (closed) stop();
      else unlisten = stop;
      const seen = events;
      return getUpdateStatus().then(
        (status) => {
          if (token === connection && events === seen) publish({ status, error: null });
        },
        (error: unknown) => {
          if (token === connection && events === seen) publish({ status: snapshot.status, error: messageOf(error) });
        },
      );
    })
    .catch((error: unknown) => {
      if (token === connection) publish({ status: snapshot.status, error: messageOf(error) });
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      connection += 1;
      disconnect?.();
      disconnect = null;
      snapshot = EMPTY;
    }
  };
}

const read = () => snapshot;

/** The shell's update status (`shell_update_status` plus every `shell://update`). */
export function useUpdateStatus(): UpdateSnapshot {
  return useSyncExternalStore(subscribe, read, read);
}

export interface UpdateActions {
  check: () => Promise<UpdateStatus | null>;
  install: () => Promise<UpdateStatus | null>;
  pending: 'check' | 'install' | null;
  /** The last command failure, shown verbatim. */
  error: string | null;
}

/** "Check for updates" and the install action, with pending and error state per control. */
export function useUpdateActions(): UpdateActions {
  const [pending, setPending] = useState<'check' | 'install' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (kind: 'check' | 'install', command: () => Promise<UpdateStatus>) => {
    setPending(kind);
    setError(null);
    try {
      const status = await command();
      applyUpdateStatus(status);
      return status;
    } catch (caught) {
      setError(messageOf(caught));
      return null;
    } finally {
      setPending(null);
    }
  }, []);

  const check = useCallback(() => run('check', checkForUpdates), [run]);
  const install = useCallback(() => run('install', installUpdate), [run]);
  return { check, install, pending, error };
}
