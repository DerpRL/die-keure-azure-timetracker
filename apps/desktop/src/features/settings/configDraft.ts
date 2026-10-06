/**
 * The Settings save model (1.14 `SettingsPage` + `AppModel.saveSettings`): the form edits a draft
 * copy of `settings.configuration`; Save sends the whole configuration. Fields that apply
 * immediately through their own intents are never taken from the draft.
 */
import type { Configuration } from '../../ipc/contract';

/**
 * Applied immediately (appearance, Figma, interruptions, quiet hours, onboarding) or owned by
 * another page (repositories). Save always sends the latest slice values for these, so an older
 * draft never overwrites them (1.14 copied `figma`, `interface` and `interfaceSetupCompleted`
 * from the model, and `repositories` from the current configuration).
 */
export const IMMEDIATE_FIELDS = [
  'interface',
  'figma',
  'interruptions',
  'quietHours',
  'interfaceSetupCompleted',
  'repositories',
] as const satisfies ReadonlyArray<keyof Configuration>;

type ImmediateField = (typeof IMMEDIATE_FIELDS)[number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality for JSON values (the configuration is plain JSON). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  // `undefined` and a missing key are the same thing in JSON.
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Three-way merge of a draft with a newer slice value: keeps what the user changed (`mine`
 * differs from `base`) and takes every other value from `theirs`. Objects merge per key, lists
 * and scalars as a whole; when both sides changed the same value, the user's edit wins.
 */
export function mergeUnderneath<T>(base: T, mine: T, theirs: T): T {
  if (deepEqual(mine, base)) return theirs;
  if (deepEqual(theirs, base) || deepEqual(theirs, mine)) return mine;
  if (isPlainObject(base) && isPlainObject(mine) && isPlainObject(theirs)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
    for (const key of keys) {
      const merged = mergeUnderneath(base[key], mine[key], theirs[key]);
      if (merged !== undefined) result[key] = merged;
    }
    return result as T;
  }
  return mine;
}

function withImmediateFrom(target: Configuration, source: Configuration): Configuration {
  const result: Configuration = { ...target };
  for (const field of IMMEDIATE_FIELDS) {
    (result as Record<ImmediateField, unknown>)[field] = source[field];
  }
  return result;
}

/** The draft's own fields only: what Save and Revert are about. */
export function draftFields(configuration: Configuration): Omit<Configuration, ImmediateField> {
  const result: Record<string, unknown> = { ...configuration };
  for (const field of IMMEDIATE_FIELDS) delete result[field];
  return result as Omit<Configuration, ImmediateField>;
}

/** The draft differs from the stored configuration in a field Save would write. */
export function hasDraftChanges(draft: Configuration, stored: Configuration): boolean {
  return !deepEqual(draftFields(draft), draftFields(stored));
}

export interface DraftState {
  /** The slice value the draft was last reconciled with. */
  base: Configuration;
  draft: Configuration;
}

/**
 * Reconciles a draft with a new slice value. An unchanged draft simply takes the new values; an
 * edited one keeps the user's changes and takes everything else from the slice. Immediate
 * fields always follow the slice.
 */
export function rebaseDraft({ base, draft }: DraftState, incoming: Configuration): DraftState {
  if (!hasDraftChanges(draft, base)) return { base: incoming, draft: incoming };
  const merged = withImmediateFrom(mergeUnderneath(base, draft, incoming), incoming);
  // The new value already contains the edits (for example after a successful save).
  if (!hasDraftChanges(merged, incoming)) return { base: incoming, draft: incoming };
  return { base: incoming, draft: merged };
}

/** What `settings.save` sends: the draft, with the latest values of the immediate fields. */
export function configurationToSave(draft: Configuration, latest: Configuration): Configuration {
  return withImmediateFrom(draft, latest);
}
