import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetMockIpc } from '../../ipc';
import { disconnectedConnection } from '../../ipc/fixtures/slices/connection';
import { localTracking, localWithPausedTracking, pausedTracking, stoppedTracking } from '../../ipc/fixtures/slices/tracking';
import { renderWithEngine } from '../../test/engine';
import { expectAccessible } from '../tracking/testHelpers';
import { MiniTimerView } from './MiniTimerView';

afterEach(() => {
  resetMockIpc();
  vi.useRealTimers();
});

const render = (options: Parameters<typeof renderWithEngine>[1] = {}) =>
  renderWithEngine(<MiniTimerView />, { providers: { builtInShortcuts: false }, ...options });

describe('MiniTimerView', () => {
  it('shows the running clock and what it tracks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T08:00:00Z'));
    render();
    const timer = screen.getByRole('timer', { name: 'Elapsed time' });
    expect(timer).toHaveTextContent('1 hour 23 minutes 20 seconds');
    expect(screen.getByRole('main', { name: 'Mini timer' })).toHaveTextContent('Tracking: Checkout: retry failed card payments');
    act(() => {
      vi.advanceTimersByTime(2010);
    });
    expect(timer).toHaveTextContent('1 hour 23 minutes 22 seconds');
    vi.useRealTimers();
    await expectAccessible();
  });

  it('puts the local timer first when it leads', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T08:00:00Z'));
    render({ with: { tracking: localWithPausedTracking } });
    // Started at 07:15: 45 minutes.
    expect(screen.getByRole('timer', { name: 'Local timer' })).toHaveTextContent('45 minutes');
    expect(screen.getByText('Local tracking:', { exact: false })).toBeInTheDocument();
    expect(screen.getByTitle('Design system: date picker tokens')).toBeInTheDocument();
  });

  it('says when no timer runs and when one is paused', () => {
    const first = render({ with: { tracking: stoppedTracking } });
    expect(screen.getAllByText('No timer running').length).toBeGreaterThan(0);
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    first.unmount();
    render({ with: { tracking: pausedTracking } });
    expect(screen.getByTitle('Paused · Invoice PDF shows the wrong VAT number')).toBeInTheDocument();
  });

  it('keeps a disconnected timer still', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T08:00:00Z'));
    render({ with: { connection: disconnectedConnection, tracking: { ...localTracking, showsLocalTimer: false, local: null, running: true, elapsedBase: 60, extrapolate: false } } });
    const timer = screen.getByRole('timer', { name: 'Elapsed time' });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(timer).toHaveTextContent('1 minute, last known');
  });

  it('opens the panel with its button or Return', async () => {
    const { engine, user } = render();
    await user.click(screen.getByRole('button', { name: 'Show the Azure timetracker panel' }));
    await user.keyboard('{Enter}');
    expect(engine.ipc.calls.filter((call) => call.command === 'shell_toggle_panel')).toHaveLength(2);
  });

  it('is a drag region everywhere but its button', () => {
    render();
    const main = screen.getByRole('main', { name: 'Mini timer' });
    expect(main.querySelector('[data-tauri-drag-region="deep"]')).toContainElement(screen.getByRole('timer'));
    expect(screen.getByRole('button').closest('[data-tauri-drag-region="deep"]')).toBeNull();
  });

  it('shows a placeholder until the slices arrive', () => {
    render({ slices: {} });
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });
});
