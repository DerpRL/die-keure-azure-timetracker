import type { Tone } from '../../../components/Badge';
import type { OfflineDraft, OfflineDraftStatus, OfflineDraftView, WorkItemsSlice } from '../../../ipc/contract';

/** The engine's title with the ticket's name when the title cache knows it ("#4821 · Checkout …"). */
export function draftHeading(draft: OfflineDraftView, items: WorkItemsSlice | undefined): string {
  const name = draft.ticketId ? items?.[String(draft.ticketId)]?.title : undefined;
  return name ? `${draft.title} · ${name}` : draft.title;
}

/** The heading as shown: the ticket number (styled apart) and the ticket's name or the draft's title. */
export function draftTitleParts(draft: OfflineDraftView, items: WorkItemsSlice | undefined): { ticket: string | null; name: string | null } {
  if (!draft.ticketId) return { ticket: null, name: draft.title };
  return { ticket: `#${draft.ticketId}`, name: items?.[String(draft.ticketId)]?.title ?? null };
}

/** The local timer: no end yet and not uploaded. */
export function isRunning(draft: OfflineDraft): boolean {
  return !draft.end && draft.status === 'Local draft';
}

export const STATUS_TONES: Record<OfflineDraftStatus, Tone> = {
  'Local draft': 'accent',
  'Check 7pace before retrying': 'warning',
  'Synced to 7pace': 'success',
};

/** A one-hour draft ending now (to the minute): "Add past time…". */
export function newPastDraft(workspace: string): OfflineDraft {
  const end = new Date();
  end.setSeconds(0, 0);
  const start = new Date(end.getTime() - 3600 * 1000);
  return {
    id: crypto.randomUUID(),
    workspace,
    start: start.toISOString(),
    end: end.toISOString(),
    comment: '',
    billable: false,
    status: 'Local draft',
  };
}
