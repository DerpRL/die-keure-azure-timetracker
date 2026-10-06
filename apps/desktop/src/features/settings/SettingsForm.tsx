import { createContext, useContext } from 'react';
import type { AppSlice, SettingsSlice } from '../../ipc/contract';
import type { SettingsSectionId } from './sections';
import type { SettingsDraft } from './useSettingsDraft';

export interface SettingsFormValue extends SettingsDraft {
  settings: SettingsSlice;
  app: AppSlice | undefined;
  os: 'macos' | 'windows';
  /** A remote write or connection is in progress (`app.busy`): writes are disabled. */
  busy: boolean;
  /** Preview mode: credential changes and network requests are off. */
  preview: boolean;
  /** Shows a section (switching category when needed) and moves focus to its heading. */
  goTo: (section: SettingsSectionId) => void;
}

export const SettingsFormContext = createContext<SettingsFormValue | null>(null);

/** The Settings draft and the slices every section reads. */
export function useSettingsForm(): SettingsFormValue {
  const value = useContext(SettingsFormContext);
  if (!value) throw new Error('useSettingsForm must be used inside the Settings page');
  return value;
}
