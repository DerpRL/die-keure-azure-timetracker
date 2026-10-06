import type { OfflineDraft, OfflineReview, OfflineSlice, SliceMap } from '../../contract';
import { activities } from './history';

const WORKSPACE = 'https://contoso.timehub.7pace.com';

function draft(id: string, start: string, end: string | null, extra: Partial<OfflineDraft> = {}): OfflineDraft {
  return {
    id,
    workspace: WORKSPACE,
    start,
    end,
    ticketId: null,
    comment: '',
    activityId: 'dev',
    billable: false,
    status: 'Local draft',
    remoteId: null,
    ...extra,
  };
}

/** The local timer, running since 09:20 on the train. */
export const runningDraft = draft('6f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f', '2026-10-06T07:20:00Z', null, {
  ticketId: 4790,
  comment: 'Offline: invoice template',
});

/** Stopped and ready to review. */
export const readyDraft = draft('5e0d1c2b-3a49-4857-9665-4f3e2d1c0b9a', '2026-10-05T16:00:00Z', '2026-10-05T17:15:00Z', {
  ticketId: 4821,
  comment: 'Offline development',
  billable: true,
});

/** Ticket-free time added afterwards. */
export const pastDraft = draft('4d9c0b1a-2938-4746-8554-3e2d1c0b9a8f', '2026-10-02T15:30:00Z', '2026-10-02T16:00:00Z', {
  comment: 'Interview preparation',
  activityId: 'meeting',
});

/** An upload whose outcome is unknown: 7pace must be checked before another attempt. */
export const sendingDraft = draft('3c8b9a0f-1827-4635-9443-2d1c0b9a8f7e', '2026-10-01T14:00:00Z', '2026-10-01T15:00:00Z', {
  ticketId: 4655,
  comment: 'Offline design review',
  activityId: 'design',
  status: 'Check 7pace before retrying',
});

/** Uploaded and confirmed (shown with "Show synced"). */
export const syncedDraft = draft('2b7a8f9e-0716-4524-8332-1c0b9a8f7e6d', '2026-09-30T13:00:00Z', '2026-09-30T14:30:00Z', {
  ticketId: 4821,
  comment: 'Offline retry tests',
  status: 'Synced to 7pace',
  remoteId: '0f1e2d3c-4b5a-4968-8776-112233445566',
});

const offline: OfflineSlice = {
  workspace: WORKSPACE,
  drafts: [runningDraft, readyDraft, pastDraft, sendingDraft],
  showSynced: false,
  active: runningDraft,
  readyCount: 3,
  activities: [activities.dev, activities.design, activities.meeting, activities.standup, activities.review],
  review: null,
  working: false,
  issue: null,
  message: null,
  canCreate: true,
  configured: true,
};

/** Reviewed: one overlap with an existing entry; uploading is still allowed. */
export const reviewWithConflicts: OfflineReview = {
  draft: readyDraft,
  conflicts: [
    {
      id: '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a',
      ticketId: 4790,
      title: 'Invoice PDF shows the wrong VAT number',
      start: '2026-10-05T16:45:00Z',
      end: '2026-10-05T17:30:00Z',
      active: false,
      overlap: 1_800,
    },
  ],
  overlapIssue: null,
  matches: [],
};

/** Reviewed: an identical entry already exists. */
export const reviewWithMatch: OfflineReview = {
  draft: readyDraft,
  conflicts: [],
  overlapIssue: null,
  matches: [
    {
      id: '8e7d6c5b-4a39-4281-9069-5e4d3c2b1a0f',
      timestamp: '2026-10-05T16:00:00Z',
      length: 4_500,
      workItemId: 4821,
      comment: 'Offline development',
      activityType: activities.dev,
    },
  ],
};

/** Reviewing a draft whose upload may have reached 7pace. */
export const reviewSending: OfflineReview = { draft: sendingDraft, conflicts: [], overlapIssue: null, matches: [] };

/** Reviewed: no overlaps. */
export const reviewClean: OfflineReview = { draft: readyDraft, conflicts: [], overlapIssue: null, matches: [] };

export const offlineReviewing: OfflineSlice = { ...offline, review: reviewWithConflicts };

/** The upload failed after the checkpoint: its outcome is unconfirmed. */
export const offlineUploadFailed: OfflineSlice = {
  ...offline,
  review: null,
  issue: 'Upload outcome is unconfirmed. Review this draft and check 7pace before retrying. The request timed out.',
};

/** No local timer; synced drafts shown. */
export const offlineWithSynced: OfflineSlice = {
  ...offline,
  active: null,
  drafts: [readyDraft, pastDraft, sendingDraft, syncedDraft],
  showSynced: true,
  message: 'Draft confirmed by 7pace.',
};

export const offlineEmpty: OfflineSlice = { ...offline, drafts: [], active: null, readyCount: 0 };

/** No 7pace workspace saved yet. */
export const offlineNoWorkspace: OfflineSlice = { ...offlineEmpty, workspace: '', canCreate: false, activities: [], configured: false };

/** Talking to 7pace. */
export const offlineWorking: OfflineSlice = { ...offline, working: true };

export default { offline } satisfies Partial<SliceMap>;
