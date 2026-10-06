import { Button } from '../../components/Button';
import { LoadingRegion, Skeleton } from '../../components/EmptyState';
import { TextField } from '../../components/Fields';
import { CheckIcon, InfoIcon } from '../../components/icons';
import { Select } from '../../components/Pickers';
import { Checkbox, Switch } from '../../components/Toggles';
import type { CalendarChoice, MicrophoneApp } from '../../ipc/contract';
import { useAction, useSlice } from '../../state/hooks';
import { calendarAccessText, classifyMicrophoneOwner, MICROPHONE_APPS, microphoneAppLabel } from './labels';
import { Divider, Hint, InlineIssue, SettingsGroup, SettingsSection } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { activityOptions, DEFAULT_ACTIVITY_KEY } from './TrackingSection';
import { issueFor } from './validation';
import styles from './settings.module.css';

/** 1.14 `CalendarChoices`: none checked shows every calendar. */
function CalendarChoices({ calendars }: { calendars: readonly CalendarChoice[] }) {
  const { draft, update } = useSettingsForm();
  const selected = new Set(draft.selectedCalendarIds);
  const toggle = (id: string, on: boolean) =>
    update((current) => ({
      ...current,
      selectedCalendarIds: on
        ? current.selectedCalendarIds.includes(id)
          ? current.selectedCalendarIds
          : [...current.selectedCalendarIds, id]
        : current.selectedCalendarIds.filter((entry) => entry !== id),
    }));
  if (calendars.length === 0) return <Hint>No calendars were found on this Mac.</Hint>;
  return (
    <fieldset className={styles.fieldset}>
      <legend className={styles.legend}>Calendars</legend>
      <Hint>Leave all unchecked to show every calendar.</Hint>
      <div className={styles.checkGrid}>
        {calendars.map((calendar) => (
          <Checkbox key={calendar.id} isSelected={selected.has(calendar.id)} onChange={(on) => toggle(calendar.id, on)}>
            <span className={styles.calendarLabel}>
              {calendar.color ? <span aria-hidden="true" className={styles.swatch} style={{ background: calendar.color }} /> : null}
              {calendar.source ? `${calendar.title} · ${calendar.source}` : calendar.title}
            </span>
          </Checkbox>
        ))}
      </div>
    </fieldset>
  );
}

/** Settings → Meetings → Apple Calendar (1.14 `calendarSection`). macOS only. */
export function CalendarSection() {
  const { draft, update, preview } = useSettingsForm();
  const agenda = useSlice('agenda');
  const enable = useAction();
  return (
    <SettingsSection id="calendar" subtitle="Calendar events stay on your Mac and are never sent to Azure or 7pace.">
      <Switch isSelected={draft.calendarEnabled} onChange={(calendarEnabled) => update((current) => ({ ...current, calendarEnabled }))}>
        Show my Apple Calendar agenda
      </Switch>
      <LoadingRegion label="Loading calendars" isLoading={agenda === undefined} placeholder={<Skeleton lines={3} />}>
        {agenda ? (
          agenda.access === 'authorized' ? (
            <>
              <p className={styles.status}>
                <CheckIcon className={styles.statusIcon} />
                <span>{calendarAccessText(agenda.access)}</span>
              </p>
              <CalendarChoices calendars={agenda.calendars} />
            </>
          ) : (
            <>
              <p className={styles.status}>
                <InfoIcon className={styles.statusIcon} />
                <span>{calendarAccessText(agenda.access)}</span>
              </p>
              {agenda.access !== 'unsupported' ? (
                <div className={styles.row}>
                  <Button
                    onPress={() => void enable.run({ type: 'settings.enableCalendar' })}
                    isDisabled={preview}
                    isPending={enable.pending}
                  >
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
    </SettingsSection>
  );
}

/** Settings → Meetings → Meeting suggestions (1.14 `meetingSection`). macOS only. */
export function MeetingSuggestionsSection() {
  const { draft, update, issues } = useSettingsForm();
  const agenda = useSlice('agenda');
  const flow = useSlice('flow');
  const ticketIssue = issueFor(issues, 'defaultTicket');
  const meetings = draft.meetings;
  const calendarReady = draft.calendarEnabled && agenda?.access === 'authorized';
  return (
    <SettingsSection id="meetings">
      <Switch
        isSelected={meetings.enabled}
        onChange={(enabled) => update((current) => ({ ...current, meetings: { ...current.meetings, enabled } }))}
      >
        Suggest tracking when a meeting starts
      </Switch>
      <Hint>
        Uses your selected Apple calendars. Timed events open a suggestion once; all-day, declined, canceled, and free events are
        skipped. Your timer changes only after you confirm Start.
      </Hint>
      {!calendarReady ? (
        <InlineIssue tone="warning">Enable Apple Calendar access in the section above to receive meeting suggestions.</InlineIssue>
      ) : null}
      <TextField
        label="Default meeting ticket"
        description="Optional fallback when the meeting has no ticket. Put #33984 in its title or an Azure work-item link in its title, URL, or notes to link a specific ticket."
        placeholder="Choose a ticket for each meeting"
        value={meetings.defaultTicket}
        onChange={(defaultTicket) => update((current) => ({ ...current, meetings: { ...current.meetings, defaultTicket } }))}
        isInvalid={ticketIssue !== undefined}
        errorMessage={ticketIssue}
        inputMode="numeric"
        width="narrow"
        autoComplete="off"
      />
      <Select
        label="Meeting activity"
        items={activityOptions(flow?.activityTypes ?? [], 'Suggest Stand-up or Overleg / Meeting', meetings.activityTypeId)}
        selectedKey={meetings.activityTypeId === '' ? DEFAULT_ACTIVITY_KEY : meetings.activityTypeId}
        onSelectionChange={(key) =>
          update((current) => ({
            ...current,
            meetings: { ...current.meetings, activityTypeId: key === DEFAULT_ACTIVITY_KEY || key === null ? '' : String(key) },
          }))
        }
        width="narrow"
      />
      <Hint>
        The suggested ticket and activity can both be changed before starting. When a meeting timer ends, the app offers to resume
        your previous ticket and activity.
      </Hint>
    </SettingsSection>
  );
}

function MicrophoneDiagnostics({ apps }: { apps: readonly MicrophoneApp[] }) {
  const { settings, app, draft } = useSettingsForm();
  const diagnostics = settings.microphone;
  const available = diagnostics.supported && (app?.features.microphone ?? true);
  const watching = settings.configuration.microphone.enabled;
  let status: string;
  if (!available) status = 'Microphone detection is not available on this system.';
  else if (!watching) status = 'Microphone meeting suggestions are off';
  else if (diagnostics.owners.length > 0) status = `Microphone in use: ${diagnostics.owners.map((owner) => owner.name).join(', ')}`;
  else if (diagnostics.fresh) status = `Watching microphone status · checked every ${draft.cadences.probeSeconds} seconds`;
  else status = 'Waiting for the first microphone check…';
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
              <span className={styles.listMeta}>{apps.includes(classifyMicrophoneOwner(owner.id)) ? 'Selected' : 'Ignored'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsGroup>
  );
}

/** Settings → Meetings → Microphone meetings (1.14 `MicrophoneSettings`). */
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
      <Switch
        isSelected={preferences.enabled}
        isDisabled={unavailable}
        onChange={(enabled) => update((current) => ({ ...current, microphone: { ...current.microphone, enabled } }))}
      >
        Suggest tracking when an app uses my microphone
      </Switch>
      <Hint>
        Select the apps to watch. Suggestions appear after 4 seconds of input use. Choose an activity and confirm before your timer
        changes.
      </Hint>
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
