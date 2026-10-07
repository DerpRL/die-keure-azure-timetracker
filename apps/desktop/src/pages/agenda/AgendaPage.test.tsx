import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_NOW, sampleSlices } from '../../ipc/fixtures';
import { sampleApp } from '../../ipc/fixtures/slices/app';
import {
  agendaAllCalendars,
  agendaDenied,
  agendaDisabled,
  agendaEmptyDay,
  agendaNotDetermined,
  agendaRestricted,
  agendaUnsupported,
  agendaWithIssue,
} from '../../ipc/fixtures/slices/agenda';
import { expectNoA11yViolations } from '../../test/axe';
import { renderWithEngine } from '../../test/engine';
import AgendaPage from './index';
import { formatTime } from './model';

const showMain = vi.hoisted(() => vi.fn((_page?: string) => Promise.resolve()));
vi.mock('../../ipc/shell', () => ({ showMain }));

beforeEach(() => {
  // Only the date is fixed, so user-event keeps its real timers.
  vi.useFakeTimers({ now: new Date(SAMPLE_NOW), toFake: ['Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AgendaPage', () => {
  it('shows a skeleton until the slice arrives', () => {
    const { agenda: _, ...slices } = sampleSlices();
    renderWithEngine(<AgendaPage />, { slices });
    expect(screen.getByRole('status')).toHaveTextContent('Loading agenda');
  });

  it('lists the day with times, calendars, locations and the current event', async () => {
    const { container } = renderWithEngine(<AgendaPage />);
    expect(screen.getByRole('heading', { level: 2, name: /Tuesday, 6 October 2026/ })).toHaveTextContent('Today');
    const list = screen.getByRole('list', { name: 'Events on Tuesday, 6 October 2026' });
    const events = within(list).getAllByRole('listitem');
    expect(events).toHaveLength(5);
    expect(events[0]).toHaveTextContent('All day');
    expect(events[1]).toHaveTextContent(`${formatTime('2026-10-06T07:00:00Z')} – ${formatTime('2026-10-06T07:15:00Z')}`);
    expect(within(events[1]!).getByRole('heading', { level: 3, name: 'Daily stand-up' })).toBeInTheDocument();
    expect(events[1]).toHaveTextContent('Work · Microsoft Teams');
    expect(events[2]).toHaveAttribute('aria-current', 'time');
    expect(within(events[2]!).getByText('Happening now')).toBeInTheDocument();
    expect(events[1]).not.toHaveAttribute('aria-current');
    expect(events[4]).toHaveTextContent('Work');
    expect(screen.getByText('5 events')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
    await expectNoA11yViolations(container);
  });

  it('moves between days through the engine', async () => {
    const { user, engine } = renderWithEngine(<AgendaPage />);
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    await user.click(screen.getByRole('button', { name: 'Next day' }));
    expect(engine.dispatched('agenda.setDay')).toEqual([
      { type: 'agenda.setDay', day: '2026-10-05' },
      { type: 'agenda.setDay', day: '2026-10-07' },
    ]);
    act(() => engine.setSlice('agenda', agendaEmptyDay));
    expect(screen.getByRole('heading', { level: 2, name: 'Saturday, 10 October 2026' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(engine.dispatched('agenda.setDay').at(-1)).toEqual({ type: 'agenda.setDay', day: '2026-10-06' });
  });

  it('shows an open day', async () => {
    const { container } = renderWithEngine(<AgendaPage />, { with: { agenda: agendaEmptyDay } });
    expect(screen.getByRole('heading', { level: 3, name: 'An open day' })).toBeInTheDocument();
    expect(screen.getByText('No events in your selected calendars.')).toBeInTheDocument();
    expect(screen.getByText('0 events')).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('asks for calendar access before showing events', async () => {
    const { user, engine, container } = renderWithEngine(<AgendaPage />, { with: { agenda: agendaNotDetermined } });
    expect(screen.getByRole('heading', { level: 2, name: 'Bring your day into view' })).toBeInTheDocument();
    expect(screen.getByText(/Your events are only read/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous day' })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole('button', { name: 'Allow calendar access' }));
    expect(engine.dispatched('settings.enableCalendar')).toHaveLength(1);
  });

  it('connects the calendar again when access exists but meetings are off', async () => {
    const { user, engine } = renderWithEngine(<AgendaPage />, { with: { agenda: agendaDisabled } });
    await user.click(screen.getByRole('button', { name: 'Connect calendar' }));
    expect(engine.dispatched('settings.enableCalendar')).toHaveLength(1);
  });

  it('explains denied and restricted access', async () => {
    const { user, engine } = renderWithEngine(<AgendaPage />, { with: { agenda: agendaDenied } });
    expect(screen.getByRole('heading', { name: 'Calendar access is off' })).toBeInTheDocument();
    expect(screen.getByText(/Privacy & Security → Calendars/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check access again' }));
    expect(engine.dispatched('settings.enableCalendar')).toHaveLength(1);
    act(() => engine.setSlice('agenda', agendaRestricted));
    expect(screen.getByRole('heading', { name: 'Calendar access is restricted' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('disables the access request in preview mode and says why', () => {
    const app = { ...sampleApp, preview: true };
    const { engine } = renderWithEngine(<AgendaPage />, { with: { agenda: agendaNotDetermined, app } });
    const allow = screen.getByRole('button', { name: 'Allow calendar access' });
    expect(allow).toBeDisabled();
    expect(allow).toHaveAccessibleDescription('Preview mode: calendar access is turned off.');
    expect(engine.dispatched('settings.enableCalendar')).toHaveLength(0);
  });

  it('shows a refused access request verbatim', async () => {
    const { user, engine } = renderWithEngine(<AgendaPage />, { with: { agenda: agendaNotDetermined } });
    engine.handle('settings.enableCalendar', () => {
      throw new Error('Calendar access is disabled in preview mode.');
    });
    await user.click(screen.getByRole('button', { name: 'Allow calendar access' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Calendar access is disabled in preview mode.');
  });

  it('is unavailable without a calendar source', () => {
    renderWithEngine(<AgendaPage />, { with: { agenda: agendaUnsupported } });
    expect(screen.getByRole('heading', { name: 'Agenda is not available on this computer' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a calendar problem above the events', () => {
    renderWithEngine(<AgendaPage />, { with: { agenda: agendaWithIssue } });
    expect(screen.getByText('The calendar could not be read')).toBeInTheDocument();
    expect(screen.getByText('The calendar store did not answer. Events may be out of date.')).toBeInTheDocument();
    expect(screen.getByText('5 events')).toBeInTheDocument();
  });

  it('names the calendars shown and links to their selection in Settings', async () => {
    const { user, engine } = renderWithEngine(<AgendaPage />);
    const calendars = screen.getByRole('list', { name: 'Calendars shown' });
    expect(within(calendars).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Work · Exchange',
      'Team events · Exchange',
    ]);
    act(() => engine.setSlice('agenda', agendaAllCalendars));
    expect(screen.getByText('All calendars:')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Calendars shown' })).getAllByRole('listitem')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Choose calendars in Settings' }));
    expect(showMain).toHaveBeenCalledWith('settings');
  });
});
