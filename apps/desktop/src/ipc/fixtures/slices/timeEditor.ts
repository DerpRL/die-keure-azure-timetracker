import type {
  CorrectionChoices,
  SliceMap,
  TimeCorrectionIssue,
  TimeEditorSlice,
  WorkLog,
  WorkLogChange,
  WorkLogConflict,
  WorkLogDraft,
  WorkLogPlan,
} from '../../contract';
import { mondayLogs } from './history';

const WORKSPACE = 'https://contoso.timehub.7pace.com';

function byId(id: string): WorkLog {
  const found = mondayLogs.find((entry) => entry.id === id);
  if (!found) throw new Error(`No sample worklog ${id}`);
  return found;
}

/** The sample entries of Monday 5 October, by role. */
export const sampleLogs = {
  locked: byId('a7c2e9f1-6b3d-4e8a-9f0c-1d2e3f4a5b60'),
  review: byId('f3b1d5c7-9e2a-4b6c-8d0e-2f4a6b8c0d15'),
  design: byId('e2a0c4b6-8d1f-4a5b-9c7e-3a5b7c9d1e26'),
  invoice: byId('d1f9b3a5-7c0e-4f4a-8b6d-4b6c8d0e2f37'),
  cardRetry: byId('c0e8a2f4-6b9d-4e3f-9a5c-5c7d9e1f3a48'),
  standup: byId('b9d7f1e3-5a8c-4d2e-8f4b-6d8e0f2a4b59'),
};

function draft(log: WorkLog, start: string, seconds: number, extra: Partial<WorkLogDraft> = {}): WorkLogDraft {
  return {
    existingId: log.id,
    restoredId: null,
    start,
    seconds,
    billableSeconds: seconds,
    ticketId: log.workItemId ?? null,
    comment: log.comment ?? null,
    activityId: log.activityType?.id ?? null,
    userId: log.user?.id ?? null,
    allowDefaultActivity: false,
    ...extra,
  };
}

const editPlan: WorkLogPlan = {
  title: 'Edit time',
  before: [sampleLogs.cardRetry],
  desired: [draft(sampleLogs.cardRetry, '2026-10-05T07:15:00Z', 11_700)],
  undoOf: null,
};

/** A confirmed edit that can be undone, and an older one that was reviewed. */
export const journal: WorkLogChange[] = [
  {
    id: '3f6c9a2d-8b1e-4c7f-a5d0-9e2b4c6a8d10',
    date: '2026-10-05T11:02:19Z',
    workspace: WORKSPACE,
    title: 'Edit time',
    before: [{ ...sampleLogs.invoice, timestamp: '2026-10-05T11:45:00Z', length: 4_800 }],
    after: [sampleLogs.invoice],
    desired: [draft(sampleLogs.invoice, '2026-10-05T11:30:00Z', 5_700)],
    status: 'complete',
    detail: 'Confirmed by 7pace.',
    undoOf: null,
  },
  {
    id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
    date: '2026-10-02T15:40:00Z',
    workspace: WORKSPACE,
    title: 'Split entry',
    before: [],
    after: [],
    desired: [],
    status: 'reviewed',
    detail: 'The second request timed out. User acknowledged checking the entries in 7pace.',
    undoOf: null,
  },
];

/** A change interrupted by a crash: 7pace must be checked before anything else is edited. */
export const interruptedChange: WorkLogChange = {
  id: '7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a',
  date: '2026-10-05T15:20:00Z',
  workspace: WORKSPACE,
  title: 'Merge entries',
  before: [sampleLogs.design, sampleLogs.review],
  after: [sampleLogs.design],
  desired: [draft(sampleLogs.design, '2026-10-05T13:40:00Z', 4_800)],
  status: 'needsReview',
  detail: 'The app closed during this change. Check the affected entries in 7pace; no request will be replayed.',
  undoOf: null,
};

const overlapConflict: WorkLogConflict = {
  id: sampleLogs.review.id,
  ticketId: null,
  title: 'Reviewing pull requests',
  start: '2026-10-05T14:20:00Z',
  end: '2026-10-05T15:00:00Z',
  active: false,
  overlap: 1_500,
};

/** Gaps and overlaps in Monday's workday (09:00–17:00). */
export const correctionIssues: TimeCorrectionIssue[] = [
  { kind: 'gap', start: '2026-10-05T10:40:00Z', end: '2026-10-05T11:30:00Z', earlier: sampleLogs.cardRetry, later: sampleLogs.invoice },
  { kind: 'gap', start: '2026-10-05T13:05:00Z', end: '2026-10-05T13:40:00Z', earlier: sampleLogs.invoice, later: sampleLogs.design },
  { kind: 'overlap', start: '2026-10-05T14:20:00Z', end: '2026-10-05T14:30:00Z', earlier: sampleLogs.design, later: sampleLogs.review },
];

/**
 * The corrections with a valid plan, per issue (`TimeCorrectionIssue::id()`), in the order of
 * `correctionIssues`. The second gap leaves out "Start later task earlier" to show an unavailable
 * option.
 */
export const correctionChoices: CorrectionChoices[] = [
  { issueId: `gap|1791196800.0|${sampleLogs.cardRetry.id}|${sampleLogs.invoice.id}`, options: ['extendEarlier', 'startLaterEarlier'] },
  { issueId: `gap|1791205500.0|${sampleLogs.invoice.id}|${sampleLogs.design.id}`, options: ['extendEarlier'] },
  {
    issueId: `overlap|1791210000.0|${sampleLogs.design.id}|${sampleLogs.review.id}`,
    options: ['removeFromEarlier', 'removeFromLater', 'boundary'],
  },
];

const timeEditor: TimeEditorSlice = {
  day: '2026-10-05',
  filter: '',
  logs: mondayLogs,
  runningLogId: null,
  selection: [],
  selected: null,
  mode: 'edit',
  start: null,
  end: null,
  splitAt: null,
  secondTicket: '',
  secondComment: '',
  secondActivity: '',
  mergeLogs: [],
  undoRecord: null,
  plan: null,
  validationIssue: null,
  review: null,
  loading: false,
  working: false,
  issue: null,
  message: null,
  savedConflicts: [],
  savedOverlapIssue: null,
  changes: journal,
  requiresReview: false,
  journalIssue: null,
  needsReload: false,
  corrections: { show: false, issues: [], loading: false, issue: null, choices: [] },
  guidedPlan: null,
  idleInterval: null,
  separateIdle: false,
  configured: true,
  loadedConflicts: [],
};

/** The edit sheet: the long morning entry shortened by 10 minutes, checked without overlaps. */
export const timeEditorEditing: TimeEditorSlice = {
  ...timeEditor,
  selected: sampleLogs.cardRetry,
  mode: 'edit',
  start: '2026-10-05T07:15:00Z',
  end: '2026-10-05T10:30:00Z',
  splitAt: '2026-10-05T08:57:30Z',
  secondTicket: '4821',
  secondComment: 'Card retry flow',
  secondActivity: 'dev',
  plan: editPlan,
  review: {
    original: sampleLogs.cardRetry,
    edit: { start: '2026-10-05T07:15:00Z', end: '2026-10-05T10:30:00Z' },
    conflicts: [],
    overlapIssue: null,
  },
};

/** Extending the design entry to 14:45 overlaps the pull request review. */
export const timeEditorConflicts: TimeEditorSlice = {
  ...timeEditor,
  selected: sampleLogs.design,
  mode: 'edit',
  start: '2026-10-05T13:40:00Z',
  end: '2026-10-05T14:45:00Z',
  plan: {
    title: 'Edit time',
    before: [sampleLogs.design],
    desired: [draft(sampleLogs.design, '2026-10-05T13:40:00Z', 3_900)],
    undoOf: null,
  },
  review: {
    original: sampleLogs.design,
    edit: { start: '2026-10-05T13:40:00Z', end: '2026-10-05T14:45:00Z' },
    conflicts: [overlapConflict],
    overlapIssue: null,
  },
};

/** The same edit before "Check overlaps": the loaded day already shows the overlap. */
export const timeEditorLoadedConflicts: TimeEditorSlice = {
  ...timeEditorConflicts,
  review: null,
  loadedConflicts: [overlapConflict],
};

/** The end is before the start: no plan, and saving is unavailable. */
export const timeEditorInvalid: TimeEditorSlice = {
  ...timeEditorEditing,
  end: '2026-10-05T07:00:00Z',
  plan: null,
  review: null,
  validationIssue: 'The end must be after the start.',
};

/** Split the morning entry at 11:00: the second part goes to #4790. */
export const timeEditorSplit: TimeEditorSlice = {
  ...timeEditorEditing,
  mode: 'split',
  splitAt: '2026-10-05T09:00:00Z',
  secondTicket: '4790',
  secondComment: 'Invoice VAT follow-up',
  secondActivity: 'dev',
  review: null,
  plan: {
    title: 'Split entry',
    before: [sampleLogs.cardRetry],
    desired: [
      draft(sampleLogs.cardRetry, '2026-10-05T07:15:00Z', 6_300),
      draft(sampleLogs.cardRetry, '2026-10-05T09:00:00Z', 6_000, {
        existingId: null,
        ticketId: 4790,
        comment: 'Invoice VAT follow-up',
      }),
    ],
    undoOf: null,
  },
};

/** Merge the stand-up into the following development entry. */
export const timeEditorMerge: TimeEditorSlice = {
  ...timeEditor,
  selection: [sampleLogs.standup.id, sampleLogs.cardRetry.id],
  selected: sampleLogs.standup,
  mode: 'merge',
  mergeLogs: [sampleLogs.standup, sampleLogs.cardRetry],
  plan: {
    title: 'Merge entries',
    before: [sampleLogs.standup, sampleLogs.cardRetry],
    desired: [draft(sampleLogs.standup, '2026-10-05T07:00:00Z', 13_200)],
    undoOf: null,
  },
};

/** Undo the confirmed edit from Recent edits. */
export const timeEditorUndo: TimeEditorSlice = {
  ...timeEditor,
  selected: sampleLogs.invoice,
  mode: 'undo',
  undoRecord: journal[0]!,
  plan: {
    title: 'Undo Edit time',
    before: [sampleLogs.invoice],
    desired: [draft(sampleLogs.invoice, '2026-10-05T11:45:00Z', 4_800)],
    undoOf: journal[0]!.id,
  },
};

/** An idle correction prepared by the engine ("Pause & review"): 40 minutes away from the desk. */
export const timeEditorIdle: TimeEditorSlice = {
  ...timeEditor,
  selected: sampleLogs.cardRetry,
  mode: 'guided',
  idleInterval: { start: '2026-10-05T08:30:00Z', end: '2026-10-05T09:10:00Z' },
  separateIdle: false,
  secondTicket: '',
  secondComment: 'Idle time',
  secondActivity: 'dev',
  plan: {
    title: 'Remove idle time',
    before: [sampleLogs.cardRetry],
    desired: [
      draft(sampleLogs.cardRetry, '2026-10-05T07:15:00Z', 4_500),
      draft(sampleLogs.cardRetry, '2026-10-05T09:10:00Z', 5_400, { existingId: null }),
    ],
    undoOf: null,
  },
};

/** A gap correction chosen in Gaps & overlaps. */
export const timeEditorGuidedGap: TimeEditorSlice = {
  ...timeEditor,
  selected: sampleLogs.cardRetry,
  mode: 'guided',
  guidedPlan: {
    title: 'Fill gap with neighboring task',
    before: [sampleLogs.cardRetry],
    desired: [draft(sampleLogs.cardRetry, '2026-10-05T07:15:00Z', 15_300)],
    undoOf: null,
  },
  plan: {
    title: 'Fill gap with neighboring task',
    before: [sampleLogs.cardRetry],
    desired: [draft(sampleLogs.cardRetry, '2026-10-05T07:15:00Z', 15_300)],
    undoOf: null,
  },
};

/** Saved, but the edit overlaps another entry. */
export const timeEditorSaved: TimeEditorSlice = {
  ...timeEditor,
  message: 'Edit time confirmed by 7pace. You can undo this from Recent edits.',
  savedConflicts: [overlapConflict],
};

/** A change needs review before the next one. */
export const timeEditorNeedsReview: TimeEditorSlice = {
  ...timeEditor,
  changes: [interruptedChange, ...journal],
  requiresReview: true,
};

/** Gaps & overlaps is open with three issues. */
export const timeEditorCorrections: TimeEditorSlice = {
  ...timeEditor,
  corrections: { show: true, issues: correctionIssues, loading: false, issue: null, choices: correctionChoices },
};

export const timeEditorLoading: TimeEditorSlice = { ...timeEditor, logs: [], loading: true };

export const timeEditorFailed: TimeEditorSlice = {
  ...timeEditor,
  logs: [],
  issue: '7pace could not be reached. Check your network connection and try again.',
};

export const timeEditorEmpty: TimeEditorSlice = { ...timeEditor, logs: [], changes: [] };

/** No 7pace connection. */
export const timeEditorUnconfigured: TimeEditorSlice = { ...timeEditorEmpty, configured: false };

export default { timeEditor } satisfies Partial<SliceMap>;
