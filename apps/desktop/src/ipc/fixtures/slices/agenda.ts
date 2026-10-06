import type { AgendaEventView, AgendaSlice, CalendarChoice, SliceMap } from '../../contract';

const calendars: CalendarChoice[] = [
  { id: 'cal-work', title: 'Work', color: '#1d5bd8', source: 'Exchange', selected: true },
  { id: 'cal-team', title: 'Team events', color: '#0e7c73', source: 'Exchange', selected: true },
  { id: 'cal-home', title: 'Home', color: '#c2357c', source: 'iCloud', selected: false },
];

/** Tuesday 6 October 2026 (the samples' "now" is 08:00 UTC, 10:00 in Brussels). */
const events: AgendaEventView[] = [
  {
    id: 'evt-sprint',
    title: 'Sprint 42: review week',
    start: '2026-10-05T22:00:00Z',
    end: '2026-10-06T22:00:00Z',
    allDay: true,
    calendarTitle: 'Team events',
    color: '#0e7c73',
    location: null,
    isNow: false,
  },
  {
    id: 'evt-standup',
    title: 'Daily stand-up',
    start: '2026-10-06T07:00:00Z',
    end: '2026-10-06T07:15:00Z',
    allDay: false,
    calendarTitle: 'Work',
    color: '#1d5bd8',
    location: 'Microsoft Teams',
    isNow: false,
  },
  {
    id: 'evt-review',
    title: 'Checkout retry design review AB#4821',
    start: '2026-10-06T07:30:00Z',
    end: '2026-10-06T08:30:00Z',
    allDay: false,
    calendarTitle: 'Work',
    color: '#1d5bd8',
    location: 'Room Brugge',
    isNow: true,
  },
  {
    id: 'evt-lunch',
    title: 'Lunch & learn: 7pace reports',
    start: '2026-10-06T11:00:00Z',
    end: '2026-10-06T12:00:00Z',
    allDay: false,
    calendarTitle: 'Team events',
    color: '#0e7c73',
    location: 'Cafeteria',
    isNow: false,
  },
  {
    id: 'evt-one-on-one',
    title: '1:1 with Lies',
    start: '2026-10-06T13:00:00Z',
    end: '2026-10-06T13:30:00Z',
    allDay: false,
    calendarTitle: 'Work',
    color: null,
    location: null,
    isNow: false,
  },
];

const agenda: AgendaSlice = {
  supported: true,
  access: 'authorized',
  enabled: true,
  calendars,
  day: '2026-10-06',
  events,
  issue: null,
};

export default { agenda } satisfies Partial<SliceMap>;

/** A day without events in the selected calendars. */
export const agendaEmptyDay: AgendaSlice = { ...agenda, day: '2026-10-10', events: [] };

/** Calendar access was never requested and the integration is off (the default). */
export const agendaNotDetermined: AgendaSlice = {
  ...agenda,
  access: 'notDetermined',
  enabled: false,
  calendars: [],
  events: [],
};

/** Access granted earlier, but the user turned calendar meetings off. */
export const agendaDisabled: AgendaSlice = { ...agenda, enabled: false, events: [] };

/** The user denied access in macOS. */
export const agendaDenied: AgendaSlice = { ...agendaNotDetermined, access: 'denied', enabled: true };

/** A management profile blocks calendar access. */
export const agendaRestricted: AgendaSlice = { ...agendaNotDetermined, access: 'restricted', enabled: true };

/** Windows: no calendar source at launch. */
export const agendaUnsupported: AgendaSlice = {
  ...agendaNotDetermined,
  supported: false,
  access: 'unsupported',
};

/** The calendar could not be read. */
export const agendaWithIssue: AgendaSlice = {
  ...agenda,
  issue: 'The calendar store did not answer. Events may be out of date.',
};

/** Every calendar is shown (none selected). */
export const agendaAllCalendars: AgendaSlice = {
  ...agenda,
  calendars: calendars.map((calendar) => ({ ...calendar, selected: false })),
};
