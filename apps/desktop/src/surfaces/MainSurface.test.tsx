import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { sampleSlices } from '../ipc/fixtures';
import { renderWithEngine } from '../test/engine';
import { MainSurface } from './MainSurface';

function appWith(hidden: string[], visiblePage: string | null = null) {
  const app = sampleSlices().app!;
  return { ...app, visiblePage, pages: app.pages.map((page) => ({ ...page, hidden: hidden.includes(page.id) })) };
}

function topBar() {
  return screen.getByRole('banner');
}

describe('MainSurface', () => {
  it('opens on Today with the timer in the top bar', async () => {
    renderWithEngine(<MainSurface />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
    expect(within(topBar()).getByRole('group', { name: 'Running timer' })).toHaveTextContent('#4821');
    expect(await screen.findByRole('main')).toBeInTheDocument();
  });

  it('reports what the view shows to the engine and follows navigation', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />);
    await waitFor(() =>
      expect(engine.dispatched('app.setVisiblePage')).toEqual([{ type: 'app.setVisiblePage', page: 'overview', also: ['dayReview'] }]),
    );
    await user.click(screen.getByRole('button', { name: 'Insights' }));
    await waitFor(() =>
      expect(engine.dispatched('app.setVisiblePage').at(-1)).toEqual({ type: 'app.setVisiblePage', page: 'statistics', also: ['weeklyReport'] }),
    );
    await user.click(within(topBar()).getByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(engine.dispatched('app.setVisiblePage').at(-1)).toEqual({ type: 'app.setVisiblePage', page: 'settings', also: [] }));
  });

  it('reopens on the view of the page the engine last saw', async () => {
    const { engine } = renderWithEngine(<MainSurface />, { with: { app: appWith([], 'timeEditor') } });
    expect(screen.getByRole('button', { name: 'Timesheet' })).toHaveAttribute('aria-current', 'page');
    await waitFor(() => expect(engine.dispatched('app.setVisiblePage').at(-1)).toMatchObject({ page: 'timeEditor' }));
  });

  it('falls back when the open view gets hidden', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />);
    await user.click(screen.getByRole('button', { name: 'Insights' }));
    await waitFor(() => expect(engine.dispatched('app.setVisiblePage').at(-1)).toMatchObject({ page: 'statistics' }));
    act(() => engine.setSlice('app', appWith(['statistics', 'weeklyReport'])));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-current', 'page'));
    expect(screen.queryByRole('button', { name: 'Insights' })).toBeNull();
  });

  it('shows and dismisses the latest error', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />, {
      with: { app: { ...sampleSlices().app!, error: 'The 7pace timer changed on the server.' } },
    });
    expect(screen.getByText('The 7pace timer changed on the server.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(engine.dispatched('app.dismissError')).toHaveLength(1);
  });

  it('pauses and stops the timer from the top bar', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />);
    const timer = within(topBar()).getByRole('group', { name: 'Running timer' });
    await user.click(within(timer).getByRole('button', { name: 'Pause timer' }));
    expect(engine.dispatched('tracking.pause')).toHaveLength(1);
    await user.click(within(timer).getByRole('button', { name: 'Stop timer' }));
    expect(engine.dispatched('tracking.stop')).toHaveLength(1);
  });
});
