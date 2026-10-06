import { Time } from '@internationalized/date';
import { TimeField } from '../../components/DateFields';
import { NumberField } from '../../components/Fields';
import { Checkbox, Switch } from '../../components/Toggles';
import type { DayReviewPreferences } from '../../ipc/contract';
import { Divider, Hint, InlineIssue, SettingsSection } from './SettingsSection';
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

/** Settings → Day review (1.14 `DayReviewSettings`). */
export function DayReviewSection() {
  const { draft, update, issues } = useSettingsForm();
  const preferences = draft.dayReview;
  const set = (patch: Partial<DayReviewPreferences>) =>
    update((current) => ({ ...current, dayReview: { ...current.dayReview, ...patch } }));
  const problems = dayReviewProblems(preferences);
  const issue = issueFor(issues, 'dayReview');
  const toggleDay = (day: number, on: boolean) =>
    update((current) => {
      const weekdays = current.dayReview.weekdays;
      const next = on ? (weekdays.includes(day) ? weekdays : [...weekdays, day]) : weekdays.filter((entry) => entry !== day);
      return { ...current, dayReview: { ...current.dayReview, weekdays: next } };
    });
  return (
    <SettingsSection id="dayReview" subtitle="Choose when to check your time before you finish work.">
      <Switch isSelected={preferences.enabled} onChange={(enabled) => set({ enabled })}>
        Remind me to review my day
      </Switch>
      <div className={styles.fieldRow}>
        <TimeField
          label="Workday starts"
          value={minutesToTime(preferences.startMinute)}
          onChange={(value) => {
            if (value) set({ startMinute: timeToMinutes(value) });
          }}
          isInvalid={problems.times}
        />
        <TimeField
          label="Review reminder / workday ends"
          value={minutesToTime(preferences.finishMinute)}
          onChange={(value) => {
            if (value) set({ finishMinute: timeToMinutes(value) });
          }}
          isInvalid={problems.times}
          errorMessage={problems.times ? 'Choose a finish time after the workday start.' : undefined}
        />
      </div>
      <Hint>Workday times define possible gaps. They do not start or stop tracking.</Hint>
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
      <Divider />
      <div className={styles.fieldRow}>
        <NumberField
          label="Flag entries of this length or longer"
          unit="minutes"
          minValue={LONG_SESSION_MINUTES.min}
          maxValue={LONG_SESSION_MINUTES.max}
          step={LONG_SESSION_MINUTES.step}
          value={preferences.longSessionMinutes}
          onChange={(longSessionMinutes) => {
            if (Number.isFinite(longSessionMinutes)) set({ longSessionMinutes });
          }}
          isInvalid={problems.longSession}
        />
        <NumberField
          label="Show possible gaps of this length or longer"
          unit="minutes"
          minValue={GAP_MINUTES.min}
          maxValue={GAP_MINUTES.max}
          step={GAP_MINUTES.step}
          value={preferences.gapMinutes}
          onChange={(gapMinutes) => {
            if (Number.isFinite(gapMinutes)) set({ gapMinutes });
          }}
          isInvalid={problems.gap}
        />
      </div>
      {issue ? <InlineIssue>{issue}</InlineIssue> : null}
      <Hint>
        A reminder appears once per day while the app is running, including if you open it later that evening. Snoozes and reviewed
        days survive restarts. Notifications follow your choices in Notifications.
      </Hint>
    </SettingsSection>
  );
}
