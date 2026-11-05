import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { TimeField } from '../../components/DateFields';
import { CheckIcon } from '../../components/icons';
import type { Interruption, InterruptionChoice, PromptKind, QuietHours } from '../../ipc/contract';
import { useAction } from '../../state/hooks';
import { minutesToTime, timeToMinutes } from './DayReviewSection';
import { useImmediateValue } from './FigmaSettings';
import { INTERRUPTION_LEVELS, osWords } from './labels';
import { SystemSettingsButton } from './MeetingsSections';
import { HintRow, InlineIssue, IssueRow, SectionFooter, SettingRow, SettingsSection, ToggleRow } from './SettingsSection';
import { useSettingsForm } from './SettingsForm';
import styles from './settings.module.css';

/** Extra advice under one prompt kind. */
const KIND_HINTS: Partial<Record<PromptKind, string>> = {
  trackingAttention: '7pace stops the timer when its checks go unanswered, so these also interrupt during quiet hours.',
};

/** Settings → Notifications → Prompts: how each kind of prompt reaches you (applies right away). */
export function PromptsSection() {
  const { settings, draft } = useSettingsForm();
  const action = useAction();
  const [choices, setLocal, reset] = useImmediateValue<readonly InterruptionChoice[]>(settings.interruptions);
  const choose = (kind: PromptKind, level: Interruption) => {
    setLocal(choices.map((choice) => (choice.kind === kind ? { ...choice, level } : choice)));
    void action.run({ type: 'settings.setPromptInterruption', kind, level }).then((result) => {
      if (!result.ok) reset();
    });
  };
  const changed = choices.filter((choice) => choice.level !== DEFAULT_INTERRUPTION);
  const resetAll = () => {
    setLocal(choices.map((choice) => ({ ...choice, level: DEFAULT_INTERRUPTION })));
    void Promise.all(
      changed.map((choice) => action.run({ type: 'settings.setPromptInterruption', kind: choice.kind, level: DEFAULT_INTERRUPTION })),
    ).then((results) => {
      if (results.some((result) => !result.ok)) reset();
    });
  };
  return (
    <SettingsSection
      id="prompts"
      subtitle={
        <>
          <b>Notify</b> shows a banner. <b>Open panel</b> opens the panel without taking focus. <b>Open & focus</b> also brings it to the
          front. Changes apply right away.
        </>
      }
      actions={
        <Button size="small" variant="plain" onPress={resetAll} isDisabled={changed.length === 0}>
          Reset to defaults
        </Button>
      }
    >
      {!draft.notificationsEnabled ? <HintRow>Notifications are off, so Notify works like Off.</HintRow> : null}
      <div className={styles.tableScroll}>
        <table className={styles.matrix}>
          <thead>
            <tr>
              <th scope="col">Prompt</th>
              {INTERRUPTION_LEVELS.map((level) => (
                <th key={level.id} scope="col" title={level.description}>
                  {MATRIX_LABELS[level.id]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {choices.map((choice) => (
              <tr key={choice.kind}>
                <th scope="row">
                  <span className={styles.matrixPrompt}>{choice.label}</span>
                  {KIND_HINTS[choice.kind] ? <span className={styles.listMeta}>{KIND_HINTS[choice.kind]}</span> : null}
                </th>
                {INTERRUPTION_LEVELS.map((level) => (
                  <td key={level.id}>
                    <input
                      type="radio"
                      name={`interruption-${choice.kind}`}
                      aria-label={`${choice.label}: ${MATRIX_LABELS[level.id]}`}
                      checked={choice.level === level.id}
                      onChange={() => {
                        if (choice.level !== level.id) choose(choice.kind, level.id);
                      }}
                      className={styles.radio}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {action.error ? <IssueRow>{action.error.message}</IssueRow> : null}
      <SectionFooter>Off only hides the prompt: it stays listed in the panel and on Today. 7pace activity checks keep running.</SectionFooter>
    </SettingsSection>
  );
}

/** `Interruption::default`: every prompt kind opens the panel unless changed. */
const DEFAULT_INTERRUPTION: Interruption = 'openPanel';

const MATRIX_LABELS: Record<Interruption, string> = {
  off: 'Off',
  notifyOnly: 'Notify',
  openPanel: 'Open panel',
  openAndFocus: 'Open & focus',
};

function QuietHoursRows() {
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
    <>
      <ToggleRow
        title="Quiet hours"
        help="No banners and no panels in this period. Prompts wait in the panel and on Today; 7pace activity checks still interrupt. Applies right away."
        isSelected={quiet.enabled}
        onChange={(enabled) => apply({ ...quiet, enabled })}
      />
      <SettingRow sub title="From" help="The period can run past midnight." dimmed={!quiet.enabled} below={action.error ? <InlineIssue>{action.error.message}</InlineIssue> : null}>
        {({ helpId }) => (
          <>
            <TimeField
              label="Quiet from"
              hideLabel
              aria-describedby={helpId}
              value={minutesToTime(quiet.startMinute)}
              onChange={(value) => {
                if (value && timeToMinutes(value) !== quiet.startMinute) apply({ ...quiet, startMinute: timeToMinutes(value) });
              }}
              isDisabled={!quiet.enabled}
            />
            <span className={styles.muted} aria-hidden="true">
              to
            </span>
            <TimeField
              label="Quiet until"
              hideLabel
              aria-describedby={helpId}
              value={minutesToTime(quiet.endMinute)}
              onChange={(value) => {
                if (value && timeToMinutes(value) !== quiet.endMinute) apply({ ...quiet, endMinute: timeToMinutes(value) });
              }}
              isDisabled={!quiet.enabled}
            />
          </>
        )}
      </SettingRow>
    </>
  );
}

/** Settings → Notifications → macOS notifications: banners, their permission and quiet hours. */
export function NotificationsSection() {
  const { draft, update, os, settings } = useSettingsForm();
  const words = osWords(os);
  const authorized = settings.notificationsAuthorized;
  return (
    <SettingsSection id="notifications" title={`${words.name} notifications`}>
      <ToggleRow
        title="Banners"
        help={`For branch changes, prompts and day reviews. Saved with Save changes; ${words.name} asks for permission the first time.`}
        isSelected={draft.notificationsEnabled}
        onChange={(notificationsEnabled) => update((current) => ({ ...current, notificationsEnabled }))}
      />
      <SettingRow
        sub
        title="Permission"
        help={
          authorized === false
            ? `Turned off for Azure timetracker in ${os === 'windows' ? 'Windows Settings' : 'System Settings › Notifications'}.`
            : `Managed in ${os === 'windows' ? 'Windows Settings' : 'System Settings › Notifications'}.`
        }
      >
        {authorized === true ? (
          <Badge tone="success" icon={CheckIcon}>
            Allowed
          </Badge>
        ) : authorized === false ? (
          <Badge tone="warning">Not allowed</Badge>
        ) : (
          <Badge tone="neutral">Not asked yet</Badge>
        )}
        <SystemSettingsButton pane="notifications" />
      </SettingRow>
      <QuietHoursRows />
    </SettingsSection>
  );
}
