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

const TITLE = { level: 1, name: 'Make yourself comfortable' } as const;

/** Renders the gate on the first run and waits for the (lazily loaded) onboarding. */
async function renderOnboarding(app: AppSlice = onboardingApp, options: EngineRenderOptions = {}) {
  const result = renderWithEngine(<Gated />, { ...options, with: { app } });
  await screen.findByRole('heading', TITLE);
  return result;
}

describe('OnboardingGate', () => {
  it('renders the app when onboarding is done', () => {
    renderWithEngine(<Gated />);
    expect(screen.getByText('The app')).toBeInTheDocument();
    expect(screen.queryByRole('heading', TITLE)).not.toBeInTheDocument();
  });

  it('renders the app until the app slice arrives', () => {
    renderWithEngine(<Gated />, { slices: {} });
    expect(screen.getByText('The app')).toBeInTheDocument();
  });

  it('shows the appearance onboarding instead of the app on first run', async () => {
    await renderOnboarding();
    expect(screen.queryByText('The app')).not.toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Make yourself comfortable' })).toBeInTheDocument();
    expect(screen.getByRole('heading', TITLE)).toHaveFocus();
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Text and control size' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Contrast' })).toBeInTheDocument();
    const steps = within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem');
    expect(steps.map((step) => step.textContent)).toEqual(['1Appearance', '2Accounts']);
    expect(steps[0]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('switch', { name: 'Observe Figma files' })).toBeInTheDocument();
    expect(screen.getByText('Next: connect Azure DevOps and 7pace.')).toBeInTheDocument();
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

  it('turns Figma observation on through figma.setPreferences', async () => {
    const { engine, user } = await renderOnboarding();
    await user.click(screen.getByRole('switch', { name: 'Observe Figma files' }));
    expect(engine.dispatched('figma.setPreferences')).toEqual([
      { type: 'figma.setPreferences', preferences: { enabled: true, dismissalMinutes: 15, historyDays: 30 } },
    ]);
  });

  it('continues to the app with app.finishOnboarding', async () => {
    const { engine, user } = await renderOnboarding();
    engine.handle('app.finishOnboarding', (_intent, mock) => mock.patchSlice('app', { onboarding: false, visiblePage: 'settings' }));
    await user.click(screen.getByRole('button', { name: 'Continue to setup' }));
    expect(engine.dispatched('app.finishOnboarding')).toHaveLength(1);
    expect(await screen.findByText('The app')).toBeInTheDocument();
  });

  it('continues with ⌘Return', async () => {
    const { engine, user } = await renderOnboarding();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(engine.dispatched('app.finishOnboarding')).toHaveLength(1);
  });

  it('shows why setup could not continue, verbatim', async () => {
    const { engine, user } = await renderOnboarding();
    engine.handle('app.finishOnboarding', () => {
      throw new MockEngineError('needsAccess', 'Allow Accessibility for Figma detection, or turn Figma detection off to continue.');
    });
    await user.click(screen.getByRole('button', { name: 'Continue to setup' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Allow Accessibility for Figma detection, or turn Figma detection off to continue.',
    );
    expect(screen.queryByText('The app')).not.toBeInTheDocument();
  });

  it('replaces the whole main window and gives it back afterwards', async () => {
    const { engine } = renderWithEngine(<MainSurface />, { with: { app: onboardingApp } });
    await screen.findByRole('heading', TITLE);
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    act(() => engine.setSlice('app', { ...sampleSlices().app!, onboarding: false }));
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('continues to the accounts step with die Keure’s accounts prefilled and the 7pace steps', async () => {
    // In the app the shell opens Settings (`show_main(Some("settings"))`); here the window
    // starts on the page the engine names.
    const app = { ...onboardingApp, visiblePage: 'settings' };
    const { engine, user } = renderWithEngine(<MainSurface />, {
      with: { app, settings: unconfiguredSettings, connection: unconfiguredConnection },
    });
    engine.handle('app.finishOnboarding', (_intent, mock) => mock.patchSlice('app', { onboarding: false, visiblePage: 'settings' }));
    await user.click(await screen.findByRole('button', { name: 'Continue to setup' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Connect your accounts to start tracking' })).toBeInTheDocument();
    expect(screen.getByLabelText('Organization')).toHaveValue('diekeure-webdev');
    expect(screen.getByLabelText('Project (optional)')).toHaveValue('LK2020');
    expect(screen.getByLabelText('Workspace URL')).toHaveValue('https://diekeure-webdev.timehub.7pace.com');
    expect(screen.getByRole('button', { name: 'Test and save' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'How to get a 7pace API token' })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    await renderOnboarding({ ...onboardingApp, os: 'windows' }, { platform: 'windows' });
    expect(screen.getByText(/lives in the notification area/)).toBeInTheDocument();
    await expectNoA11yViolations();
  });
});
