import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { resetMockIpc } from '../../ipc';
import { pausedTracking, runningTracking } from '../../ipc/fixtures/slices/tracking';
import { renderWithEngine } from '../../test/engine';
import { CurrentTracking } from './CurrentTracking';
import { TopBarTimer } from './TopBarTimer';

afterEach(() => {
  resetMockIpc();
});

describe('the running activity', () => {
  it('shows next to the timer in the top bar, running or paused', () => {
    const first = renderWithEngine(<TopBarTimer />, { with: { tracking: runningTracking } });
    expect(screen.getByRole('group', { name: 'Running timer' })).toHaveTextContent('Development');
    first.unmount();
    renderWithEngine(<TopBarTimer />, { with: { tracking: pausedTracking } });
    expect(screen.getByRole('group', { name: 'Paused timer' })).toHaveTextContent('Development');
  });

  it('shows under the title in the menu bar panel', () => {
    renderWithEngine(<CurrentTracking surface="panel" />, { with: { tracking: runningTracking } });
    expect(screen.getByText('Development')).toBeVisible();
  });
});
