import { useMemo } from 'react';
import { SERIES_COLOR_COUNT, seriesColor } from '../../charts/palette';
import { useSlice } from '../../state/hooks';

/**
 * Activity colours outside the statistics charts. Statistics assigns its palette by activity ID
 * order (`activityColors` in places/insights/explore/model.ts, as 1.14 did); everything else uses the
 * same rule over the workspace's activity types, so an activity keeps one colour on every page.
 */
export type ActivityColors = ReadonlyMap<string, number>;

/** Palette index per activity ID: the IDs in sorted order. */
export function activityColorMap(ids: Iterable<string>): ActivityColors {
  const sorted = [...new Set(ids)].filter(Boolean).sort();
  return new Map(sorted.map((id, index) => [id, index]));
}

/** Stable fallback for an activity the workspace list does not know (yet). */
function hashIndex(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(hash) % SERIES_COLOR_COUNT;
}

/** Palette index for an activity; work without an activity uses the last (grey) colour. */
export function activityColorIndex(colors: ActivityColors, activityId: string | null | undefined): number {
  if (!activityId) return SERIES_COLOR_COUNT - 1;
  return colors.get(activityId) ?? hashIndex(activityId);
}

/** `var(--chart-n)` for an activity. */
export function activityColor(colors: ActivityColors, activityId: string | null | undefined): string {
  return seriesColor(activityColorIndex(colors, activityId));
}

/** Colours for the workspace's activity types (ticket flow and offline cache combined). */
export function useActivityColors(extraIds: readonly string[] = []): ActivityColors {
  const flow = useSlice('flow');
  const offline = useSlice('offline');
  const key = extraIds.join('|');
  return useMemo(
    () =>
      activityColorMap([
        ...(flow?.activityTypes ?? []).map((activity) => activity.id),
        ...(offline?.activities ?? []).map((activity) => activity.id),
        ...(key ? key.split('|') : []),
      ]),
    [flow?.activityTypes, offline?.activities, key],
  );
}
