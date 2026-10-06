/** Text and identifiers of the Time editor (1.14 `TimeEditorView`, `TimeCorrectionViews`). */
import type { TimeCorrectionIssue, TimeEditMode, WorkLogChangeStatus } from '../../ipc/contract';
import type { Tone } from '../../components/Badge';

/** Swift `TimeEditMode.rawValue`: the sheet title is "<mode> · recorded time". */
export const MODE_TITLES: Record<TimeEditMode, string> = {
  guided: 'Guided correction',
  edit: 'Edit time',
  split: 'Split',
  merge: 'Merge',
  undo: 'Undo',
};

/** The sheet's default action per mode. */
export const SAVE_LABELS: Record<TimeEditMode, string> = {
  guided: 'Apply correction',
  edit: 'Save time changes',
  split: 'Split entry',
  merge: 'Merge entries',
  undo: 'Undo change',
};

/** The confirmation asked before anything is written to 7pace. */
export const CONFIRM_TITLES: Record<TimeEditMode, string> = {
  guided: 'Apply this correction in 7pace?',
  edit: 'Save these time changes in 7pace?',
  split: 'Split this entry in 7pace?',
  merge: 'Merge these entries in 7pace?',
  undo: 'Undo this change in 7pace?',
};

export const STATUS_LABELS: Record<WorkLogChangeStatus, { label: string; tone: Tone }> = {
  complete: { label: 'Ready to undo', tone: 'success' },
  undone: { label: 'Undone', tone: 'neutral' },
  reviewed: { label: 'Reviewed', tone: 'neutral' },
  needsReview: { label: 'Needs review', tone: 'warning' },
  applying: { label: 'Needs review', tone: 'warning' },
};

/** The corrections a Gaps & overlaps card offers (`timeEditor.prepareCorrection` `option`). */
export const CORRECTION_OPTIONS = {
  /** Gap: extend the earlier entry to the start of the later one. */
  extendEarlier: 'extendEarlier',
  /** Gap: start the later entry at the end of the earlier one. */
  startLaterEarlier: 'startLaterEarlier',
  /** Overlap: cut the shared time out of the earlier entry. */
  trimEarlier: 'trimEarlier',
  /** Overlap: cut the shared time out of the later entry. */
  trimLater: 'trimLater',
} as const;

/** Overlap: end the earlier and start the later entry at one shared instant. */
export function boundaryOption(instant: string): string {
  return `boundary:${instant}`;
}

/** Swift's `Double` text of Unix seconds: "1790575200.0", or "1790575200.5" with a fraction. */
function swiftSeconds(instant: string): string {
  const seconds = Date.parse(instant) / 1000;
  return Number.isInteger(seconds) ? seconds.toFixed(1) : String(seconds);
}

/**
 * `TimeCorrectionIssue::id()` from att-core (`kind|startSeconds|earlierID|laterID`). The slice does
 * not carry the id yet (see the contract requests), so the UI derives the same text.
 */
export function correctionIssueId(issue: TimeCorrectionIssue): string {
  return [issue.kind, swiftSeconds(issue.start), issue.earlier?.id ?? '', issue.later?.id ?? ''].join('|');
}
