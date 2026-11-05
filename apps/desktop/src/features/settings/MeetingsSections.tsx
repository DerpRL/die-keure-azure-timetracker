import type { ReactNode } from 'react';
import { Button } from '../../components/Button';
import { LoadingRegion, Skeleton } from '../../components/EmptyState';
import { TextField } from '../../components/Fields';
import { CheckIcon, InfoIcon } from '../../components/icons';
import { Select } from '../../components/Pickers';
import { Checkbox, Switch } from '../../components/Toggles';
import type { CalendarChoice, MicrophoneApp } from '../../ipc/contract';
import { useAction, useSlice } from '../../state/hooks';
import { calendarAccessText, formatTime, MICROPHONE_APPS, microphoneAppLabel } from './labels';
import { Divider, Hint, InlineIssue, SettingsGroup, SettingsSection, ToggleRow } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { activityOptions, DEFAULT_ACTIVITY_KEY } from './TrackingSection';
import { issueFor } from './validation';
import styles from './settings.module.css';

/**
 * Whether Today shows a calendar. `selectedCalendarIds` lists the chosen calendars; none chosen
 * means every calendar (1.14 `CalendarChoices`).
 */
export function calendarShown(selectedIds: readonly string[], id: string): boolean {
  return selectedIds.length === 0 || selectedIds.includes(id);
}

/**
 * Shows or hides one calendar. Turning one off while all are shown chooses all the others;
 * choosing every calendar again stores "none chosen" (all), so new calendars keep appearing.
 */
export function setCalendarShown(selectedIds: readonly string[], allIds: readonly string[], id: string, shown: boolean): string[] {
  const current = selectedIds.length === 0 ? [...allIds] : [...selectedIds];
  const next = shown ? (current.includes(id) ? current : [...current, id]) : current.filter((entry) => entry !== id);
  return allIds.length > 0 && allIds.every((entry) => next.includes(entry)) ? [] : next;
}

function calendarName(calendar: CalendarChoice): string {
  return calendar.source ? `${calendar.title} · ${calendar.source}` : calendar.title;
}

/** One switch per calendar (Sources overview and Calendars): which calendars Today shows. */
export function CalendarSwitches({ calendars }: { calendars: readonly CalendarChoice[] }) {
  const { draft, update } = useSettingsForm();
  const allIds = calendars.map((calendar) => calendar.id);
  if (calendars.length === 0) return <Hint>No calendars were found on this Mac.</Hint>;
  return (
    <ul role="list" aria-label="Calendars" className={styles.calendarList}>
      {calendars.map((calendar) => {
        const shown = calendarShown(draft.selectedCalendarIds, calendar.id);
        return (
          <li key={calendar.id} className={styles.calendarRow}>
            <span aria-hidden="true" className={styles.swatch} style={calendar.color ? { background: calendar.color } : undefined} />
            <span className={shown ? styles.calendarName : `${styles.calendarName} ${styles.muted}`}>{calendarName(calendar)}</span>
            <Switch
              aria-label={calendarName(calendar)}
              isSelected={shown}
              onChange={(on) =>
                update((current) => ({ ...current, selectedCalendarIds: setCalendarShown(current.selectedCalendarIds, allIds, calendar.id, on) }))
              }
            >
              {null}
            </Switch>
          </li>
        );
      })}
    </ul>
  );
}

/** Calendar access: the status line and "Allow calendar access…" until it is granted. */
export function CalendarAccess({ children }: { children?: ReactNode }) {
  const { preview } = useSettingsForm();
  const agenda = useSlice('agenda');
  const enable = useAction();
  return (
    <LoadingRegion label="Loading calendars" isLoading={agenda === undefined} placeholder={<Skeleton lines={3} />}>
      {agenda ? (
        agenda.access === 'authorized' ? (
          children
        ) : (
          <>
            <p className={styles.status}>
              <InfoIcon className={styles.statusIcon} />
              <span>{calendarAccessText(agenda.access)}</span>
            </p>
            {agenda.access !== 'unsupported' ? (
              <div className={styles.row}>
                <Button onPress={() => void enable.run({ type: 'settings.enableCalendar' })} isDisabled={preview} isPending={enable.pending}>
                  Allow calendar access…
                </Button>
              </div>
            ) : null}
          </>
        )
      ) : null}
      {agenda?.issue ? <InlineIssue tone="warning">{agenda.issue}</InlineIssue> : null}
      {enable.error ? <InlineIssue>{enable.error.message}</InlineIssue> : null}
    </LoadingRegion>
  );
}

/** Settings → Calendars: the calendar on Today, access and which calendars it shows. macOS only. */
export function CalendarSection() {
  const { draft, update } = useSettingsForm();
  const agenda = useSlice('agenda');
  return (
    <SettingsSection id="calendar" subtitle="Calendar events stay on your Mac and are never sent to Azure or 7pace.">
      <ToggleRow
        title="Show my calendar on Today"
        help="Meetings appear next to your tracked time and can suggest Meeting tracking."
        isSelected={draft.calendarEnabled}
        onChange={(calendarEnabled) => update((current) => ({ ...current, calendarEnabled }))}
      />
      <CalendarAccess>
        <p className={styles.status}>
          <CheckIcon className={styles.statusIcon} />
          <span>{calendarAccessText(agenda?.access ?? 'authorized')}</span>
        </p>
        <CalendarSwitches calendars={agenda?.calendars ?? []} />
        <Hint>Every calendar is shown until you turn one off.</Hint>
      </CalendarAccess>
    </SettingsSection>
  );
}

/** Settings → Targets & reminders → Meetings (1.14 `meetingSection`). macOS only. */
export function MeetingSuggestionsSection() {
  const { draft, update, issues } = useSettingsForm();
  const agenda = useSlice('agenda');
  const flow = useSlice('flow');
  const ticketIssue = issueFor(issues, 'defaultTicket');
  const meetings = draft.meetings;
  const calendarReady = draft.calendarEnabled && agenda?.access === 'authorized';
  return (
    <SettingsSection id="meetings">
      <ToggleRow
        title="Suggest tracking when a calendar meeting starts"
        help="Asks first. Your timer never switches on its own. All-day, declined, canceled and free events are skipped."
        isSelected={meetings.enabled}
        onChange={(enabled) => update((current) => ({ ...current, meetings: { ...current.meetings, enabled } }))}
      />
      {!calendarReady ? (
        <InlineIssue tone="warning">Turn on the calendar and allow access under Sources → Calendars to receive meeting suggestions.</InlineIssue>
      ) : null}
      <div className={styles.fieldPair}>
        <Select
          label="Default activity"
          items={activityOptions(flow?.activityTypes ?? [], 'Suggest Stand-up or Overleg / Meeting', meetings.activityTypeId)}
          selectedKey={meetings.activityTypeId === '' ? DEFAULT_ACTIVITY_KEY : meetings.activityTypeId}
          onSelectionChange={(key) =>
            update((current) => ({
              ...current,
              meetings: { ...current.meetings, activityTypeId: key === DEFAULT_ACTIVITY_KEY || key === null ? '' : String(key) },
            }))
          }
        />
        <TextField
          label="Default meeting ticket"
          description="For meetings without a ticket. Put #33984 or an Azure work-item link in a meeting to use that ticket instead."
          placeholder="Choose a ticket for each meeting"
          value={meetings.defaultTicket}
          onChange={(defaultTicket) => update((current) => ({ ...current, meetings: { ...current.meetings, defaultTicket } }))}
          isInvalid={ticketIssue !== undefined}
          errorMessage={ticketIssue}
          inputMode="numeric"
          autoComplete="off"
        />
      </div>
      <Hint>Both can be changed before starting. When a meeting timer ends, the app offers to resume your previous ticket.</Hint>
    </SettingsSection>
  );
}

function MicrophoneDiagnostics({ apps }: { apps: readonly MicrophoneApp[] }) {
  const { settings, app } = useSettingsForm();
  const check = useAction();
  const diagnostics = settings.microphone;
  const available = diagnostics.supported && (app?.features.microphone ?? true);
  const watching = settings.configuration.microphone.enabled;
  let status: string;
  if (!available) status = 'Microphone detection is not available on this system.';
  else if (!watching) status = 'Microphone meeting suggestions are off';
  else status = diagnostics.status ?? 'Waiting for the first microphone check…';
  return (
    <SettingsGroup title="Diagnostics">
      <p className={styles.status}>
        {available && watching && diagnostics.fresh ? <CheckIcon className={styles.statusIcon} /> : <InfoIcon className={styles.statusIcon} />}
        <span>{status}</span>
      </p>
      {diagnostics.issue ? <InlineIssue tone="warning">{diagnostics.issue}</InlineIssue> : null}
      {diagnostics.owners.length > 0 ? (
        <ul role="list" aria-label="Apps using the microphone" className={styles.list}>
          {diagnostics.owners.map((owner) => (
            <li key={owner.id} className={styles.listItem}>
              <span className={styles.listText}>
                <span>{owner.name}</span>
                <span className={styles.listMeta}>{owner.id}</span>
              </span>
              <span className={styles.listMeta}>{owner.category && apps.includes(owner.category) ? 'Selected' : 'Ignored'}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.row}>
        <Button
          size="small"
          onPress={() => void check.run({ type: 'microphone.checkNow' })}
          isDisabled={!available || !watching}
          isPending={check.pending}
        >
          {check.pending ? 'Checking…' : 'Check now'}
        </Button>
        {diagnostics.checkedAt ? <span className={styles.listMeta}>Checked {formatTime(diagnostics.checkedAt)}</span> : null}
      </div>
      {check.error ? <InlineIssue tone="warning">{check.error.message}</InlineIssue> : null}
    </SettingsGroup>
  );
}

/** Settings → Targets & reminders → Microphone meetings (1.14 `MicrophoneSettings`). */
export function MicrophoneSection() {
  const { draft, update, os, app } = useSettingsForm();
  const preferences = draft.microphone;
  const unavailable = app?.features.microphone === false;
  const toggleApp = (target: MicrophoneApp, on: boolean) =>
    update((current) => {
      const apps = current.microphone.apps.filter((entry) => entry !== target);
      // Keep the settings order, like Swift's `Set` round trip through `allCases`.
      const next = on ? MICROPHONE_APPS.filter((entry) => entry === target || apps.includes(entry)) : apps;
      return { ...current, microphone: { ...current.microphone, apps: next } };
    });
  return (
    <SettingsSection id="microphone" subtitle="Meeting detection from apps that use your microphone.">
      <ToggleRow
        title="Suggest tracking when an app uses my microphone"
        help="Select the apps to watch. Suggestions appear after 4 seconds of input use. Choose an activity and confirm before your timer changes."
        isSelected={preferences.enabled}
        isDisabled={unavailable}
        onChange={(enabled) => update((current) => ({ ...current, microphone: { ...current.microphone, enabled } }))}
      />
      <fieldset className={styles.fieldset} disabled={!preferences.enabled || unavailable}>
        <legend className={styles.legend}>Apps to watch</legend>
        <div className={styles.checkGrid}>
          {MICROPHONE_APPS.map((entry) => (
            <Checkbox
              key={entry}
              isSelected={preferences.apps.includes(entry)}
              isDisabled={!preferences.enabled || unavailable}
              onChange={(on) => toggleApp(entry, on)}
            >
              {microphoneAppLabel(entry)}
            </Checkbox>
          ))}
        </div>
      </fieldset>
      <Hint>
        {os === 'windows'
          ? 'Google Meet and other browser calls appear as Chrome, Edge, Firefox, etc. Some appear as Microsoft Edge WebView2. '
          : 'Google Meet and other browser calls appear as Chrome, Safari, Edge, etc. Some appear as WebKit (browser or web view). '}
        Microphone use cannot identify a meeting, tab, Slack channel, or stand-up by itself. Dictation and recordings can also
        trigger a suggestion. Calls started while muted may not be detected until input becomes active.
      </Hint>
      <Hint>
        After 60 seconds without microphone use in the selected apps, the app offers to pause or stop tracking, even if there is no
        previous ticket. Returning to previous work is also available when applicable. Muting can also cause this reminder; the timer
        only changes when you confirm.
      </Hint>
      <Divider />
      <MicrophoneDiagnostics apps={preferences.apps} />
      <Hint>
        {os === 'windows'
          ? 'Save changes to apply them. Reads which apps use the microphone from Windows privacy settings only; no audio recording, Slack tokens, workspace IDs, or channel IDs.'
          : 'Save changes to apply them. Requires macOS 14.2 or later. Reads local audio status only; no audio recording, Slack tokens, workspace IDs, or channel IDs.'}
      </Hint>
    </SettingsSection>
  );
}
