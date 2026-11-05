/**
 * The accounts die Keure uses, suggested while the accounts are being set up (Settings → Azure
 * DevOps & 7pace on the first run). They are only defaults: the fields stay editable, and a
 * value the user already saved is never replaced.
 */
import type { Configuration } from '../../ipc/contract';

export const ACCOUNT_DEFAULTS = {
  organization: 'diekeure-webdev',
  project: 'LK2020',
  sevenPaceUrl: 'https://diekeure-webdev.timehub.7pace.com',
} as const satisfies Partial<Configuration>;

const blank = (value: string) => value.trim() === '';

/** No 7pace workspace is saved yet: the app cannot track, so setup is unfinished. */
export function accountSetupUnfinished(configuration: Configuration): boolean {
  return blank(configuration.sevenPaceUrl);
}

/**
 * `configuration` with the defaults in its empty account fields. The 7pace workspace is filled in
 * while none is saved. The Azure organization and project only while nothing at all is saved: a
 * 7pace-only setup without Azure, or a project left empty on purpose, stays as it is.
 */
export function withAccountDefaults(configuration: Configuration): Configuration {
  if (!accountSetupUnfinished(configuration)) return configuration;
  const result = { ...configuration, sevenPaceUrl: ACCOUNT_DEFAULTS.sevenPaceUrl };
  if (blank(configuration.organization)) {
    result.organization = ACCOUNT_DEFAULTS.organization;
    if (blank(configuration.project)) result.project = ACCOUNT_DEFAULTS.project;
  }
  return result;
}
