import { TimeField } from '../../components/DateFields';
import { Select } from '../../components/Pickers';
import type { Interruption, InterruptionChoice, PromptKind, QuietHours } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { minutesToTime, timeToMinutes } from './DayReviewSection';
import { useImmediateValue } from './FigmaSettings';
import { INTERRUPTION_LEVELS, osWords } from './labels';
import { Divider, Hint, InlineIssue, SettingsGroup, SettingsSection, ToggleRow } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import styles from './settings.module.css';

/** Extra advice under one prompt kind. */
const KIND_HINTS: Partial<Record<PromptKind, string>> = {
  trackingAttention: '7pace stops the timer when its checks go unanswered, so these also interrupt during quiet hours.',
};

function Interruptions() {
  const { settings, draft } = useSettingsForm();
  const action = useAction();
  const [choices, setLocal, reset] = useImmediateValue<readonly InterruptionChoice[]>(settings.interruptions);
  const choose = (kind: PromptKind, level: Interruption) => {
    setLocal(choices.map((choice) => (choice.kind === kind ? { ...choice, level } : choice)));
    void action.run({ type: 'settings.setPromptInterruption', kind, level }).then((result) => {
      if (!result.ok) reset();
    });
  };
  const levels = INTERRUPTION_LEVELS.map(({ id, label }) => ({ id, label }));
  return (
    <SettingsGroup title="Interruptions" description="Choose how strongly each kind of prompt may interrupt you. Changes apply immediately.">
      <dl className={styles.levels}>
        {INTERRUPTION_LEVELS.map((level) => (
          <div key={level.id} style={{ display: 'contents' }}>
            <dt>{level.label}</dt>
            <dd>{level.description}</dd>
          </div>
        ))}
      </dl>
      {!draft.notificationsEnabled ? <Hint>Notifications are off, so Notify only works like Off.</Hint> : null}
      <div className={styles.interruptions}>
        {choices.map((choice) => (
          <Select
            key={choice.kind}
            label={choice.label}
            items={levels}
            selectedKey={choice.level}
            onSelectionChange={(key) => {
              if (typeof key === 'string' && key !== choice.level) choose(choice.kind, key as Interruption);
            }}
            description={KIND_HINTS[choice.kind]}
          />
        ))}
      </div>
      {action.error ? <InlineIssue>{action.error.message}</InlineIssue> : null}
    </SettingsGroup>
  );
}

function QuietHoursSettings() {
  const { settings } = useSettingsForm();
  const action = useAction();
  const [quiet, setLocal, reset] = useImmediateValue<QuietHours>(settings.configuration.quietHours);
  const apply = (quietHours: QuietHours) => {
    setLocal(quietHours);
    void action.run({ type: 'settings.setQuietHours', quietHours }).then((result) => {
      if (!result.ok) reset();
    });
  };
  return (
    <div className={styles.group}>
      <ToggleRow
        title="Quiet hours"
        help={`No panel or banners between ${formatClockMinutes(quiet.startMinute)} and ${formatClockMinutes(quiet.endMinute)}. Applies right away.`}
        isSelected={quiet.enabled}
        onChange={(enabled) => apply({ ...quiet, enabled })}
      />
      <div className={styles.fieldRow}>
        <TimeField
          label="Quiet from"
          value={minutesToTime(quiet.startMinute)}
          onChange={(value) => {
            if (value && timeToMinutes(value) !== quiet.startMinute) apply({ ...quiet, startMinute: timeToMinutes(value) });
          }}
          isDisabled={!quiet.enabled}
        />
        <TimeField
          label="Quiet until"
          value={minutesToTime(quiet.endMinute)}
          onChange={(value) => {
            if (value && timeToMinutes(value) !== quiet.endMinute) apply({ ...quiet, endMinute: timeToMinutes(value) });
          }}
          isDisabled={!quiet.enabled}
        />
      </div>
      <Hint>
        Prompts stay listed in the panel and on Today. 7pace activity checks still interrupt, because 7pace stops the timer when they
        go unanswered. The period can run past midnight.
      </Hint>
      {action.error ? <InlineIssue>{action.error.message}</InlineIssue> : null}
    </div>
  );
}

/** "18:00" for minutes after midnight. */
function formatClockMinutes(minutes: number): string {
  const time = minutesToTime(minutes);
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

/** Settings → Targets & reminders → Notifications: notifications, quiet hours and interruption levels. */
export function NotificationsSection() {
  const { draft, update, os } = useSettingsForm();
  const words = osWords(os);
  return (
    <SettingsSection id="notifications" subtitle="Prompts never change your timer by themselves; these settings decide how they get your attention.">
      <ToggleRow
        title={`${words.name} notifications`}
        help={`For branch changes, prompts and day reviews. Saved with Save changes; ${words.name} asks for permission the first time.`}
        isSelected={draft.notificationsEnabled}
        onChange={(notificationsEnabled) => update((current) => ({ ...current, notificationsEnabled }))}
      />
      <Divider />
      <QuietHoursSettings />
      <Divider />
      <Interruptions />
    </SettingsSection>
  );
}
