import type {
  AgendaSlice,
  AppSlice,
  Configuration,
  ConnectionSlice,
  InterruptionChoice,
  IpcError,
  PromptKind,
  SettingsSlice,
  SliceMap,
} from '../../contract';
import { defaultConfiguration } from '../defaults';
import app from './app';

/** `PromptKind::label()` in crates/att-core/src/config.rs. */
const LABELS: Record<PromptKind, string> = {
  branch: 'Branch changes',
  meeting: 'Calendar meetings',
  microphone: 'Microphone meetings',
  microphoneEnd: 'Meeting ended',
  meetingReturn: 'Return after meetings',
  figma: 'Figma files',
  idle: 'Time away',
  forgottenTimer: 'Working without a timer',
  ticketCompletion: 'Completed tickets',
  trackingAttention: '7pace timer checks',
  dayReview: 'Day review',
  update: 'App updates',
};

/** The effective level per prompt kind, as the engine lists them (`settings.interruptions`). */
function interruptions(configuration: Configuration): InterruptionChoice[] {
  return (Object.keys(LABELS) as PromptKind[]).map((kind) => ({
    kind,
    label: LABELS[kind],
    level: configuration.interruptions[kind] ?? 'openPanel',
  }));
}

const configuration: Configuration = {
  ...defaultConfiguration(),
  organization: 'contoso',
  project: 'Webshop',
  sevenPaceUrl: 'https://contoso.timehub.7pace.com',
  activityTypeId: 'dev',
  interfaceSetupCompleted: true,
  interruptions: { trackingAttention: 'openAndFocus' },
  // Matches the selected calendars of the agenda sample (fixtures/slices/agenda.ts).
  selectedCalendarIds: ['cal-work', 'cal-team'],
  calendarEnabled: true,
  targets: {
    weeklyHours: 38,
    dailyHours: 7.6,
    hoursByWeekday: [0, 8, 8, 8, 8, 6, 0],
    belgianHolidaysEnabled: true,
    dateExceptions: [
      { id: '2026-11-02', kind: 'Full-day leave', hours: 0, note: 'Autumn break' },
      { id: '2026-12-24', kind: 'Half-day leave', hours: 0, note: '' },
    ],
  },
  repositories: [
    { id: '0f9a3c2e-5b7d-4e1a-8c6f-2d4b6a8c0e12', path: '/Users/sam/Documents/repositories/webshop', enabled: true },
    { id: '7c1e9b3a-2d4f-4a6b-9c8e-1f3a5b7d9e24', path: '/Users/sam/Documents/repositories/design-system', enabled: true },
  ],
};

/** What the engine's background lookup found on this Mac: Codex is not installed. */
const INSTALLED_APPS: Record<string, string | null> = {
  'com.microsoft.VSCode': 'Visual Studio Code',
  'com.apple.Terminal': 'Terminal',
  'com.googlecode.iterm2': 'iTerm',
  'com.todesktop.230313mzl4w4u92': 'Cursor',
  'com.openai.codex': null,
  'com.apple.dt.Xcode': 'Xcode',
};

function lookedUp(config: Configuration): SettingsSlice['workApps'] {
  return config.awareness.workAppIds.map((id) => {
    const name = INSTALLED_APPS[id];
    return name === undefined ? { id, name: null, installed: null } : { id, name, installed: name !== null };
  });
}

const IDLE_PAIRING: SettingsSlice['pairing'] = { pin: null, expiresAt: null, status: null, pairedHost: null, busy: false };

/** A configured workspace with stored credentials (the browser preview's Settings). */
export const configuredSettings: SettingsSlice = {
  configuration,
  hasAzurePat: true,
  hasSevenPaceToken: true,
  pairing: IDLE_PAIRING,
  microphone: {
    supported: true,
    owners: [],
    fresh: true,
    issue: null,
    status: 'Watching microphone status · checked every 2 seconds',
    checkedAt: '2026-10-06T08:02:14Z',
  },
  interruptions: interruptions(configuration),
  workApps: lookedUp(configuration),
};

/** First run: the Rust defaults, no credentials. */
export const unconfiguredSettings: SettingsSlice = {
  configuration: defaultConfiguration(),
  hasAzurePat: false,
  hasSevenPaceToken: false,
  pairing: IDLE_PAIRING,
  microphone: { supported: true, owners: [], fresh: false, issue: null },
  interruptions: interruptions(defaultConfiguration()),
  // Before the background lookup answered.
  workApps: defaultConfiguration().awareness.workAppIds.map((id) => ({ id, name: null, installed: null })),
};

/** The app slice of the first run: appearance onboarding instead of the app. */
export const onboardingApp: AppSlice = { ...app.app, onboarding: true, visiblePage: null };

/** The connection slice before anything is configured. */
export const unconfiguredConnection: ConnectionSlice = {
  health: 'unconfigured',
  indicator: 'disconnected',
  status: 'Set up accounts',
  detail: null,
  workspace: '',
  host: null,
  lastSync: null,
  worklogSync: null,
  connectionIssue: null,
  azureIssue: null,
  progressIssue: null,
  hasAzurePat: false,
  hasSevenPaceToken: false,
  connected: false,
  connecting: false,
};

/** Mobile PIN pairing: a PIN requested at the sample "now", valid for one minute. */
export const pairingInProgress: SettingsSlice = {
  ...configuredSettings,
  configuration: { ...configuration, sevenPaceAuthMode: 'mobilePIN' },
  hasSevenPaceToken: false,
  pairing: {
    pin: '482913',
    expiresAt: '2026-10-06T08:01:00Z',
    status: 'Enter this PIN in 7pace → Apps → Pair Mobile App. Waiting for approval…',
    pairedHost: null,
    busy: true,
  },
};

/** Pairing approved; the user still has to save. */
export const pairingComplete: SettingsSlice = {
  ...pairingInProgress,
  pairing: {
    pin: null,
    expiresAt: null,
    status: 'Paired with contoso.timehub.7pace.com. Save changes to use this connection.',
    pairedHost: 'contoso.timehub.7pace.com',
    busy: false,
  },
};

/** A configuration that breaks several of `Configuration::validate`'s rules. */
export const invalidConfiguration: Configuration = {
  ...configuration,
  sevenPaceUrl: 'http://contoso.7pace.com/api',
  awareness: { ...configuration.awareness, idleMinutes: 0 },
  dayReview: { ...configuration.dayReview, startMinute: 1020, finishMinute: 540, weekdays: [] },
  meetings: { ...configuration.meetings, defaultTicket: 'AB#12' },
};

export const invalidSettings: SettingsSlice = { ...configuredSettings, configuration: invalidConfiguration };

/** What `settings.save` rejects with when `Configuration::validate` fails. */
export const saveValidationError: IpcError = {
  kind: 'invalidSettings',
  message: 'Choose polling intervals within the ranges shown in Settings.',
};

/** Microphone diagnostics while Teams and a browser use the microphone. */
export const microphoneInUse: SettingsSlice['microphone'] = {
  supported: true,
  owners: [
    { id: 'com.microsoft.teams2', name: 'Microsoft Teams', pid: 812, path: null, category: 'Microsoft Teams' },
    { id: 'com.apple.WebKit.GPU', name: 'WebKit', pid: 913, path: null, category: 'Web browsers' },
    { id: 'com.apple.VoiceMemos', name: 'Voice Memos', pid: 1022, path: null, category: null },
  ],
  fresh: true,
  issue: null,
  status: 'Microphone in use: Microsoft Teams, WebKit, Voice Memos',
  checkedAt: '2026-10-06T08:02:14Z',
};

/** Calendar access granted with three calendars. */
export const sampleAgenda: AgendaSlice = {
  supported: true,
  access: 'authorized',
  enabled: true,
  calendars: [
    { id: 'cal-work', title: 'Work', color: '#2f6bd8', source: 'Exchange', selected: true },
    { id: 'cal-team', title: 'Team events', color: '#0e7c73', source: 'Exchange', selected: true },
    { id: 'cal-home', title: 'Home', color: '#c2357c', source: 'iCloud', selected: false },
  ],
  day: '2026-10-06',
  events: [],
  issue: null,
};

/** Calendar access not requested yet. */
export const agendaNotDetermined: AgendaSlice = { ...sampleAgenda, access: 'notDetermined', enabled: false, calendars: [] };

export default {
  settings: configuredSettings,
} satisfies Partial<SliceMap>;
