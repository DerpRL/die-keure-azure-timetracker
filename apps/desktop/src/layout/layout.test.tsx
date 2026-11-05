import { screen, within } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TextField } from '../components/Fields';
import { Button } from '../components/Button';
import { DayReviewIcon, SettingsIcon } from '../components/icons';
import { TimerDisplay } from '../timer/TimerDisplay';
import { TrackingStatusLabel } from '../timer/status';
import { expectNoA11yViolations } from '../test/axe';
import { renderWithProviders } from '../test/render';
import { AppShell } from './AppShell';
import { MiniTimerShell } from './MiniTimerShell';
import {
  enginePages,
  LEGACY_ROUTES,
  PAGE_IDS,
  pageVisibility,
  parseNavTarget,
  resolveRoute,
  routeKey,
  SETTINGS_GROUPS,
  toRoute,
  visiblePlaces,
  visibleViews,
  type Route,
} from './navigation';
import { PlaceHeader, ViewTabs } from './Place';
import { PanelSection, PanelSectionGrid, PanelShell } from './PanelShell';

describe('navigation model', () => {
  const all = pageVisibility({ platform: 'macos' });

  it('has four places: Today, Timesheet and Insights in the top bar, Settings behind the gear', () => {
    expect(visiblePlaces(all).map((place) => [place.title, place.inTopBar])).toEqual([
      ['Today', true],
      ['Timesheet', true],
      ['Insights', true],
      ['Settings', false],
    ]);
    expect(visibleViews('timesheet', all).map((view) => view.title)).toEqual(['Week', 'Day', 'List', 'Drafts']);
    expect(visibleViews('insights', all).map((view) => view.title)).toEqual(['Where time went', 'Patterns', 'Weekly report']);
    expect(SETTINGS_GROUPS.map((group) => [group.title, group.views])).toEqual([
      ['Account', ['accounts']],
      ['Tracking', ['tracking']],
      ['Sources', ['sources', 'git', 'figma', 'calendars']],
      ['App', ['appearance']],
    ]);
  });

  it('maps every 1.14 page to where it lives now', () => {
    expect(PAGE_IDS.map((page) => [page, routeKey(LEGACY_ROUTES[page])])).toEqual([
      ['overview', 'today'],
      ['dayReview', 'today'],
      ['agenda', 'today'],
      ['offlineDrafts', 'timesheet/drafts'],
      ['statistics', 'insights/time'],
      ['weeklyReport', 'insights/report'],
      ['history', 'timesheet/list'],
      ['timeEditor', 'timesheet/day'],
      ['repositories', 'settings/git'],
      ['figma', 'settings/figma'],
      ['settings', 'settings/accounts'],
    ]);
  });

  it('reads navigation requests: page ids, places and place/view', () => {
    expect(parseNavTarget('timeEditor')).toEqual({ place: 'timesheet', view: 'day' });
    expect(parseNavTarget('insights')).toEqual({ place: 'insights', view: 'time' });
    expect(parseNavTarget('today')).toEqual({ place: 'today' });
    expect(parseNavTarget('settings/git')).toEqual({ place: 'settings', view: 'git' });
    expect(parseNavTarget('settings/nope')).toBeNull();
    expect(parseNavTarget('nowhere')).toBeNull();
    expect(parseNavTarget(null)).toBeNull();
  });

  it('hides views whose page is hidden or unavailable, and places without views', () => {
    const windows = pageVisibility({ platform: 'windows' });
    expect(visibleViews('settings', windows).map((view) => view.id)).not.toContain('calendars');
    const hidden = pageVisibility({ platform: 'macos', hiddenPages: ['statistics', 'weeklyReport', 'offlineDrafts'] });
    expect(visiblePlaces(hidden).map((place) => place.id)).toEqual(['today', 'timesheet', 'settings']);
    expect(visibleViews('timesheet', hidden).map((view) => view.id)).toEqual(['week', 'day', 'list']);
    // Overview and Settings can never be hidden.
    expect(pageVisibility({ platform: 'macos', hiddenPages: ['overview', 'settings'] })('settings')).toBe(true);
    // Hiding the calendar from Today keeps its settings; turning the calendar feature off does not.
    expect(visibleViews('settings', pageVisibility({ platform: 'macos', hiddenPages: ['agenda'] })).map((view) => view.id)).toContain('calendars');
    expect(
      visibleViews('settings', pageVisibility({ platform: 'macos', features: { calendarMeetings: false } })).map((view) => view.id),
    ).not.toContain('calendars');
    const withoutFigma = pageVisibility({ platform: 'macos', features: { figmaContext: false } });
    expect(visibleViews('settings', withoutFigma).map((view) => view.id)).not.toContain('figma');
  });

  it('falls back to the first visible view of the place, then Today', () => {
    const hidden = pageVisibility({ platform: 'macos', hiddenPages: ['timeEditor', 'statistics', 'weeklyReport'] });
    expect(resolveRoute({ place: 'timesheet', view: 'day' }, hidden)).toEqual({ place: 'timesheet', view: 'week' });
    expect(resolveRoute({ place: 'insights', view: 'time' }, hidden)).toEqual({ place: 'today' });
    expect(resolveRoute({ place: 'insights', view: 'patterns' }, all)).toEqual({ place: 'insights', view: 'patterns' });
  });

  it('tells the engine every page a view shows, skipping hidden ones', () => {
    expect(enginePages({ place: 'today' }, all)).toEqual({ page: 'overview', also: ['dayReview'] });
    expect(enginePages({ place: 'insights', view: 'time' }, all)).toEqual({ page: 'statistics', also: ['weeklyReport'] });
    expect(enginePages({ place: 'timesheet', view: 'week' }, all)).toEqual({ page: 'history', also: ['timeEditor'] });
    expect(enginePages({ place: 'settings', view: 'git' }, all)).toEqual({ page: 'repositories', also: [] });
    const noReport = pageVisibility({ platform: 'macos', hiddenPages: ['weeklyReport', 'dayReview'] });
    expect(enginePages({ place: 'insights', view: 'time' }, noReport)).toEqual({ page: 'statistics', also: [] });
    expect(enginePages({ place: 'today' }, noReport)).toEqual({ page: 'overview', also: [] });
  });
});

function ShellHarness({
  initial = { place: 'today' },
  onNavigate = () => {},
  hiddenPages = [],
  platform = 'macos',
}: {
  initial?: Route;
  onNavigate?: (route: Route) => void;
  hiddenPages?: string[];
  platform?: 'macos' | 'windows';
}) {
  const [route, setRoute] = useState<Route>(initial);
  const visible = useMemo(() => pageVisibility({ platform, hiddenPages }), [platform, hiddenPages]);
  return (
    <AppShell
      route={route}
      isPageVisible={visible}
      platform={platform}
      onNavigate={(target) => {
        const next = toRoute(target);
        setRoute(next);
        onNavigate(next);
      }}
      timer={<span>01:23:20</span>}
    >
      <PlaceHeader title={route.place === 'today' ? 'Tuesday 6 October' : routeKey(route)} />
      <TextField label="Comment" />
    </AppShell>
  );
}

describe('AppShell', () => {
  it('shows the top bar: brand, places, search, timer and the Settings gear', async () => {
    const onNavigate = vi.fn();
    const { user } = renderWithProviders(<ShellHarness onNavigate={onNavigate} />);
    const banner = screen.getByRole('banner');
    expect(within(banner).getByText('Azure timetracker')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getAllByRole('button').map((button) => button.textContent)).toEqual(['Today', 'Timesheet', 'Insights']);
    expect(within(nav).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
    expect(within(banner).getByText('01:23:20')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Tuesday 6 October' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');

    await user.click(within(nav).getByRole('button', { name: 'Insights' }));
    expect(onNavigate).toHaveBeenLastCalledWith({ place: 'insights', view: 'time' });
    expect(within(nav).getByRole('button', { name: 'Insights' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main', { name: 'insights/time' })).toBeInTheDocument();

    const gear = within(banner).getByRole('button', { name: 'Settings' });
    expect(gear).not.toHaveAttribute('aria-current');
    await user.click(gear);
    expect(onNavigate).toHaveBeenLastCalledWith({ place: 'settings', view: 'accounts' });
    expect(within(banner).getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('button', { current: 'page' })).toBeNull();
    await expectNoA11yViolations();
  });

  it('opens the command palette from the search button', async () => {
    const { user } = renderWithProviders(<ShellHarness />);
    const search = screen.getByRole('button', { name: /Search or jump to/ });
    expect(search).toHaveAttribute('aria-keyshortcuts', 'Meta+K');
    await user.click(search);
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(within(palette).getByText('Go to Today')).toBeInTheDocument();
    expect(within(palette).getByText('Go to Weekly report')).toBeInTheDocument();
    expect(within(palette).queryByText('Go to timeEditor')).toBeNull();
  });

  it('drops places whose views are all hidden', () => {
    renderWithProviders(<ShellHarness hiddenPages={['statistics', 'weeklyReport']} platform="windows" />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('button', { name: 'Insights' })).toBeNull();
    expect(within(nav).getByRole('button', { name: 'Timesheet' })).toHaveAttribute('aria-keyshortcuts', 'Control+2');
  });
});

describe('PlaceHeader and ViewTabs', () => {
  it('names the main landmark and marks the current view', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <AppShell route={{ place: 'insights', view: 'time' }} isPageVisible={pageVisibility({ platform: 'macos' })} onNavigate={() => {}}>
        <PlaceHeader title="28 Sept – 4 Oct 2026" subtitle="39h 30m" before={<button type="button">Previous period</button>} actions={<button type="button">Export</button>} />
        <ViewTabs
          label="Insights views"
          tabs={[
            { id: 'time', title: 'Where time went' },
            { id: 'patterns', title: 'Patterns' },
          ]}
          current="time"
          onSelect={onSelect}
        />
      </AppShell>,
    );
    expect(screen.getByRole('main', { name: '28 Sept – 4 Oct 2026' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('28 Sept – 4 Oct 2026');
    const tabs = screen.getByRole('navigation', { name: 'Insights views' });
    expect(within(tabs).getByRole('button', { name: 'Where time went' })).toHaveAttribute('aria-current', 'page');
    await user.click(within(tabs).getByRole('button', { name: 'Patterns' }));
    expect(onSelect).toHaveBeenCalledWith('patterns');
    await expectNoA11yViolations();
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
