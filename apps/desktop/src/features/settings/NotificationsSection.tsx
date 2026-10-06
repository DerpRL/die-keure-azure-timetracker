import { TimeField } from '../../components/DateFields';
import { Select } from '../../components/Pickers';
import { Switch } from '../../components/Toggles';
import type { Interruption, InterruptionChoice, PromptKind, QuietHours } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { minutesToTime, timeToMinutes } from './DayReviewSection';
import { useImmediateValue } from './FigmaSettings';
import { INTERRUPTION_LEVELS, osWords } from './labels';
import { Divider, Hint, InlineIssue, SettingsGroup, SettingsSection } from './SettingsSection';
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
    <SettingsGroup title="Quiet hours">
      <Switch isSelected={quiet.enabled} onChange={(enabled) => apply({ ...quiet, enabled })}>
        Use quiet hours
      </Switch>
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
        While active, prompts do not open the panel or send notifications. They stay listed in the panel and on Overview. 7pace activity
        checks still interrupt, because 7pace stops the timer when they go unanswered. The period can run past midnight.
      </Hint>
      {action.error ? <InlineIssue>{action.error.message}</InlineIssue> : null}
    </SettingsGroup>
  );
}

/** Settings → Notifications: notifications, per-prompt interruption levels and quiet hours. */
export function NotificationsSection() {
  const { draft, update, os } = useSettingsForm();
  const words = osWords(os);
  return (
    <SettingsSection id="notifications" subtitle="Prompts never change your timer by themselves; these settings decide how they get your attention.">
      <SettingsGroup title="Notifications">
        <Switch
          isSelected={draft.notificationsEnabled}
          onChange={(notificationsEnabled) => update((current) => ({ ...current, notificationsEnabled }))}
          description={`Saved with Save changes. ${words.name} asks for permission the first time.`}
        >
          {`Show ${words.name} notifications for branches, prompts and day reviews`}
        </Switch>
      </SettingsGroup>
      <Divider />
      <Interruptions />
      <Divider />
      <QuietHoursSettings />
    </SettingsSection>
  );
}
