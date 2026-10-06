import { act, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { sampleSlices } from '../ipc/fixtures';
import { renderWithEngine } from '../test/engine';
import { MainSurface } from './MainSurface';

function appWith(hidden: string[]) {
  const app = sampleSlices().app!;
  return { ...app, pages: app.pages.map((page) => ({ ...page, hidden: hidden.includes(page.id) })) };
}

describe('MainSurface', () => {
  it('builds the sidebar from the engine pages, with badges and hidden pages', async () => {
    renderWithEngine(<MainSurface />, { with: { app: appWith(['statistics']) } });
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(nav).toHaveTextContent('Weekly report');
    expect(nav).not.toHaveTextContent('Statistics');
    expect(screen.getByRole('button', { name: 'Overview, 1 pending suggestion' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
  });

  it('reports the visible page to the engine and follows navigation', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />);
    await waitFor(() => expect(engine.dispatched('app.setVisiblePage')).toEqual([{ type: 'app.setVisiblePage', page: 'overview' }]));
    await user.click(screen.getByRole('button', { name: /^History/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'History' })).toBeInTheDocument();
    expect(engine.dispatched('app.setVisiblePage').at(-1)).toEqual({ type: 'app.setVisiblePage', page: 'history' });
  });

  it('falls back to Overview when the open page gets hidden', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />);
    await user.click(screen.getByRole('button', { name: /^Figma/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Figma' })).toBeInTheDocument();
    act(() => engine.setSlice('app', appWith(['figma'])));
    expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
  });

  it('shows and dismisses the latest error', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />, {
      with: { app: { ...sampleSlices().app!, error: 'The 7pace timer changed on the server.' } },
    });
    expect(screen.getByText('The 7pace timer changed on the server.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss error' }));
    expect(engine.dispatched('app.dismissError')).toHaveLength(1);
  });

  it('pauses and resumes branch watching from the sidebar', async () => {
    const { engine, user } = renderWithEngine(<MainSurface />);
    await user.click(screen.getByRole('button', { name: 'Pause watching' }));
    expect(engine.dispatched('repositories.toggleWatching')).toHaveLength(1);
  });
});
