import { Time } from '@internationalized/date';
import { TimeField } from '../../components/DateFields';
import { NumberField } from '../../components/Fields';
import { Checkbox } from '../../components/Toggles';
import type { DayReviewPreferences } from '../../ipc/contract';
import { osWords } from './labels';
import { InlineIssue, SettingsSection, ToggleRow } from './SettingsSection';
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
  return { preferences, set, update };
}

/** "Workday starts / ends" (Daily targets): the day review's workday, which bounds possible gaps. */
export function WorkdayTimes() {
  const { preferences, set } = useDayReviewDraft();
  const problems = dayReviewProblems(preferences);
  return (
    <div className={styles.fieldPair}>
      <TimeField
        label="Workday starts"
        value={minutesToTime(preferences.startMinute)}
        onChange={(value) => {
          if (value) set({ startMinute: timeToMinutes(value) });
        }}
        isInvalid={problems.times}
      />
      <TimeField
        label="Workday ends"
        description="Your day review reminder comes at this time."
        value={minutesToTime(preferences.finishMinute)}
        onChange={(value) => {
          if (value) set({ finishMinute: timeToMinutes(value) });
        }}
        isInvalid={problems.times}
        errorMessage={problems.times ? 'Choose an end time after the workday start.' : undefined}
      />
    </div>
  );
}

/** Settings → Targets & reminders → Day check (1.14 `DayReviewSettings`). */
export function DayReviewSection() {
  const { issues, os } = useSettingsForm();
  const { preferences, set, update } = useDayReviewDraft();
  const problems = dayReviewProblems(preferences);
  const issue = issueFor(issues, 'dayReview');
  const toggleDay = (day: number, on: boolean) =>
    update((current) => {
      const weekdays = current.dayReview.weekdays;
      const next = on ? (weekdays.includes(day) ? weekdays : [...weekdays, day]) : weekdays.filter((entry) => entry !== day);
      return { ...current, dayReview: { ...current.dayReview, weekdays: next } };
    });
  return (
    <SettingsSection id="dayReview">
      <div className={styles.fieldPair}>
        <NumberField
          label="Flag entries of at least"
          unit="minutes"
          minValue={LONG_SESSION_MINUTES.min}
          maxValue={LONG_SESSION_MINUTES.max}
          step={LONG_SESSION_MINUTES.step}
          value={preferences.longSessionMinutes}
          onChange={(longSessionMinutes) => {
            if (Number.isFinite(longSessionMinutes)) set({ longSessionMinutes });
          }}
          isInvalid={problems.longSession}
          width="full"
        />
        <NumberField
          label="Ignore gaps shorter than"
          unit="minutes"
          minValue={GAP_MINUTES.min}
          maxValue={GAP_MINUTES.max}
          step={GAP_MINUTES.step}
          value={preferences.gapMinutes}
          onChange={(gapMinutes) => {
            if (Number.isFinite(gapMinutes)) set({ gapMinutes });
          }}
          isInvalid={problems.gap}
          width="full"
        />
      </div>
      <ToggleRow
        title="Remind me to review my day"
        help={`At the end of your workday, from the ${osWords(os).trayPlace}. Once a day; snoozes and reviewed days survive restarts.`}
        isSelected={preferences.enabled}
        onChange={(enabled) => set({ enabled })}
      />
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Review days</legend>
        <div className={styles.checkGrid}>
          {WEEKDAYS_MONDAY_FIRST.map((day) => (
            <Checkbox key={day} isSelected={preferences.weekdays.includes(day)} onChange={(on) => toggleDay(day, on)}>
              {WEEKDAY_NAMES[day]}
            </Checkbox>
          ))}
        </div>
        {problems.weekdays ? <InlineIssue>Select at least one review day.</InlineIssue> : null}
      </fieldset>
      {issue ? <InlineIssue>{issue}</InlineIssue> : null}
    </SettingsSection>
  );
}
