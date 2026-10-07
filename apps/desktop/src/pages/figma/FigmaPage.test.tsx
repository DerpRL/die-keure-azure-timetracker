import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { sampleSlices } from '../../ipc/fixtures';
import {
  emptyFigma,
  figmaWithIssues,
  figmaWithoutAccess,
  fullHistoryFigma,
  pausedFigma,
  searchedFigma,
  titleOnlyFigma,
} from '../../ipc/fixtures/slices/figma';
import { MockEngineError } from '../../ipc/mockEngine';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine } from '../../test/engine';
import FigmaPage from './index';
import { localDay } from './model';

const showMain = vi.hoisted(() => vi.fn((_page?: string) => Promise.resolve()));
vi.mock('../../ipc/shell', () => ({ showMain }));

const figma = () => sampleSlices().figma!;

describe('FigmaPage', () => {
  it('shows a skeleton until the slice arrives', () => {
    const { figma: _, ...slices } = sampleSlices();
    renderWithEngine(<FigmaPage />, { slices });
    expect(screen.getByRole('status')).toHaveTextContent('Loading Figma context');
  });

  it('renders observation, suggestions, last worked ticket and the file register', async () => {
    const { container } = renderWithEngine(<FigmaPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Figma Desktop' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Observe Figma files' })).toBeChecked();
    expect(screen.getByText('File: Checkout – payment retry flows')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Figma file active' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Last worked in Figma' })).toBeInTheDocument();
    const files = within(screen.getByRole('list', { name: 'Figma files' })).getAllByRole('listitem');
    expect(files).toHaveLength(4);
    expect(within(files[0]!).getByRole('button', { name: /#4821 Checkout: retry failed card payments/ })).toBeInTheDocument();
    expect(within(files[2]!).getByText('Not linked to a ticket')).toBeInTheDocument();
    expect(within(files[2]!).getByText('Qa9sD4fG7hJ2kL5z')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show history' })).toHaveAttribute('aria-expanded', 'false');
    await expectNoA11yViolations(container);
  });

  it('explains how files appear when nothing was observed yet', () => {
    renderWithEngine(<FigmaPage />, { with: { figma: emptyFigma } });
    expect(screen.getByRole('heading', { name: 'No matching files' })).toBeInTheDocument();
    expect(screen.getByText(/allow Accessibility and focus a file in Figma Desktop/)).toBeInTheDocument();
    expect(screen.getByText('Waiting for Figma')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear history…' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'Last worked in Figma' })).not.toBeInTheDocument();
  });

  it('saves the preferences immediately', async () => {
    const { user, engine } = renderWithEngine(<FigmaPage />);
    await user.click(screen.getByRole('switch', { name: 'Observe Figma files' }));
    expect(engine.dispatched('figma.setPreferences').at(-1)).toEqual({
      type: 'figma.setPreferences',
      preferences: { ...figma().preferences, enabled: false },
    });
    const days = screen.getByRole('textbox', { name: 'Keep context history for' });
    await user.clear(days);
    await user.type(days, '45');
    await user.tab();
    expect(engine.dispatched('figma.setPreferences').at(-1)).toEqual({
      type: 'figma.setPreferences',
      preferences: { ...figma().preferences, historyDays: 45 },
    });
  });

  it('asks for Accessibility access when it is missing', async () => {
    const { user, engine } = renderWithEngine(<FigmaPage />, { with: { figma: figmaWithoutAccess } });
    expect(screen.getByText('Accessibility permission needed')).toBeInTheDocument();
    expect(screen.getByText(/Privacy & Security → Accessibility/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Allow Accessibility…' }));
    expect(engine.dispatched('figma.requestAccess')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Check permission again' }));
    expect(engine.dispatched('figma.refreshAccess')).toHaveLength(1);
  });

  it('shows the engine’s observation line, with the time Figma was last in front', () => {
    const { engine } = renderWithEngine(<FigmaPage />, { with: { figma: figmaWithIssues } });
    // 07:59:30Z in Brussels.
    expect(screen.getByText('Waiting for Figma · 09:59 · Seen: Checkout – payment retry flows')).toBeInTheDocument();
    act(() => engine.setSlice('figma', pausedFigma));
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('lists the files the engine reports for the last worked ticket', () => {
    const linked = figma().files.filter((file) => file.ticketId === 4821);
    const lastWorked = [{ ...linked[0]!, name: 'Checkout – v2' }, { ...linked[0]!, key: 'other', name: 'Checkout – archive' }];
    renderWithEngine(<FigmaPage />, { with: { figma: { ...figma(), lastWorked } } });
    const list = screen.getByRole('list', { name: 'Files linked to this ticket' });
    expect(within(list).getAllByRole('listitem').map((item) => item.firstChild?.textContent)).toEqual(['Checkout – v2', 'Checkout – archive']);
  });

  it('marks title-only detection on Windows and cannot open those files', async () => {
    const { container } = renderWithEngine(<FigmaPage />, {
      platform: 'windows',
      with: { figma: titleOnlyFigma, app: { ...sampleSlices().app!, os: 'windows', features: { calendar: false, microphone: true, figmaTitleOnly: true } } },
    });
    expect(screen.getByText('Title-only detection (experimental)')).toBeInTheDocument();
    expect(screen.getByText(/Reads only window titles on this PC/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Checkout – payment retry flows' })).toBeDisabled();
    expect(screen.queryByText('title:Invoice PDF layout')).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('shows storage problems and a missing Figma Desktop', () => {
    renderWithEngine(<FigmaPage />, { with: { figma: figmaWithIssues } });
    expect(screen.getByText('Figma context could not be saved')).toBeInTheDocument();
    expect(screen.getByText(/Resolve the storage error before quitting/)).toBeInTheDocument();
    expect(screen.getByText(/Figma Desktop was not found/)).toBeInTheDocument();
  });

  it('searches the register through the engine', async () => {
    const { user, engine } = renderWithEngine(<FigmaPage />);
    await user.type(screen.getByRole('searchbox', { name: 'Search file, key or linked ticket' }), 'invoice');
    await waitFor(() => expect(engine.dispatched('figma.setSearch').at(-1)).toEqual({ type: 'figma.setSearch', query: 'invoice' }));
    // Typing is debounced: one request for the whole word.
    expect(engine.dispatched('figma.setSearch')).toHaveLength(1);
    act(() => engine.setSlice('figma', searchedFigma));
    expect(within(screen.getByRole('list', { name: 'Figma files' })).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('1 file matches')).toBeInTheDocument();
    act(() => engine.setSlice('figma', { ...searchedFigma, search: 'zzz', files: [] }));
    expect(screen.getByText('No file, key or linked ticket matches “zzz”.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(engine.dispatched('figma.setSearch').at(-1)).toEqual({ type: 'figma.setSearch', query: '' });
  });

  it('links a file to a verified ticket', async () => {
    const { user, engine } = renderWithEngine(<FigmaPage />);
    await user.click(screen.getByRole('button', { name: 'Link ticket to Invoice PDF layout' }));
    const dialog = screen.getByRole('dialog', { name: 'Link Figma file' });
    expect(within(dialog).getByText('Invoice PDF layout')).toBeInTheDocument();
    const field = within(dialog).getByRole('textbox', { name: 'Azure ticket number' });
    expect(field).toHaveFocus();
    await user.type(field, 'abc');
    expect(within(dialog).getByText('Enter a valid ticket number.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save link' })).toBeDisabled();
    await expectNoA11yViolations(dialog);

    engine.handle('figma.link', () => {
      throw new MockEngineError('notFound', 'Ticket #4790999 does not exist in Webshop.');
    });
    await user.clear(field);
    await user.type(field, '4790999');
    await user.click(within(dialog).getByRole('button', { name: 'Save link' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ticket #4790999 does not exist in Webshop.');

    engine.handle('figma.link', () => null);
    await user.clear(field);
    await user.type(field, '4790{Enter}');
    expect(engine.dispatched('figma.link').at(-1)).toEqual({ type: 'figma.link', fileKey: 'Qa9sD4fG7hJ2kL5z', ticketId: 4790 });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('prefills the current ticket when changing a link, and unlinks', async () => {
    const { user, engine } = renderWithEngine(<FigmaPage />);
    await user.click(screen.getByRole('button', { name: 'Change ticket for Checkout – payment retry flows' }));
    expect(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Azure ticket number' })).toHaveValue('4821');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Unlink Checkout – payment retry flows' }));
    expect(engine.dispatched('figma.unlink')).toEqual([{ type: 'figma.unlink', fileKey: 'Xk7pQ2mN9vB4cR8t' }]);
  });

  it('disables linking while busy or offline', () => {
    renderWithEngine(<FigmaPage />, { with: { app: { ...sampleSlices().app!, busy: true } } });
    expect(screen.getByRole('button', { name: 'Link ticket to Invoice PDF layout' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start Design…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep tracking' })).toBeDisabled();
  });

  it('opens a file in the browser or in Figma Desktop', async () => {
    const { user, engine } = renderWithEngine(<FigmaPage />);
    await user.click(screen.getByRole('button', { name: 'Open Invoice PDF layout' }));
    await user.click(screen.getByRole('menuitem', { name: 'Browser' }));
    await user.click(screen.getByRole('button', { name: 'Open Invoice PDF layout' }));
    await user.click(screen.getByRole('menuitem', { name: 'Figma Desktop' }));
    expect(engine.dispatched('figma.open')).toEqual([
      { type: 'figma.open', fileKey: 'Qa9sD4fG7hJ2kL5z', desktop: false },
      { type: 'figma.open', fileKey: 'Qa9sD4fG7hJ2kL5z', desktop: true },
    ]);
  });

  it('acts on a suggestion without starting a timer itself', async () => {
    const { user, engine } = renderWithEngine(<FigmaPage />);
    await user.click(screen.getByRole('button', { name: 'Start Design…' }));
    await user.click(screen.getByRole('button', { name: 'Other ticket' }));
    await user.click(screen.getByRole('button', { name: 'Keep tracking' }));
    expect(engine.dispatched('figma.track')).toEqual([
      { type: 'figma.track', suggestionId: 'figma-suggestion-1', useLinkedTicket: true },
      { type: 'figma.track', suggestionId: 'figma-suggestion-1', useLinkedTicket: false },
    ]);
    expect(engine.dispatched('figma.keep')).toEqual([{ type: 'figma.keep', suggestionId: 'figma-suggestion-1' }]);
    expect(engine.dispatched('tracking.start')).toHaveLength(0);
  });

  it('announces a suggestion that arrives while the page is open', async () => {
    const { engine } = renderWithEngine(<FigmaPage />, { with: { figma: { ...figma(), suggestions: [] } } });
    act(() => engine.setSlice('figma', figma()));
    await waitFor(() =>
      expect(document.querySelector('[data-announcer="polite"]')).toHaveTextContent('Figma file active: Design system – date picker'),
    );
  });

  it('shows the history newest first and reviews a day', async () => {
    const { user, engine } = renderWithEngine(<FigmaPage />);
    await user.click(screen.getByRole('button', { name: 'Show history' }));
    const list = screen.getByRole('list', { name: 'Figma observations, newest first' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('Checkout – payment retry flows');
    expect(items[0]).toHaveTextContent('#4821 at the time');
    expect(screen.getByRole('button', { name: 'Hide history' })).toHaveAttribute('aria-expanded', 'true');
    await user.click(within(items[2]!).getByRole('button', { name: /^Review day/ }));
    expect(engine.dispatched('dayReview.setDay')).toEqual([{ type: 'dayReview.setDay', day: localDay('2026-10-05T14:10:00Z') }]);
    await waitFor(() => expect(showMain).toHaveBeenCalledWith('dayReview'));
  });

  it('notes when only the latest 200 observations are shown', async () => {
    const { user, engine } = renderWithEngine(<FigmaPage />, { with: { figma: fullHistoryFigma } });
    await user.click(screen.getByRole('button', { name: 'Show history' }));
    expect(screen.getByText('Showing the latest 200 observations.')).toBeInTheDocument();
    // Exactly 200 in total: nothing is left out.
    act(() => engine.setSlice('figma', { ...fullHistoryFigma, historyCount: 200 }));
    expect(screen.queryByText('Showing the latest 200 observations.')).not.toBeInTheDocument();
  });

  it('clears the history only after confirmation', async () => {
    const { user, engine } = renderWithEngine(<FigmaPage />);
    await user.click(screen.getByRole('button', { name: 'Clear history…' }));
    let dialog = screen.getByRole('alertdialog', { name: 'Clear local Figma history?' });
    expect(within(dialog).getByText('Tracked hours, files and ticket links will stay.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(engine.dispatched('figma.clearHistory')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Clear history…' }));
    dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Clear history' }));
    expect(engine.dispatched('figma.clearHistory')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});
