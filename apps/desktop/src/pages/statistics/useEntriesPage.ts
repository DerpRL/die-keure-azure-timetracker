import { useCallback, useEffect, useState } from 'react';
import type { EntriesPage, Interval } from '../../ipc/contract';
import { ipcErrorKind, useAction } from '../../state/hooks';

export interface EntriesPageState {
  /** A request for the current key, interval and offset is in flight. */
  loading: boolean;
  page: EntriesPage | null;
  /** The engine's message, verbatim. */
  error: string | null;
  /** The engine's `kind` for the failure (`notFound`, `busy`, …). */
  errorKind: string | null;
  retry: () => void;
}

/** The engine caps one `statistics.entries` page at this many entries. */
export const MAX_ENTRIES_PAGE = 500;

function isEntriesPage(value: unknown): value is EntriesPage {
  return !!value && typeof value === 'object' && 'entries' in value && Array.isArray((value as EntriesPage).entries);
}

interface Loaded {
  request: string;
  page: EntriesPage | null;
  error: string | null;
  errorKind: string | null;
}

/**
 * One page of the explorer's entries (`statistics.entries {offset, limit, start?, end?}`), asked
 * for when `offset` is set and again whenever `analysis` (an `analysisKey`) or `within` changes.
 * With `within`, the engine returns only the entries overlapping that interval (a chart bar or a
 * timeline day). A result that arrives for an older request is dropped.
 */
export function useEntriesPage(analysis: string, offset: number | null, limit: number, within: Interval | null = null): EntriesPageState {
  const { run } = useAction();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const start = within?.start ?? null;
  const end = within?.end ?? null;
  const request = offset === null ? null : `${analysis}|${start ?? ''}|${end ?? ''}|${offset}|${limit}|${attempt}`;

  useEffect(() => {
    if (request === null || offset === null) return;
    let current = true;
    const intent =
      start !== null || end !== null
        ? ({ type: 'statistics.entries', offset, limit, start, end } as const)
        : ({ type: 'statistics.entries', offset, limit } as const);
    void run(intent).then((result) => {
      if (!current) return;
      if (result.ok && isEntriesPage(result.value)) {
        setLoaded({ request, page: result.value, error: null, errorKind: null });
      } else if (result.ok) {
        setLoaded({ request, page: null, error: 'The entries could not be loaded.', errorKind: null });
      } else {
        setLoaded({ request, page: null, error: result.error.message, errorKind: ipcErrorKind(result.error) ?? null });
      }
    });
    return () => {
      current = false;
    };
  }, [request, offset, limit, start, end, run]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const result = loaded && loaded.request === request ? loaded : null;
  return {
    loading: request !== null && result === null,
    page: result?.page ?? null,
    error: result?.error ?? null,
    errorKind: result?.errorKind ?? null,
    retry,
  };
}
