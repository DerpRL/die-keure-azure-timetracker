import { useState, type ReactNode } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { LoadingRegion, Skeleton } from '../../components/EmptyState';
import { TextField } from '../../components/Fields';
import { CheckIcon, ExternalLinkIcon } from '../../components/icons';
import { Select } from '../../components/Pickers';
import { Checkbox } from '../../components/Toggles';
import type { CalendarChoice, MicrophoneApp } from '../../ipc/contract';
import { openSystemSettings, type SystemSettingsPane } from '../../ipc/shell';
import { useAction, useSlice } from '../../state/hooks';
import { LockIcon } from './icons';
import { calendarAccessText, formatTime, MICROPHONE_APPS, microphoneAppLabel, osWords } from './labels';
import {
  FullRow,
  Hint,
  InlineIssue,
  IssueRow,
  SectionFooter,
  SettingRow,
  SettingsGroup,
  SettingsSection,
  ToggleRow,
} from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { activityOptions, DEFAULT_ACTIVITY_KEY } from './TrackingSection';
import { issueFor } from './validation';
import { t } from '../../i18n';
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


/** One checkbox per calendar (Sources overview and Calendars): which calendars Today shows. */
export function CalendarSwitches({ calendars, variant = 'rows' }: { calendars: readonly CalendarChoice[]; variant?: 'rows' | 'compact' }) {
  const { draft, update, os } = useSettingsForm();
  const allIds = calendars.map((calendar) => calendar.id);
  if (calendars.length === 0) {
    return (
      <FullRow>
        <Hint>{t('No calendars were found on this {device}.', { device: osWords(os).device })}</Hint>
      </FullRow>
    );
  }
  return (
    <ul role="list" aria-label={t('Calendars')} className={variant === 'rows' ? styles.rowList : styles.calendarList}>
      {calendars.map((calendar) => {
        const shown = calendarShown(draft.selectedCalendarIds, calendar.id);
        return (
          <li key={calendar.id} className={variant === 'rows' ? styles.checkRow : styles.calendarRow}>
            <Checkbox
              isSelected={shown}
              onChange={(on) =>
                update((current) => ({ ...current, selectedCalendarIds: setCalendarShown(current.selectedCalendarIds, allIds, calendar.id, on) }))
              }
              className={styles.calendarCheck}
            >
              <span aria-hidden="true" className={styles.swatch} style={calendar.color ? { background: calendar.color } : undefined} />
              <span className={styles.calendarName}>{calendar.title}</span>
              {calendar.source ? <span className={styles.listMeta}>{` · ${calendar.source}`}</span> : null}
            </Checkbox>
          </li>
        );
      })}
    </ul>
  );
}

/** Calendar access: the status and "Allow calendar access…" until it is granted. */
export function CalendarAccess({ children }: { children?: ReactNode }) {
  const { preview } = useSettingsForm();
  const agenda = useSlice('agenda');
  const enable = useAction();
  return (
    <LoadingRegion label={t('Loading calendars')} isLoading={agenda === undefined} placeholder={<Skeleton lines={3} />}>
      {agenda ? (
        agenda.access === 'authorized' ? (
          children
        ) : (
          <SettingRow title={t('Calendar access')} help={calendarAccessText(agenda.access)}>
            {agenda.access !== 'unsupported' ? (
              <Button size="small" onPress={() => void enable.run({ type: 'settings.enableCalendar' })} isDisabled={preview} isPending={enable.pending}>
                {t('Allow calendar access…')}
              </Button>
            ) : null}
          </SettingRow>
        )
      ) : null}
      {agenda?.issue ? <IssueRow tone="warning">{agenda.issue}</IssueRow> : null}
      {enable.error ? <IssueRow>{enable.error.message}</IssueRow> : null}
    </LoadingRegion>
  );
}

/** "Open System Settings" (or Windows Settings) at a privacy pane. */
export function SystemSettingsButton({ pane }: { pane: SystemSettingsPane }) {
  const { os } = useSettingsForm();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        size="small"
        trailingIcon={ExternalLinkIcon}
        onPress={() => {
          setError(null);
          openSystemSettings(pane).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
        }}
      >
        {os === 'windows' ? t('Open Windows Settings') : t('Open System Settings')}
      </Button>
      {error ? <InlineIssue>{error}</InlineIssue> : null}
    </>
  );
}

/** Settings → Calendars → Access: whether the app may read calendars, and the calendar on Today. */
export function CalendarSection() {
  const { draft, update, os } = useSettingsForm();
  const words = osWords(os);
  return (
    <SettingsSection id="calendar" title={t('Access')}>
      <CalendarAccess>
        <SettingRow
          title={t('Calendar access')}
          help={os === 'windows' ? t('Uses the calendars on this PC.') : t('Uses the calendars in macOS Calendar, including Exchange.')}
        >
          <Badge tone="success" icon={CheckIcon}>
            {t('Allowed')}
          </Badge>
          <SystemSettingsButton pane="calendars" />
        </SettingRow>
      </CalendarAccess>
      <ToggleRow
        title={t('Show events on Today')}
        help={t('Next to your time blocks, in a lighter style. Events stay on this {device}.', { device: words.device })}
        isSelected={draft.calendarEnabled}
        onChange={(calendarEnabled) => update((current) => ({ ...current, calendarEnabled }))}
      />
    </SettingsSection>
  );
}

/** Settings → Calendars → Calendars: which calendars Today shows and meetings come from. */
export function CalendarListSection() {
  const { draft, os } = useSettingsForm();
  const agenda = useSlice('agenda');
  const calendars = agenda?.calendars ?? [];
  const shown = calendars.filter((calendar) => calendarShown(draft.selectedCalendarIds, calendar.id)).length;
  if (agenda?.access !== 'authorized') return null;
  return (
    <SettingsSection
      id="calendarList"
      subtitle={t('Choose which ones show on Today and count as meetings.')}
      actions={calendars.length > 0 ? <span className={styles.listMeta}>{t('{count} of {total} shown', { count: shown, total: calendars.length })}</span> : null}
    >
      <CalendarSwitches calendars={calendars} />
      <SectionFooter>
        <LockIcon />
        <span>{t('Events never leave this {device}. Every calendar is shown until you turn one off.', { device: osWords(os).device })}</span>
      </SectionFooter>
    </SettingsSection>
  );
}

/** Settings → Meetings → Calendar meetings (1.14 `meetingSection`). macOS only. */
export function MeetingSuggestionsSection() {
  const { draft, update, issues, goTo } = useSettingsForm();
  const agenda = useSlice('agenda');
  const flow = useSlice('flow');
  const ticketIssue = issueFor(issues, 'defaultTicket');
  const meetings = draft.meetings;
  const calendarReady = draft.calendarEnabled && agenda?.access === 'authorized';
  return (
    <SettingsSection
      id="meetings"
      subtitle={t('Uses the calendars you chose under Calendars.')}
      actions={
        <Button size="small" variant="plain" onPress={() => goTo('calendarList')}>
          {t('Choose calendars')}
        </Button>
      }
    >
      <ToggleRow
        title={t('Suggest tracking when a meeting starts')}
        help={t('Asks first. All-day, declined, canceled and free events are skipped.')}
        isSelected={meetings.enabled}
        onChange={(enabled) => update((current) => ({ ...current, meetings: { ...current.meetings, enabled } }))}
      />
      {!calendarReady ? (
        <IssueRow tone="warning">{t('Turn on the calendar and allow access under Sources → Calendars to receive meeting suggestions.')}</IssueRow>
      ) : null}
      <SettingRow title={t('Activity')} help={t('The 7pace activity for meeting time. You can change it before starting.')}>
        {({ helpId }) => (
          <Select
            label={t('Meeting activity')}
            hideLabel
            aria-describedby={helpId}
            items={activityOptions(flow?.activityTypes ?? [], t('Suggest Stand-up or Overleg / Meeting'), meetings.activityTypeId)}
            selectedKey={meetings.activityTypeId === '' ? DEFAULT_ACTIVITY_KEY : meetings.activityTypeId}
            onSelectionChange={(key) =>
              update((current) => ({
                ...current,
                meetings: { ...current.meetings, activityTypeId: key === DEFAULT_ACTIVITY_KEY || key === null ? '' : String(key) },
              }))
            }
            className={styles.fieldMedium}
          />
        )}
      </SettingRow>
      <SettingRow
        title={t('Default ticket')}
        help={t('Used when the meeting does not mention a ticket. Put #33984 or an Azure work-item link in a meeting to use that ticket instead.')}
      >
        {({ helpId }) => (
          <TextField
            label={t('Default meeting ticket')}
            hideLabel
            aria-describedby={helpId}
            placeholder={t('Ask for each meeting')}
            value={meetings.defaultTicket}
            onChange={(defaultTicket) => update((current) => ({ ...current, meetings: { ...current.meetings, defaultTicket } }))}
            isInvalid={ticketIssue !== undefined}
            errorMessage={ticketIssue}
            inputMode="numeric"
            autoComplete="off"
            className={styles.fieldMedium}
          />
        )}
      </SettingRow>
      <ToggleRow
        title={t('Resume the previous ticket afterwards')}
        help={t('When a meeting timer ends, offer to continue what you tracked before.')}
        isSelected={draft.resumeAfterMeetings}
        onChange={(resumeAfterMeetings) => update((current) => ({ ...current, resumeAfterMeetings }))}
      />
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
  if (!available) status = t('Microphone detection is not available on this system.');
  else if (!watching) status = t('Microphone meeting suggestions are off');
  else status = diagnostics.status ?? t('Waiting for the first microphone check…');
  return (
    <SettingsGroup title={t('Diagnostics')}>
      <SettingRow
        title={status}
        help={diagnostics.checkedAt ? t('Checked {time}', { time: formatTime(diagnostics.checkedAt) }) : undefined}
        below={
          <>
            {diagnostics.issue ? <InlineIssue tone="warning">{diagnostics.issue}</InlineIssue> : null}
            {check.error ? <InlineIssue tone="warning">{check.error.message}</InlineIssue> : null}
            {diagnostics.owners.length > 0 ? (
              <ul role="list" aria-label={t('Apps using the microphone')} className={styles.list}>
                {diagnostics.owners.map((owner) => (
                  <li key={owner.id} className={styles.listItem}>
                    <span className={styles.listText}>
                      <span>{owner.name}</span>
                      <span className={styles.listMeta}>{owner.id}</span>
                    </span>
                    <span className={styles.listMeta}>{owner.category && apps.includes(owner.category) ? t('Selected') : t('Ignored')}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        }
      >
        <Button
          size="small"
          onPress={() => void check.run({ type: 'microphone.checkNow' })}
          isDisabled={!available || !watching}
          isPending={check.pending}
        >
          {check.pending ? t('Checking…') : t('Check now')}
        </Button>
      </SettingRow>
    </SettingsGroup>
  );
}

/** Settings → Meetings → Calls without a calendar event (1.14 `MicrophoneSettings`). */
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
  const disabled = !preferences.enabled || unavailable;
  return (
    <SettingsSection id="microphone" subtitle={t('For quick calls that are not in your calendar.')}>
      <ToggleRow
        title={t('Suggest tracking when a call app uses the microphone')}
        help={t('Only the app name is read. Audio is never recorded or analysed. Suggestions appear after 4 seconds of input use.')}
        isSelected={preferences.enabled}
        isDisabled={unavailable}
        onChange={(enabled) => update((current) => ({ ...current, microphone: { ...current.microphone, enabled } }))}
      />
      <ul role="list" aria-label={t('Apps to watch')} className={styles.rowList}>
        {MICROPHONE_APPS.map((entry) => (
          <li key={entry} className={styles.checkRow}>
            <Checkbox isSelected={preferences.apps.includes(entry)} isDisabled={disabled} onChange={(on) => toggleApp(entry, on)}>
              <span className={styles.checkLabel}>{microphoneAppLabel(entry)}</span>
            </Checkbox>
          </li>
        ))}
      </ul>
      <FullRow>
        <Hint>
          {os === 'windows'
            ? t('Google Meet and other browser calls appear as Chrome, Edge, Firefox, etc. Some appear as Microsoft Edge WebView2.')
            : t('Google Meet and other browser calls appear as Chrome, Safari, Edge, etc. Some appear as WebKit (browser or web view).')}{' '}
          {t(
            'Microphone use cannot identify a meeting by itself; dictation and recordings can also trigger a suggestion. After 60 seconds without microphone use, the app offers to pause or stop tracking. The timer only changes when you confirm.',
          )}
        </Hint>
      </FullRow>
      <MicrophoneDiagnostics apps={preferences.apps} />
      <SectionFooter actions={os === 'windows' && !unavailable ? <SystemSettingsButton pane="microphone" /> : null}>
        <span>
          {os === 'windows'
            ? t('Reads which apps use the microphone from Windows privacy settings only.')
            : t('Requires macOS 14.2 or later. Reads local audio status only; macOS shows an orange dot while any app listens.')}
        </span>
      </SectionFooter>
    </SettingsSection>
  );
}
