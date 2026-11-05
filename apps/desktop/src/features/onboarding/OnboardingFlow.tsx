import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AppLogo } from '../../components/AppLogo';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ArrowRightIcon } from '../../components/icons';
import type { AppSlice, ConnectionSlice, SettingsSlice } from '../../ipc/contract';
import { RepositoriesPanel } from '../../places/settings/git';
import type { KeyCombo } from '../../shortcuts/keys';
import { useCommand } from '../../shortcuts/hooks';
import { useAction, useSlice } from '../../state/hooks';
import { withAccountDefaults } from '../settings/accountDefaults';
import { AppearanceForm, useInterfacePreferences } from '../settings/AppearanceForm';
import { AzureSection, SevenPaceSection } from '../settings/ConnectionSection';
import { FigmaSettings } from '../settings/FigmaSettings';
import { osWords } from '../settings/labels';
import { CalendarSection } from '../settings/MeetingsSections';
import { Hint, InlineIssue, SectionHeadingLevel } from '../settings/SettingsSection';
import { SettingsFormContext, useSettingsForm, type SettingsFormValue } from '../settings/SettingsForm';
import { useSettingsDraft } from '../settings/useSettingsDraft';
import { issueFor } from '../settings/validation';
import { setupSteps, SetupSteps, type SetupStep } from './FirstRunSteps';
import styles from './onboarding.module.css';

export const CONTINUE_SHORTCUT: KeyCombo = { key: 'Enter', mod: true };

const NO_SECTION = () => undefined;

/**
 * The first-run onboarding (2.2), in place of the app: Appearance & readability, Azure DevOps and
 * 7pace, Git repositories and Figma, and the calendars (macOS). Each step reuses the Settings
 * cards. Appearance, Figma, repositories and calendar access apply immediately; the accounts and
 * the calendar choice are saved with `settings.save` when the user continues from their step, so
 * leaving halfway keeps them. The last step finishes with `app.finishOnboarding`, which opens
 * Today.
 */
export function OnboardingFlow() {
  const settings = useSlice('settings');
  const app = useSlice('app');
  if (!settings) return <main aria-busy="true" aria-label="Loading setup" className={styles.page} />;
  return (
    <OnboardingForm settings={settings} app={app}>
      <Flow />
    </OnboardingForm>
  );
}

/** The Settings draft for the onboarding's cards: the same model, without the Settings page. */
function OnboardingForm({ settings, app, children }: { settings: SettingsSlice; app: AppSlice | undefined; children: ReactNode }) {
  const draft = useSettingsDraft(settings.configuration, withAccountDefaults);
  const value: SettingsFormValue = {
    ...draft,
    settings,
    app,
    os: app?.os === 'windows' ? 'windows' : 'macos',
    busy: app?.busy ?? false,
    preview: app?.preview ?? false,
    goTo: NO_SECTION,
  };
  return (
    <SettingsFormContext.Provider value={value}>
      <SectionHeadingLevel.Provider value={2}>{children}</SectionHeadingLevel.Provider>
    </SettingsFormContext.Provider>
  );
}

interface StepCopy {
  title: string;
  lead: string;
  /** Can be continued without doing anything. */
  optional: boolean;
}

const COPY: Record<SetupStep, StepCopy> = {
  appearance: {
    title: 'Make yourself comfortable',
    lead: 'Choose Light, Dark or System, the text size and the contrast. Changes apply right away; you can change them later in Settings → Appearance & app.',
    optional: false,
  },
  accounts: {
    title: 'Connect Azure DevOps and 7pace',
    lead: '7pace stores your time, so it is needed to track. Azure DevOps shows ticket details; its token is optional, without it tickets are looked up through 7pace.',
    optional: false,
  },
  sources: {
    title: 'Git repositories and Figma',
    lead: 'Optional. Switching branch or Figma file can suggest what to track; nothing changes in 7pace until you confirm. You can set these up later in Settings.',
    optional: true,
  },
  calendars: {
    title: 'Your calendars',
    lead: 'Optional. Show your meetings on Today and get a suggestion when one starts. Events stay on your Mac. You can change this later in Settings → Calendars.',
    optional: true,
  },
};

/**
 * Why the accounts step cannot be left yet, or `null`: the Azure organization and the 7pace
 * workspace must be valid, and 7pace needs a way to sign in (a stored or typed API token, or an
 * approved pairing PIN). The Azure token is optional.
 */
export function accountsMissing(form: SettingsFormValue, connection: ConnectionSlice | undefined): string | null {
  const { draft, issues, settings } = form;
  if (issueFor(issues, 'organization') || issueFor(issues, 'sevenPaceUrl')) return 'Fix the highlighted fields to continue.';
  if (draft.sevenPaceUrl.trim() === '') return 'Enter your 7pace workspace URL to continue.';
  if (draft.sevenPaceAuthMode === 'mobilePIN') {
    const paired = settings.pairing.pairedHost !== null || (connection?.hasSevenPaceToken ?? false);
    return paired ? null : 'Pair with 7pace to continue: generate a PIN and approve it in 7pace.';
  }
  const token = form.sevenPaceToken.trim() !== '' || settings.hasSevenPaceToken;
  return token ? null : 'Paste your 7pace API token to continue, or choose Mobile PIN pairing.';
}

function Flow() {
  const form = useSettingsForm();
  const { app } = form;
  const connection = useSlice('connection');
  const steps = setupSteps(app?.features.calendar ?? true);
  const [index, setIndex] = useState(0);
  const position = Math.min(index, steps.length - 1);
  const step = steps[position]!;
  const last = position === steps.length - 1;
  const copy = COPY[step.id];
  const finish = useAction();
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  // Each step starts reading at its title: the screen changes as a whole.
  useEffect(() => {
    heading.current?.focus();
  }, [position]);

  const busy = saving || form.saving || finish.pending;
  const proceed = async () => {
    if (busy) return;
    setBlocked(null);
    if (step.id === 'accounts') {
      const missing = accountsMissing(form, connection);
      if (missing) {
        setBlocked(missing);
        return;
      }
    }
    // The accounts and the calendar choice are the draft's; save them before moving on.
    if ((step.id === 'accounts' || last) && form.dirty) {
      setSaving(true);
      const saved = await form.save();
      setSaving(false);
      if (!saved) return;
    }
    if (last) void finish.run({ type: 'app.finishOnboarding' });
    else setIndex(position + 1);
  };
  const back = () => {
    setBlocked(null);
    setIndex(Math.max(0, position - 1));
  };

  useCommand({
    id: 'onboarding.continue',
    icon: ArrowRightIcon,
    label: last ? 'Finish setup' : 'Continue setup',
    group: 'Actions',
    shortcut: CONTINUE_SHORTCUT,
    allowInInputs: true,
    isDisabled: busy,
    onAction: () => void proceed(),
  });

  const next = steps[position + 1];
  return (
    <main className={styles.page} aria-labelledby={titleId}>
      <div className={styles.column}>
        <div className={styles.topRow}>
          <p className={styles.brand}>
            <AppLogo size={30} />
            <span>Azure timetracker</span>
          </p>
          <SetupSteps steps={steps} current={step.id} />
        </div>
        <header className={styles.header}>
          <p className={styles.stepCount}>{`Step ${position + 1} of ${steps.length}`}</p>
          <h1 id={titleId} ref={heading} tabIndex={-1} className={styles.title}>
            {copy.title}
          </h1>
          <p className={styles.subtitle}>{copy.lead}</p>
        </header>
        <StepBody step={step.id} />
        {blocked ? (
          <Banner tone="warning" title="Not ready to continue" live="assertive">
            {blocked}
          </Banner>
        ) : null}
        {form.showIssues ? (
          <Banner tone="error" title="Fix these settings to continue">
            <ul className={styles.issueList}>
              {form.issues.map((issue) => (
                <li key={issue.field}>{issue.message}</li>
              ))}
            </ul>
          </Banner>
        ) : null}
        {form.saveError ? (
          <Banner tone="error" title="Your settings were not saved">
            {form.saveError.message}
          </Banner>
        ) : finish.error ? (
          <Banner tone="error" title="Setup could not finish">
            {finish.error.message}
          </Banner>
        ) : app?.error ? (
          <Banner tone="warning" live="polite">
            {app.error}
          </Banner>
        ) : null}
        <div className={styles.footer}>
          <div className={styles.footerStart}>
            {position > 0 ? (
              <Button size="large" onPress={back} isDisabled={busy}>
                Back
              </Button>
            ) : null}
          </div>
          <div className={styles.footerEnd}>
            <p className={styles.next}>
              {next ? `Next: ${next.label}` : 'Last step'}
              {copy.optional ? ' · optional, you can continue without changes' : ''}
            </p>
            <Button variant="primary" size="large" onPress={() => void proceed()} isPending={busy} shortcut={CONTINUE_SHORTCUT} showShortcut>
              {last ? 'Finish setup' : 'Continue'}
            </Button>
          </div>
        </div>
        <p className={styles.note}>
          {form.os === 'windows'
            ? 'Azure timetracker lives in the notification area. After setup, use its icon in the taskbar corner to open it.'
            : 'Azure timetracker lives in the menu bar. After setup, use the clock at the top of your screen to open it.'}
        </p>
      </div>
    </main>
  );
}

function StepBody({ step }: { step: SetupStep }) {
  switch (step) {
    case 'appearance':
      return <AppearanceStep />;
    case 'accounts':
      return <AccountsStep />;
    case 'sources':
      return <SourcesStep />;
    case 'calendars':
      return (
        <div className={styles.stack}>
          <CalendarSection />
        </div>
      );
  }
}

/** Step 1: the Settings → Appearance & app controls, applied as they change. */
function AppearanceStep() {
  const { os } = useSettingsForm();
  const { preferences, apply, error } = useInterfacePreferences();
  const titleId = useId();
  return (
    <Card as="section" aria-labelledby={titleId} padding="large" className={styles.card}>
      <h2 id={titleId} className={styles.cardTitle}>
        Appearance & readability
      </h2>
      <AppearanceForm preferences={preferences} onChange={apply} os={os} showPreview />
      {error ? <InlineIssue>{error.message}</InlineIssue> : null}
    </Card>
  );
}

/** Step 2: the Settings → Azure DevOps & 7pace cards, with die Keure's accounts prefilled. */
function AccountsStep() {
  const { os } = useSettingsForm();
  return (
    <div className={styles.stack}>
      <AzureSection />
      <SevenPaceSection />
      <Hint>{`Tokens stay in ${osWords(os).credentials}. Continue saves the accounts.`}</Hint>
    </div>
  );
}

/** Step 3: the watched repositories (Settings → Git repositories) and Figma observation. */
function SourcesStep() {
  const gitId = useId();
  const figmaId = useId();
  return (
    <div className={styles.stack}>
      <section aria-labelledby={gitId} className={styles.group}>
        <h2 id={gitId} className={styles.cardTitle}>
          Git repositories
        </h2>
        <p className={styles.cardSubtitle}>A branch such as feature/33624-improve-loading suggests ticket 33624.</p>
        <RepositoriesPanel />
      </section>
      <Card as="section" aria-labelledby={figmaId} padding="large" className={styles.card}>
        <h2 id={figmaId} className={styles.cardTitle}>
          Figma Desktop
        </h2>
        <p className={styles.cardSubtitle}>Suggest Design tracking when you switch files. Always confirm before a timer changes.</p>
        <FigmaSettings onboarding />
      </Card>
    </div>
  );
}
