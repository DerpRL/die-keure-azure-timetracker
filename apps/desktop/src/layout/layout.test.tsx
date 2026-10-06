import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../components/Button';
import { DayReviewIcon, SettingsIcon } from '../components/icons';
import { TimerDisplay } from '../timer/TimerDisplay';
import { TrackingStatusLabel } from '../timer/status';
import { expectNoA11yViolations } from '../test/axe';
import { renderWithProviders } from '../test/render';
import { AppShell } from './AppShell';
import { MiniTimerShell } from './MiniTimerShell';
import { NAV_GROUPS, visiblePages } from './navigation';
import { PageHeader } from './PageHeader';
import { PanelSection, PanelSectionGrid, PanelShell } from './PanelShell';

describe('navigation model', () => {
  it('keeps the 1.14 groups and order', () => {
    expect(NAV_GROUPS.map((group) => [group.title, group.pages])).toEqual([
      ['Today', ['overview', 'dayReview', 'agenda', 'offlineDrafts']],
      ['Insights', ['statistics', 'weeklyReport', 'history', 'timeEditor']],
      ['Setup', ['repositories', 'figma', 'settings']],
    ]);
  });

  it('hides Agenda on Windows and pages whose feature is off', () => {
    expect(visiblePages({ platform: 'windows' }).map((page) => page.id)).not.toContain('agenda');
    expect(visiblePages({ platform: 'macos' }).map((page) => page.id)).toContain('agenda');
    const withoutFigma = visiblePages({ platform: 'macos', features: { figmaContext: false, calendarMeetings: false } });
    expect(withoutFigma.map((page) => page.id)).not.toContain('figma');
    expect(withoutFigma.map((page) => page.id)).not.toContain('agenda');
  });
});

describe('AppShell', () => {
  it('renders labelled groups, the selected page and indicators', async () => {
    const onNavigate = vi.fn();
    const onRefresh = vi.fn();
    const { user } = renderWithProviders(
      <AppShell
        currentPage="statistics"
        onNavigate={onNavigate}
        indicators={{
          overview: { count: 3, label: '3 pending branch changes' },
          dayReview: { dot: true, label: 'Review pending' },
        }}
        header={<PageHeader title="Statistics" status={<span>7pace connected</span>} onRefresh={onRefresh} />}
        sidebarFooter={<Button size="small">Pause watching</Button>}
      >
        <p>Page content</p>
      </AppShell>,
    );
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).getByRole('list', { name: 'Today' })).toBeInTheDocument();
    expect(within(nav).getByRole('list', { name: 'Insights' })).toBeInTheDocument();
    const selected = within(nav).getByRole('button', { name: 'Statistics' });
    expect(selected).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: /Overview/ })).toHaveAccessibleName('Overview, 3 pending branch changes');
    expect(within(nav).getByRole('button', { name: /Day review/ })).toHaveAccessibleName('Day review, Review pending');
    expect(screen.getByRole('main', { name: 'Statistics' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');

    await user.click(within(nav).getByRole('button', { name: 'History' }));
    expect(onNavigate).toHaveBeenCalledWith('history');

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await user.keyboard('{Meta>}r{/Meta}');
    expect(onRefresh).toHaveBeenCalledTimes(2);
    await expectNoA11yViolations();
  });

  it('respects feature flags and the platform', () => {
    renderWithProviders(
      <AppShell currentPage="overview" onNavigate={() => {}} features={{ offlineDrafts: false }} platform="windows">
        <p>Content</p>
      </AppShell>,
    );
    expect(screen.queryByRole('button', { name: 'Agenda' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Offline drafts' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Statistics' })).toHaveAttribute('aria-keyshortcuts', 'Control+3');
  });
});

describe('PanelShell', () => {
  it('scrolls vertically only and groups sections with headings', async () => {
    const onOverview = vi.fn();
    const { user, container } = renderWithProviders(
      <div style={{ width: 420, height: 640 }}>
        <PanelShell
          status={<TrackingStatusLabel status="paused" />}
          footer={
            <PanelSectionGrid
              links={[
                { id: 'overview', label: 'Overview', icon: DayReviewIcon, onPress: onOverview },
                { id: 'settings', label: 'Settings', icon: SettingsIcon, onPress: () => {} },
              ]}
            />
          }
        >
          <PanelSection title="Current tracking">
            <TimerDisplay seconds={120} status="paused" sessionId="x" />
          </PanelSection>
          <PanelSection title="Progress" collapsible defaultExpanded={false} summary="5h 12m today">
            <p>Today</p>
          </PanelSection>
        </PanelShell>
      </div>,
    );
    expect(container.querySelector('[data-surface="panel"] .scroll > main')).not.toBeNull();
    expect(screen.getByRole('main', { name: 'Azure timetracker' })).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    const disclosure = screen.getByRole('button', { name: /Progress/ });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await user.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Overview' }));
    expect(onOverview).toHaveBeenCalled();
    await expectNoA11yViolations();
  });
});

describe('MiniTimerShell', () => {
  it('is a draggable region with a labelled main area', async () => {
    const { container } = renderWithProviders(
      <MiniTimerShell caption="#33624 · Improve loading" actions={<Button size="small">Pause</Button>}>
        <TimerDisplay seconds={60} status="running" sessionId="m" size="small" showRing={false} />
      </MiniTimerShell>,
    );
    expect(container.querySelector('[data-surface="mini"]')).toHaveAttribute('data-tauri-drag-region');
    expect(screen.getByRole('main', { name: 'Mini timer' })).toHaveTextContent('#33624 · Improve loading');
    await expectNoA11yViolations();
  });
});
