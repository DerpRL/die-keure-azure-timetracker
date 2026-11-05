import { useCallback, useState } from 'react';
import type { IpcError } from '../../ipc';
import type { Configuration } from '../../ipc/contract';
import { useAction, type ActionResult } from '../../state/hooks';
import { configurationToSave, deepEqual, draftChanges, draftFields, hasDraftChanges, rebaseDraft, type DraftState } from './configDraft';
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
  /** The names of what Save would write, for the save bar ("Friday target", "Azure token"). */
  changes: string[];
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
  /**
   * Saves the Azure organization and project with the typed token on top of the saved settings
   * (Settings → Test and save, after a successful test). Other edits stay in the draft.
   */
  saveAzure: (account: { organization: string; project: string }) => Promise<ActionResult<'settings.save'>>;
}

interface State extends DraftState {
  /** The slice value last reconciled, to notice new ones during render. */
  seen: Configuration;
}

/**
 * The Settings draft (1.14 `SettingsPage` `@ViewState draft`). The draft starts as the slice's
 * configuration (passed through `start`); a new slice value replaces an unchanged draft and merges under an edited one.
 * Save sends the whole configuration plus the two secrets (blank keeps the stored ones).
 */
export function useSettingsDraft(
  configuration: Configuration,
  start: (saved: Configuration) => Configuration = (saved) => saved,
): SettingsDraft {
  // `start` suggests values (the first-run account defaults): they count as unsaved edits.
  const [state, setState] = useState<State>(() => ({ seen: configuration, base: configuration, draft: start(configuration) }));
  const [azurePat, setPat] = useState('');
  const [sevenPaceToken, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const action = useAction();
  const azureAction = useAction();

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
  const changes = [
    ...draftChanges(current.draft, current.base),
    ...(azurePat.trim() !== '' ? ['Azure token'] : []),
    ...(sevenPaceToken.trim() !== '' ? ['7pace token'] : []),
  ];
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

  const runAzure = azureAction.run;
  const saveAzure = useCallback(
    async ({ organization, project }: { organization: string; project: string }) => {
      const payload = configurationToSave({ ...configuration, organization, project }, configuration);
      const result = await runAzure({ type: 'settings.save', configuration: payload, azurePat: azurePat.trim(), sevenPaceToken: '' });
      if (!result.ok) return result;
      setState((previous) => {
        const base = { ...previous.base, organization, project };
        return { ...previous, base, draft: hasDraftChanges(previous.draft, base) ? previous.draft : base };
      });
      setPat('');
      return result;
    },
    [configuration, azurePat, runAzure],
  );

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
    changes,
    issues,
    showIssues: showIssues && issues.length > 0,
    save,
    revert,
    saving: action.pending,
    saveError: action.error,
    saved: saved && !dirty,
    saveAzure,
  };
}
