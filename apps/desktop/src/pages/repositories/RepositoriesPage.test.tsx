import { act, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PageHeaderSlotContext } from '../../features/app/PageHeaderActions';
import { sampleSlices } from '../../ipc/fixtures';
import {
  emptyRepositories,
  emptyScan,
  failedScan,
  manyScanResults,
  repositoriesWithIssues,
  scanningRepositories,
  scanResults,
} from '../../ipc/fixtures/slices/repositories';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine, type EngineRenderOptions } from '../../test/engine';
import RepositoriesPage from './index';

const open = vi.hoisted(() => vi.fn<(options?: unknown) => Promise<string | string[] | null>>());
vi.mock('@tauri-apps/plugin-dialog', () => ({ open }));

const showMain = vi.hoisted(() => vi.fn((_page?: string) => Promise.resolve()));
vi.mock('../../ipc/shell', () => ({ showMain }));

const ROOT = '/Users/sam/Documents/repositories';

/** The page with a header slot, as the main window renders it. */
function WithHeader({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <>
      <header>
        <div ref={setSlot} />
      </header>
      <main>
        <PageHeaderSlotContext.Provider value={slot}>{children}</PageHeaderSlotContext.Provider>
      </main>
    </>
  );
}

function renderPage(options?: EngineRenderOptions) {
  return renderWithEngine(
    <WithHeader>
      <RepositoriesPage />
    </WithHeader>,
    options,
  );
}

describe('RepositoriesPage', () => {
  it('shows a skeleton until the slice arrives', () => {
    const { repositories: _, ...slices } = sampleSlices();
    renderPage({ slices });
    expect(screen.getByRole('status')).toHaveTextContent('Loading repositories');
  });

  it('lists every repository state with its branch, problem or pause', async () => {
    const { container } = renderPage({ with: { repositories: repositoriesWithIssues } });
    expect(screen.getByRole('heading', { level: 2, name: 'Watched repositories (5)' })).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: '' })).getAllByRole('listitem');
    expect(rows).toHaveLength(5);
    expect(within(rows[0]!).getByText('feature/AB#4790-vat-number')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(`${ROOT}/webshop`)).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Detached HEAD')).toBeInTheDocument();
    expect(within(rows[2]!).getByText(/\.git is missing/)).toBeInTheDocument();
    expect(within(rows[3]!).getByText('Paused')).toBeInTheDocument();
    expect(within(rows[3]!).getByRole('switch', { name: 'Watch legacy-portal' })).not.toBeChecked();
    expect(within(rows[4]!).getByText('Reading branch…')).toBeInTheDocument();
    expect(screen.getByText('Watching branches')).toBeInTheDocument();
    expect(screen.getByText(sampleSlices().settings!.configuration.branchPattern)).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('explains branch watching when there are no repositories yet', async () => {
    const { container } = renderPage({ with: { repositories: emptyRepositories } });
    expect(screen.getByRole('heading', { level: 3, name: 'Choose your repositories' })).toBeInTheDocument();
    expect(screen.getByText(/scan its subfolders and select the repositories/)).toBeInTheDocument();
    expect(screen.getByText('Observations paused')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /Watch branches/ })).not.toBeChecked();
    expect(screen.getAllByRole('button', { name: 'Add repositories…' })).toHaveLength(2);
    await expectNoA11yViolations(container);
  });

  it('turns watching and single repositories on and off', async () => {
    const { user, engine } = renderPage();
    await user.click(screen.getByRole('switch', { name: /Watch branches/ }));
    expect(engine.dispatched('repositories.toggleWatching')).toHaveLength(1);
    await user.click(screen.getByRole('switch', { name: 'Watch design-system' }));
    expect(engine.dispatched('repositories.setEnabled')).toEqual([
      { type: 'repositories.setEnabled', id: '7c1e9b3a-2d4f-4a6b-9c8e-1f3a5b7d9e24', enabled: false },
    ]);
  });

  it('shows a refused change verbatim', async () => {
    const { user, engine } = renderPage();
    engine.handle('repositories.setEnabled', () => {
      throw Object.assign(new Error('Settings could not be saved.'), { kind: 'storage' });
    });
    await user.click(screen.getByRole('switch', { name: 'Watch webshop' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Settings could not be saved.');
  });

  it('removes a repository only after confirmation', async () => {
    const { user, engine } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Remove webshop from watch list' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Remove webshop from the watch list?' });
    expect(within(dialog).getByText(/files stay on disk/)).toBeInTheDocument();
    await expectNoA11yViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(engine.dispatched('repositories.remove')).toHaveLength(0);

    engine.handle('repositories.remove', (intent, mock) => {
      const current = mock.slices.repositories!;
      mock.patchSlice('repositories', { repositories: current.repositories.filter((row) => row.id !== intent.id) });
    });
    await user.click(screen.getByRole('button', { name: 'Remove webshop from watch list' }));
    dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(engine.dispatched('repositories.remove')).toEqual([
      { type: 'repositories.remove', id: '0f9a3c2e-5b7d-4e1a-8c6f-2d4b6a8c0e12' },
    ]);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'webshop' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: /Watched repositories/ })).toHaveFocus());
  });

  it('does nothing when the folder chooser is cancelled', async () => {
    open.mockResolvedValue(null);
    const { user, engine } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Add repositories…' }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: false }));
    expect(engine.dispatched('repositories.scan')).toHaveLength(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('scans the chosen folder and adds the selected repositories', async () => {
    open.mockResolvedValue(ROOT);
    const { user, engine } = renderPage();
    engine.handle('repositories.scan', (_intent, mock) => mock.setSlice('repositories', scanResults));
    await user.click(screen.getByRole('button', { name: 'Add repositories…' }));
    expect(engine.dispatched('repositories.scan')).toEqual([{ type: 'repositories.scan', path: ROOT }]);

    const sheet = await screen.findByRole('dialog', { name: 'Choose repositories' });
    const found = await within(sheet).findByRole('list', { name: 'Repositories found' });
    expect(within(found).getAllByRole('checkbox')).toHaveLength(5);
    const webshop = within(found).getByRole('checkbox', { name: /^webshop/ });
    expect(webshop).toBeChecked();
    expect(webshop).toBeDisabled();
    expect(within(found).getAllByText('Already added')).toHaveLength(2);
    expect(within(sheet).getByText('2 folders could not be read')).toBeInTheDocument();
    expect(within(sheet).getByText('5 found · 0 selected to add')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Add selected (0)' })).toBeDisabled();
    await expectNoA11yViolations(sheet);

    await user.click(within(found).getByRole('checkbox', { name: 'payments-api' }));
    await user.click(within(found).getByRole('checkbox', { name: 'mobile-app' }));
    expect(within(sheet).getByText('5 found · 2 selected to add')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Add selected (2)' }));
    expect(engine.dispatched('repositories.add')).toEqual([
      { type: 'repositories.add', paths: [`${ROOT}/mobile-app`, `${ROOT}/payments-api`] },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('filters, selects all shown and clears the selection', async () => {
    open.mockResolvedValue(ROOT);
    const { user, engine } = renderPage();
    engine.handle('repositories.scan', (_intent, mock) => mock.setSlice('repositories', scanResults));
    await user.click(screen.getByRole('button', { name: 'Add repositories…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Choose repositories' });
    await user.type(within(sheet).getByRole('searchbox', { name: 'Search by name or path' }), 'webshop');
    expect(within(sheet).getAllByRole('checkbox')).toHaveLength(2);
    await user.click(within(sheet).getByRole('button', { name: 'Select all shown' }));
    expect(within(sheet).getByRole('button', { name: 'Add selected (1)' })).toBeEnabled();
    await user.click(within(sheet).getByRole('button', { name: 'Clear selection' }));
    expect(within(sheet).getByRole('button', { name: 'Add selected (0)' })).toBeDisabled();
  });

  it('shows progress while scanning and cancels the scan', async () => {
    open.mockResolvedValue(ROOT);
    const { user, engine } = renderPage();
    engine.handle('repositories.scan', (_intent, mock) => {
      mock.setSlice('repositories', scanningRepositories);
      return new Promise(() => {});
    });
    await user.click(screen.getByRole('button', { name: 'Add repositories…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Choose repositories' });
    expect(within(sheet).getByRole('progressbar', { name: 'Scanning folders…' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Add selected (0)' })).toBeDisabled();
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(engine.dispatched('repositories.cancelScan')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('reports an empty or failed scan', async () => {
    open.mockResolvedValue(`${ROOT}/notes`);
    const { user, engine } = renderPage();
    engine.handle('repositories.scan', (_intent, mock) => mock.setSlice('repositories', emptyScan));
    await user.click(screen.getByRole('button', { name: 'Add repositories…' }));
    expect(await screen.findByText('No repositories found')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(engine.dispatched('repositories.cancelScan')).toHaveLength(0);

    open.mockResolvedValue(`${ROOT}/missing`);
    engine.handle('repositories.scan', (_intent, mock) => mock.setSlice('repositories', failedScan));
    await user.click(screen.getByRole('button', { name: 'Add repositories…' }));
    expect(await screen.findByText('The folder “missing” could not be opened.')).toBeInTheDocument();
  });

  it('pages long scan results', async () => {
    open.mockResolvedValue(ROOT);
    const { user, engine } = renderPage();
    engine.handle('repositories.scan', (_intent, mock) => mock.setSlice('repositories', manyScanResults(250)));
    await user.click(screen.getByRole('button', { name: 'Add repositories…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Choose repositories' });
    expect(await within(sheet).findAllByRole('checkbox')).toHaveLength(100);
    await user.click(within(sheet).getByRole('button', { name: 'Show 100 more of 150' }));
    expect(within(sheet).getAllByRole('checkbox')).toHaveLength(200);
    await user.click(within(sheet).getByRole('button', { name: 'Show 50 more of 50' }));
    expect(within(sheet).getAllByRole('checkbox')).toHaveLength(250);
  });

  it('opens Settings for the ticket pattern', async () => {
    const { user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Change in Settings' }));
    expect(showMain).toHaveBeenCalledWith('settings');
  });

  it('updates when the engine publishes a change', () => {
    const { engine } = renderPage();
    act(() => engine.setSlice('repositories', emptyRepositories));
    expect(screen.getByRole('heading', { name: 'Choose your repositories' })).toBeInTheDocument();
  });
});
