import type { Tone } from '../../components/Badge';
import type { OfflineDraft, OfflineDraftStatus, OfflineDraftView, WorkItemsSlice } from '../../ipc/contract';

/** The engine's title with the ticket's name when the title cache knows it ("#4821 · Checkout …"). */
export function draftHeading(draft: OfflineDraftView, items: WorkItemsSlice | undefined): string {
  const name = draft.ticketId ? items?.[String(draft.ticketId)]?.title : undefined;
  return name ? `${draft.title} · ${name}` : draft.title;
}

/** The local timer: no end yet and not uploaded. */
export function isRunning(draft: OfflineDraft): boolean {
  return !draft.end && draft.status === 'Local draft';
}

export const STATUS_TONES: Record<OfflineDraftStatus, Tone> = {
  'Local draft': 'info',
  'Check 7pace before retrying': 'warning',
  'Synced to 7pace': 'success',
};
