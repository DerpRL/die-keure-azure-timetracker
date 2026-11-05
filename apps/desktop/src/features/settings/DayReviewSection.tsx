import { Time } from '@internationalized/date';
import { TimeField } from '../../components/DateFields';
import { NumberField } from '../../components/Fields';
import { Select } from '../../components/Pickers';
import type { DayReviewPreferences, DayReviewReminder } from '../../ipc/contract';
import { ChoiceButtons } from './ChoiceButtons';
import { osWords } from './labels';
import { InlineIssue, IssueRow, SettingRow, SettingsSection, ToggleRow } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import { WEEKDAY_NAMES, WEEKDAYS_MONDAY_FIRST } from './targets';
import { dayReviewProblems, GAP_MINUTES, issueFor, LONG_SESSION_MINUTES } from './validation';
import styles from './settings.module.css';

/** Minutes after midnight ↔ a time-of-day value for `TimeField`. */
export function minutesToTime(minutes: number): Time {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), 24 * 60 - 1);
  return new Time(Math.floor(clamped / 60), clamped % 60);
}

export function timeToMinutes(time: { hour: number; minute: number }): number {
  return time.hour * 60 + time.minute;
}

function useDayReviewDraft() {
  const { draft, update } = useSettingsForm();
  const preferences = draft.dayReview;
  const set = (patch: Partial<DayReviewPreferences>) =>
    update((current) => ({ ...current, dayReview: { ...current.dayReview, ...patch } }));
  return { preferences, set };
}

/** "09:00" for minutes after midnight. */
function clock(minutes: number): string {
  const time = minutesToTime(minutes);
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

/** The workday's start and end (Schedule & holidays → Workday), which bound possible gaps. */
export function WorkdayTimes() {
  const { preferences, set } = useDayReviewDraft();
  const problems = dayReviewProblems(preferences);
  return (
    <SettingRow
      title="Starts and ends"
      help="Also sets when the day review reminder appears."
      below={problems.times ? <InlineIssue>Choose an end time after the workday start.</InlineIssue> : null}
    >
      {({ helpId }) => (
        <>
          <TimeField
            label="Workday starts"
            hideLabel
            aria-describedby={helpId}
            value={minutesToTime(preferences.startMinute)}
            onChange={(value) => {
              if (value) set({ startMinute: timeToMinutes(value) });
            }}
            isInvalid={problems.times}
          />
          <span className={styles.muted} aria-hidden="true">
            to
          </span>
          <TimeField
            label="Workday ends"
            hideLabel
            aria-describedby={helpId}
            value={minutesToTime(preferences.finishMinute)}
            onChange={(value) => {
              if (value) set({ finishMinute: timeToMinutes(value) });
            }}
            isInvalid={problems.times}
          />
        </>
      )}
    </SettingRow>
  );
}

/** When the day review reminder comes, with the times for the current workday. */
function reminderOptions(preferences: DayReviewPreferences): Array<{ id: DayReviewReminder; label: string }> {
  return [
    { id: 'beforeEnd', label: `15 minutes before the workday ends (${clock(Math.max(0, preferences.finishMinute - 15))})` },
    { id: 'atEnd', label: `When the workday ends (${clock(preferences.finishMinute)})` },
    { id: 'nextMorning', label: `Next morning, when the workday starts (${clock(preferences.startMinute)})` },
  ];
}

const SHORT_DAY = (weekday: number) => (WEEKDAY_NAMES[weekday] ?? '').slice(0, 3);

/** Settings → Reminders → Day review (1.14 `DayReviewSettings`). */
export function DayReviewSection() {
  const { issues, os } = useSettingsForm();
  const { preferences, set } = useDayReviewDraft();
  const problems = dayReviewProblems(preferences);
  const issue = issueFor(issues, 'dayReview');
  return (
    <SettingsSection id="dayReview" subtitle="A short check of gaps and long entries before you send them to 7pace.">
      <ToggleRow
        title="Remind me to review my day"
        help={`From the ${osWords(os).trayPlace}. Snooze or skip any day; reviewed days survive restarts.`}
        isSelected={preferences.enabled}
        onChange={(enabled) => set({ enabled })}
      />
      <SettingRow title="When" dimmed={!preferences.enabled}>
        <Select
          label="When"
          hideLabel
          items={reminderOptions(preferences)}
          selectedKey={preferences.reminder}
          onSelectionChange={(key) => {
            if (typeof key === 'string') set({ reminder: key as DayReviewReminder });
          }}
          className={styles.fieldWide}
        />
      </SettingRow>
      <SettingRow title="On" below={problems.weekdays ? <InlineIssue>Select at least one review day.</InlineIssue> : null}>
        <ChoiceButtons
          label="Review days"
          selectionMode="multiple"
          items={WEEKDAYS_MONDAY_FIRST.map((day) => ({ id: day, label: SHORT_DAY(day), accessibleLabel: WEEKDAY_NAMES[day] }))}
          selected={new Set(preferences.weekdays)}
          onChange={(keys) => set({ weekdays: WEEKDAYS_MONDAY_FIRST.filter((day) => keys.has(day)) })}
        />
      </SettingRow>
      <SettingRow title="Flag entries longer than" help="Long entries often mean a forgotten timer.">
        {({ helpId }) => (
          <NumberField
            label="Flag entries longer than"
            hideLabel
            aria-describedby={helpId}
            unit="min"
            minValue={LONG_SESSION_MINUTES.min}
            maxValue={LONG_SESSION_MINUTES.max}
            step={LONG_SESSION_MINUTES.step}
            value={preferences.longSessionMinutes}
            onChange={(longSessionMinutes) => {
              if (Number.isFinite(longSessionMinutes)) set({ longSessionMinutes });
            }}
            isInvalid={problems.longSession}
            className={styles.numberField}
          />
        )}
      </SettingRow>
      <SettingRow title="Ignore gaps shorter than">
        <NumberField
          label="Ignore gaps shorter than"
          hideLabel
          unit="min"
          minValue={GAP_MINUTES.min}
          maxValue={GAP_MINUTES.max}
          step={GAP_MINUTES.step}
          value={preferences.gapMinutes}
          onChange={(gapMinutes) => {
            if (Number.isFinite(gapMinutes)) set({ gapMinutes });
          }}
          isInvalid={problems.gap}
          className={styles.numberField}
        />
      </SettingRow>
      {issue ? <IssueRow>{issue}</IssueRow> : null}
    </SettingsSection>
  );
}
