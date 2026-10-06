import { useCallback, useEffect, useState } from 'react';
import { readLaunchAtLogin, writeLaunchAtLogin } from './platform';

export interface LaunchAtLogin {
  /** What the OS reports; `null` while unknown or where the plugin is unavailable. */
  enabled: boolean | null;
  /** Reading or writing is in progress. */
  pending: boolean;
  /** Launch at login can be changed here (inside the desktop app). */
  available: boolean;
  error: string | null;
  set: (enabled: boolean) => void;
}

/** Launch at login through the autostart plugin. Applies immediately, outside the draft. */
export function useLaunchAtLogin(): LaunchAtLogin {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [available, setAvailable] = useState(true);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    readLaunchAtLogin().then(
      (state) => {
        if (!active) return;
        setEnabled(state);
        setAvailable(state !== null);
        setPending(false);
      },
      (caught: unknown) => {
        if (!active) return;
        setError(`Launch at login: ${caught instanceof Error ? caught.message : String(caught)}`);
        setPending(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const set = useCallback((next: boolean) => {
    setPending(true);
    setError(null);
    writeLaunchAtLogin(next).then(
      (state) => {
        setEnabled(state);
        setPending(false);
      },
      (caught: unknown) => {
        setError(`Launch at login: ${caught instanceof Error ? caught.message : String(caught)}`);
        setPending(false);
      },
    );
  }, []);

  return { enabled, pending, available, error, set };
}
