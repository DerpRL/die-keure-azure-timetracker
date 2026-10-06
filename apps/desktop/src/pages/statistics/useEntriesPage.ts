import { useCallback, useEffect, useState } from 'react';
import type { EntriesPage } from '../../ipc/contract';
import { useAction } from '../../state/hooks';

export interface EntriesPageState {
  /** A request for the current key and offset is in flight. */
  loading: boolean;
  page: EntriesPage | null;
  /** The engine's message, verbatim. */
  error: string | null;
  retry: () => void;
}

function isEntriesPage(value: unknown): value is EntriesPage {
  return !!value && typeof value === 'object' && 'entries' in value && Array.isArray((value as EntriesPage).entries);
}

interface Loaded {
  request: string;
  page: EntriesPage | null;
  error: string | null;
}

/**
 * One page of the explorer's entries (`statistics.entries {offset, limit}`), asked for when
 * `offset` is set and again whenever `analysis` (an `analysisKey`) changes. A result that arrives
 * for an older request is dropped.
 */
export function useEntriesPage(analysis: string, offset: number | null, limit: number): EntriesPageState {
  const { run } = useAction();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const request = offset === null ? null : `${analysis}|${offset}|${limit}|${attempt}`;

  useEffect(() => {
    if (request === null || offset === null) return;
    let current = true;
    void run({ type: 'statistics.entries', offset, limit }).then((result) => {
      if (!current) return;
      if (result.ok && isEntriesPage(result.value)) setLoaded({ request, page: result.value, error: null });
      else setLoaded({ request, page: null, error: result.ok ? 'The entries could not be loaded.' : result.error.message });
    });
    return () => {
      current = false;
    };
  }, [request, offset, limit, run]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const result = loaded && loaded.request === request ? loaded : null;
  return { loading: request !== null && result === null, page: result?.page ?? null, error: result?.error ?? null, retry };
}
