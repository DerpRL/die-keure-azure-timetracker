import { act, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetMockIpc } from '../../ipc';
import type { AppSlice } from '../../ipc/contract';
import { sampleSlices } from '../../ipc/fixtures';
import { onboardingApp, unconfiguredConnection, unconfiguredSettings } from '../../ipc/fixtures/slices/settings';
import { MockEngineError } from '../../ipc/mockEngine';
import { MainSurface } from '../../surfaces/MainSurface';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine, type EngineRenderOptions } from '../../test/engine';
import { OnboardingGate } from './OnboardingGate';

afterEach(() => {
  resetMockIpc();
  // React Aria's own announcements reference elements by id; they dangle after cleanup.
  for (const log of document.querySelectorAll('[data-live-announcer]:not([data-announcer]) [role="log"]')) log.replaceChildren();
});

function Gated() {
  return (
    <OnboardingGate>
      <p>The app</p>
    </OnboardingGate>
  );
}

const TITLES = {
  appearance: 'Make yourself comfortable',
  accounts: 'Connect Azure DevOps and 7pace',
  sources: 'Git repositories and Figma',
  calendars: 'Your calendars',
} as const;

const title = (name: string) => screen.getByRole('heading', { level: 1, name });
const continueButton = () => screen.getByRole('button', { name: /^(Continue|Finish setup)/ });
const firstRun = { settings: unconfiguredSettings, connection: unconfiguredConnection };

/** Renders the gate on the first run and waits for the (lazily loaded) onboarding. */
async function renderOnboarding(app: AppSlice = onboardingApp, options: EngineRenderOptions = {}) {
  const result = renderWithEngine(<Gated />, { ...options, with: { app, ...options.with } });
  await screen.findByRole('heading', { level: 1, name: TITLES.appearance });
  return result;
}

/** Continues and waits for the next step's title, which takes focus. */
async function next(user: { click: (element: Element) => Promise<void> }, name: string) {
  await user.click(continueButton());
  expect(await screen.findByRole('heading', { level: 1, name })).toHaveFocus();
}

describe('OnboardingGate', () => {
  it('renders the app when onboarding is done', () => {
    renderWithEngine(<Gated />);
    expect(screen.getByText('The app')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: TITLES.appearance })).not.toBeInTheDocument();
  });

  it('renders the app until the app slice arrives', () => {
    renderWithEngine(<Gated />, { slices: {} });
    expect(screen.getByText('The app')).toBeInTheDocument();
  });

  it('replaces the whole main window and gives it back afterwards', async () => {
    const { engine } = renderWithEngine(<MainSurface />, { with: { app: onboardingApp } });
    await screen.findByRole('heading', { level: 1, name: TITLES.appearance });
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    act(() => engine.setSlice('app', { ...sampleSlices().app!, onboarding: false }));
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });
});

describe('the onboarding steps', () => {
  it('starts with Appearance & readability, step 1 of 4, read from its title', async () => {
    await renderOnboarding();
    expect(screen.queryByText('The app')).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: TITLES.appearance })).toBeInTheDocument();
    expect(title(TITLES.appearance)).toHaveFocus();
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual(['1Appearance', '2Azure & 7pace', '3Git & Figma', '4Calendars']);
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('heading', { level: 2, name: 'Appearance & readability' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Text and control size' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Contrast' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.getByText('Next: Azure & 7pace')).toBeInTheDocument();
    // Figma moved to step 3, and no Settings save bar appears anywhere in the onboarding.
    expect(screen.queryByRole('switch', { name: 'Observe Figma files' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('applies appearance choices immediately and previews them', async () => {
    const { engine, user } = await renderOnboarding();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    await user.click(screen.getByRole('radio', { name: 'Increased' }));
    expect(engine.dispatched('app.setInterface')).toEqual([
      { type: 'app.setInterface', preferences: { theme: 'dark', scale: 100, contrast: 'system' } },
      { type: 'app.setInterface', preferences: { theme: 'dark', scale: 100, contrast: 'increased' } },
    ]);
    const preview = screen.getByRole('figure', { name: 'Appearance preview' });
    expect(preview).toHaveAttribute('data-theme', 'dark');
    expect(preview).toHaveAttribute('data-contrast', 'increased');
  });

  it('goes through the steps in order with Continue and back with Back, focusing each title', async () => {
    const { engine, user } = await renderOnboarding();
    await next(user, TITLES.accounts);
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument();
    await next(user, TITLES.sources);
    expect(screen.getByText('Step 3 of 4')).toBeInTheDocument();
    await next(user, TITLES.calendars);
    expect(screen.getByText('Step 4 of 4')).toBeInTheDocument();
    expect(screen.getByText('Last step · optional, you can continue without changes')).toBeInTheDocument();
    expect(continueButton()).toHaveAccessibleName(/^Finish setup/);

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(title(TITLES.sources)).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(title(TITLES.accounts)).toHaveFocus();
    const steps = within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual(['Appearance (done)', '2Azure & 7pace', '3Git & Figma', '4Calendars']);
    // Nothing to save: the sample accounts are saved already.
    expect(engine.dispatched('settings.save')).toEqual([]);
    expect(engine.dispatched('app.finishOnboarding')).toEqual([]);
  });

  it('continues with ⌘Return', async () => {
    const { user } = await renderOnboarding();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(await screen.findByRole('heading', { level: 1, name: TITLES.accounts })).toHaveFocus();
  });

  it('shows the accounts with die Keure’s defaults, Test and save and the 7pace steps, without a save bar', async () => {
    const { user } = await renderOnboarding(onboardingApp, { with: firstRun });
    await next(user, TITLES.accounts);
    expect(screen.getByRole('heading', { level: 2, name: 'Azure DevOps' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '7pace Timetracker' })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization')).toHaveValue('diekeure-webdev');
    expect(screen.getByLabelText('Project (optional)')).toHaveValue('LK2020');
    expect(screen.getByLabelText('Workspace URL')).toHaveValue('https://diekeure-webdev.timehub.7pace.com');
    expect(screen.getByRole('button', { name: 'Test and save' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'How to get a 7pace API token' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    await expectNoA11yViolations();
  });

  it('needs a 7pace sign-in before leaving the accounts, then saves them', async () => {
    const { engine, user } = await renderOnboarding(onboardingApp, { with: firstRun });
    await next(user, TITLES.accounts);
    await user.click(continueButton());
    expect(screen.getByRole('alert')).toHaveTextContent('Paste your 7pace API token to continue, or choose Mobile PIN pairing.');
    expect(title(TITLES.accounts)).toBeInTheDocument();
    expect(engine.dispatched('settings.save')).toEqual([]);

    await user.type(screen.getByLabelText('API token'), 'fake-7pace-token');
    await next(user, TITLES.sources);
    expect(engine.dispatched('settings.save')).toEqual([
      {
        type: 'settings.save',
        configuration: {
          ...unconfiguredSettings.configuration,
          organization: 'diekeure-webdev',
          project: 'LK2020',
          sevenPaceUrl: 'https://diekeure-webdev.timehub.7pace.com',
        },
        azurePat: '',
        sevenPaceToken: 'fake-7pace-token',
      },
    ]);
  });

  it('accepts an approved pairing PIN as the 7pace sign-in', async () => {
    const paired = {
      ...unconfiguredSettings,
      configuration: { ...unconfiguredSettings.configuration, sevenPaceAuthMode: 'mobilePIN' as const },
      pairing: { ...unconfiguredSettings.pairing, pairedHost: 'diekeure-webdev.timehub.7pace.com' },
    };
    const { engine, user } = await renderOnboarding(onboardingApp, { with: { ...firstRun, settings: paired } });
    await next(user, TITLES.accounts);
    expect(screen.getByRole('list', { name: 'How to get a pairing PIN approved' })).toBeInTheDocument();
    await next(user, TITLES.sources);
    expect(engine.dispatched('settings.save')[0]?.configuration.sevenPaceAuthMode).toBe('mobilePIN');
  });

  it('stays on the accounts when they could not be saved', async () => {
    const { engine, user } = await renderOnboarding();
    engine.handle('settings.save', () => {
      throw new MockEngineError('message', 'Keychain could not save the credential (denied).');
    });
    await next(user, TITLES.accounts);
    await user.type(screen.getByLabelText('Project (optional)'), ' EU');
    await user.click(continueButton());
    expect(await screen.findByText('Keychain could not save the credential (denied).')).toBeInTheDocument();
    expect(title(TITLES.accounts)).toBeInTheDocument();
  });

  it('makes Git repositories and Figma optional, applying Figma immediately', async () => {
    const { engine, user } = await renderOnboarding();
    await next(user, TITLES.accounts);
    await next(user, TITLES.sources);
    expect(screen.getByRole('heading', { level: 2, name: 'Git repositories' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /^Watched repositories/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Figma Desktop' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Observe Figma files' }));
    expect(engine.dispatched('figma.setPreferences')).toEqual([
      { type: 'figma.setPreferences', preferences: { enabled: true, dismissalMinutes: 15, historyDays: 30 } },
    ]);
    expect(screen.getByText('Next: Calendars · optional, you can continue without changes')).toBeInTheDocument();
    await expectNoA11yViolations();
    await next(user, TITLES.calendars);
    expect(engine.dispatched('settings.save')).toEqual([]);
  });

  it('finishes from the calendars, saving the calendar choice first, and gives the app back', async () => {
    const { engine, user } = await renderOnboarding();
    engine.handle('app.finishOnboarding', (_intent, mock) => mock.patchSlice('app', { onboarding: false, visiblePage: 'overview' }));
    await next(user, TITLES.accounts);
    await next(user, TITLES.sources);
    await next(user, TITLES.calendars);
    const show = screen.getByRole('switch', { name: /Show my calendar on Today/ });
    await user.click(show);
    await expectNoA11yViolations();
    await user.click(continueButton());
    expect(engine.dispatched('settings.save')).toHaveLength(1);
    expect(engine.dispatched('settings.save')[0]?.configuration.calendarEnabled).toBe(!sampleSlices().settings!.configuration.calendarEnabled);
    expect(engine.dispatched('app.finishOnboarding')).toHaveLength(1);
    expect(await screen.findByText('The app')).toBeInTheDocument();
  });

  it('finishes without saving when nothing changed', async () => {
    const { engine, user } = await renderOnboarding();
    await next(user, TITLES.accounts);
    await next(user, TITLES.sources);
    await next(user, TITLES.calendars);
    await user.click(continueButton());
    expect(engine.dispatched('settings.save')).toEqual([]);
    expect(engine.dispatched('app.finishOnboarding')).toHaveLength(1);
  });

  it('shows why setup could not finish, verbatim', async () => {
    const { engine, user } = await renderOnboarding();
    engine.handle('app.finishOnboarding', () => {
      throw new MockEngineError('needsAccess', 'Allow Accessibility for Figma detection, or turn Figma detection off to continue.');
    });
    await next(user, TITLES.accounts);
    await next(user, TITLES.sources);
    await next(user, TITLES.calendars);
    await user.click(continueButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Allow Accessibility for Figma detection, or turn Figma detection off to continue.',
    );
    expect(screen.queryByText('The app')).not.toBeInTheDocument();
  });

  it('has three steps on Windows, where there are no calendars', async () => {
    const windows: AppSlice = { ...onboardingApp, os: 'windows', features: { ...onboardingApp.features, calendar: false } };
    const { engine, user } = await renderOnboarding(windows, { platform: 'windows' });
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(screen.getByText(/lives in the notification area/)).toBeInTheDocument();
    await expectNoA11yViolations();
    await next(user, TITLES.accounts);
    await next(user, TITLES.sources);
    expect(continueButton()).toHaveAccessibleName(/^Finish setup/);
    await user.click(continueButton());
    expect(engine.dispatched('app.finishOnboarding')).toHaveLength(1);
  });
});
