/** User-facing strings and small display mappings for Settings (1.14 wording where it exists). */
import type { CalendarAccess, HostOs, Interruption, MicrophoneApp } from '../../ipc/contract';

export interface OsWords {
  /** "macOS" / "Windows". */
  name: string;
  /** "Mac" / "PC". */
  device: string;
  /** Where credentials are kept. */
  credentials: string;
  /** Where the app lives when its window is closed. */
  trayPlace: string;
}

export function osWords(os: HostOs | undefined): OsWords {
  if (os === 'windows') {
    return { name: 'Windows', device: 'PC', credentials: 'Windows Credential Manager', trayPlace: 'notification area' };
  }
  return { name: 'macOS', device: 'Mac', credentials: 'Keychain', trayPlace: 'menu bar' };
}

export const INTERRUPTION_LEVELS: ReadonlyArray<{ id: Interruption; label: string; description: string }> = [
  { id: 'off', label: 'Off', description: 'Listed in the panel and on Overview only.' },
  { id: 'notifyOnly', label: 'Notify only', description: 'Shows a notification without opening the panel.' },
  { id: 'openPanel', label: 'Open panel', description: 'Opens the panel without taking keyboard focus. The default.' },
  {
    id: 'openAndFocus',
    label: 'Open and focus',
    description: 'Opens the panel and moves keyboard focus to it, as Azure timetracker 1.x did.',
  },
];

export function interruptionLabel(level: Interruption): string {
  return INTERRUPTION_LEVELS.find((entry) => entry.id === level)?.label ?? level;
}

/** 1.14 "Refresh 7pace" picker. */
export const POLL_LABELS: Record<number, string> = {
  30: 'Every 30 seconds',
  60: 'Every minute',
  120: 'Every 2 minutes',
  300: 'Every 5 minutes',
};

/** `MicrophoneApp::ALL` in settings order. */
export const MICROPHONE_APPS: readonly MicrophoneApp[] = [
  'Slack',
  'Microsoft Teams',
  'Zoom',
  'Web browsers',
  'Webex',
  'Discord',
  'FaceTime',
  'Other apps',
];

/** `MicrophoneApp::label`. */
export function microphoneAppLabel(app: MicrophoneApp): string {
  return app === 'Web browsers' ? 'Google Meet / web browsers' : app;
}

const BROWSER_BUNDLES = [
  'com.apple.safari',
  'com.google.chrome',
  'com.microsoft.edgemac',
  'org.mozilla.firefox',
  'com.brave.browser',
  'company.thebrowser.browser',
  'com.operasoftware.opera',
];

const EXECUTABLES: Record<string, MicrophoneApp> = {
  'slack.exe': 'Slack',
  'ms-teams.exe': 'Microsoft Teams',
  'teams.exe': 'Microsoft Teams',
  'msteams.exe': 'Microsoft Teams',
  'zoom.exe': 'Zoom',
  'chrome.exe': 'Web browsers',
  'msedge.exe': 'Web browsers',
  'firefox.exe': 'Web browsers',
  'brave.exe': 'Web browsers',
  'opera.exe': 'Web browsers',
  'vivaldi.exe': 'Web browsers',
  'arc.exe': 'Web browsers',
  'msedgewebview2.exe': 'Web browsers',
  'webex.exe': 'Webex',
  'ciscocollabhost.exe': 'Webex',
  'atmgr.exe': 'Webex',
  'discord.exe': 'Discord',
};

/**
 * `MicrophoneApp::classify` (crates/att-core/src/microphone.rs), only to label diagnostics as
 * "Selected" or "Ignored". The engine decides which sessions suggest anything.
 */
export function classifyMicrophoneOwner(ownerId: string): MicrophoneApp {
  const id = ownerId.toLowerCase();
  const matches = (prefix: string) => id === prefix || (id.startsWith(prefix) && id.charAt(prefix.length) === '.');
  if (matches('com.tinyspeck.slackmacgap')) return 'Slack';
  if (matches('com.microsoft.teams') || matches('com.microsoft.teams2')) return 'Microsoft Teams';
  if (matches('us.zoom.xos')) return 'Zoom';
  if (BROWSER_BUNDLES.some(matches)) return 'Web browsers';
  if (matches('com.cisco.webexmeetingsapp') || matches('com.cisco.webexteams')) return 'Webex';
  if (matches('com.hnc.discord')) return 'Discord';
  if (matches('com.apple.webkit')) return 'Web browsers';
  if (matches('com.apple.facetime')) return 'FaceTime';
  const name = id.split(/[\\/]/).pop() ?? id;
  return name.endsWith('.exe') ? (EXECUTABLES[name] ?? 'Other apps') : 'Other apps';
}

/** Names for the default work apps (1.14 `WorkAwarenessSettings.appName` plus the Windows defaults). */
const WORK_APP_NAMES: Record<string, string> = {
  'com.microsoft.VSCode': 'Visual Studio Code',
  'com.apple.Terminal': 'Terminal',
  'com.googlecode.iterm2': 'iTerm2',
  'com.todesktop.230313mzl4w4u92': 'Cursor',
  'com.openai.codex': 'Codex',
  'com.apple.dt.Xcode': 'Xcode',
  'code.exe': 'Visual Studio Code',
  'cursor.exe': 'Cursor',
  'windowsterminal.exe': 'Windows Terminal',
  'pwsh.exe': 'PowerShell',
  'powershell.exe': 'Windows PowerShell',
  'devenv.exe': 'Visual Studio',
};

export function workAppName(id: string): string {
  return WORK_APP_NAMES[id] ?? WORK_APP_NAMES[id.toLowerCase()] ?? id;
}

/** What the calendar permission state means, for the Calendar section. */
export function calendarAccessText(access: CalendarAccess): string {
  switch (access) {
    case 'authorized':
      return 'Calendar access is allowed.';
    case 'notDetermined':
      return 'Calendar access has not been requested yet.';
    case 'denied':
      return 'Calendar access is turned off. Allow Azure timetracker in System Settings → Privacy & Security → Calendars.';
    case 'restricted':
      return 'Calendar access is restricted on this Mac.';
    case 'unsupported':
      return 'Calendars are not available on this system.';
  }
}

/** `FigmaService.status` from 1.14, for the engine's observation codes. */
export function figmaStatusText(status: string, currentFile: string | null): string {
  switch (status) {
    case 'missingAccess':
      return 'Accessibility permission needed';
    case 'noAddress':
      return 'Figma is active · no file address found';
    case 'file':
      return currentFile ? `File: ${currentFile}` : 'Figma is active';
    case 'notForeground':
    case 'waiting':
      return 'Waiting for Figma';
    default:
      return status;
  }
}

/** "18:00" for minutes after midnight. */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** "6 Oct 2026, 10:00:00" (1.14 `.formatted(date: .abbreviated, time: .standard)`). */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_TIME.format(date);
}

/** "10:01:00". */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : TIME.format(date);
}
