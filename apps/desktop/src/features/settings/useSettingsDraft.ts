import { useCallback, useState } from 'react';
import type { IpcError } from '../../ipc';
import type { Configuration } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { configurationToSave, deepEqual, draftFields, hasDraftChanges, rebaseDraft, type DraftState } from './configDraft';
import { validateConfiguration, type SettingsIssue } from './validation';

export interface SettingsDraft {
  /** The configuration the form shows and edits. */
  draft: Configuration;
  /** Applies an edit to the draft. */
  update: (recipe: (draft: Configuration) => Configuration) => void;
  azurePat: string;
  setAzurePat: (value: string) => void;
  sevenPaceToken: string;
  setSevenPaceToken: (value: string) => void;
  /** Save would write something: an edited field or a new secret. */
  dirty: boolean;
  /** Inline problems with the draft (same rules as Rust). */
  issues: SettingsIssue[];
  /** Save was pressed while `issues` were not empty. */
  showIssues: boolean;
  save: () => Promise<boolean>;
  revert: () => void;
  saving: boolean;
  /** The engine's rejection, shown verbatim. */
  saveError: IpcError | null;
  /** The last save succeeded and nothing changed since. */
  saved: boolean;
}

interface State extends DraftState {
  /** The slice value last reconciled, to notice new ones during render. */
  seen: Configuration;
}

/**
 * The Settings draft (1.14 `SettingsPage` `@ViewState draft`). The draft starts as the slice's
 * configuration; a new slice value replaces an unchanged draft and merges under an edited one.
 * Save sends the whole configuration plus the two secrets (blank keeps the stored ones).
 */
export function useSettingsDraft(configuration: Configuration): SettingsDraft {
  const [state, setState] = useState<State>(() => ({ seen: configuration, base: configuration, draft: configuration }));
  const [azurePat, setPat] = useState('');
  const [sevenPaceToken, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const action = useAction();

  // A new slice value (another window saved, the engine normalised a field, calendar access
  // changed `calendarEnabled`): reconcile during render, before anything shows stale values.
  let current = state;
  if (configuration !== state.seen) {
    current = { ...rebaseDraft(state, configuration), seen: configuration };
    setState(current);
  }

  const update = useCallback((recipe: (draft: Configuration) => Configuration) => {
    setState((previous) => ({ ...previous, draft: recipe(previous.draft) }));
    setSaved(false);
  }, []);

  const setAzurePat = useCallback((value: string) => {
    setPat(value);
    if (value !== '') setSaved(false);
  }, []);

  const setSevenPaceToken = useCallback((value: string) => {
    setToken(value);
    if (value !== '') setSaved(false);
  }, []);

  const secrets = { azurePat, sevenPaceToken };
  const issues = validateConfiguration(current.draft, secrets);
  const dirty = hasDraftChanges(current.draft, current.base) || azurePat.trim() !== '' || sevenPaceToken.trim() !== '';
  const { run, clearError } = action;
  const draft = current.draft;

  const save = useCallback(async () => {
    if (validateConfiguration(draft, { azurePat, sevenPaceToken }).length > 0) {
      setShowIssues(true);
      return false;
    }
    setShowIssues(false);
    const payload = configurationToSave(draft, configuration);
    const result = await run({
      type: 'settings.save',
      configuration: payload,
      azurePat: azurePat.trim(),
      // 1.14 ignored the API token while Mobile PIN pairing was chosen.
      sevenPaceToken: payload.sevenPaceAuthMode === 'mobilePIN' ? '' : sevenPaceToken.trim(),
    });
    if (!result.ok) return false;
    setState((previous) => {
      const savedConfiguration = configurationToSave(payload, previous.seen);
      // Keep edits made while the save was in flight.
      const unchanged = deepEqual(draftFields(previous.draft), draftFields(payload));
      return { ...previous, base: savedConfiguration, draft: unchanged ? savedConfiguration : previous.draft };
    });
    setPat('');
    setToken('');
    setSaved(true);
    return true;
  }, [draft, configuration, azurePat, sevenPaceToken, run]);

  const revert = useCallback(() => {
    setState((previous) => ({ ...previous, draft: previous.base }));
    setPat('');
    setToken('');
    setShowIssues(false);
    setSaved(false);
    clearError();
  }, [clearError]);

  return {
    draft,
    update,
    azurePat,
    setAzurePat,
    sevenPaceToken,
    setSevenPaceToken,
    dirty,
    issues,
    showIssues: showIssues && issues.length > 0,
    save,
    revert,
    saving: action.pending,
    saveError: action.error,
    saved: saved && !dirty,
  };
}
