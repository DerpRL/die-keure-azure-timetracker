import type { FigmaContextEvent, FigmaFileView, FigmaSlice, SliceMap } from '../../contract';
import { defaultConfiguration } from '../defaults';

const checkout: FigmaFileView = {
  key: 'Xk7pQ2mN9vB4cR8t',
  name: 'Checkout – payment retry flows',
  webUrl: 'https://www.figma.com/file/Xk7pQ2mN9vB4cR8t',
  desktopUrl: 'figma://file/Xk7pQ2mN9vB4cR8t',
  ticketId: 4821,
  ticketTitle: 'Checkout: retry failed card payments',
  lastSeen: '2026-10-06T07:52:00Z',
};

const tokens: FigmaFileView = {
  key: 'Lm3vT8qW1zK6yH2d',
  name: 'Design system – date picker',
  webUrl: 'https://www.figma.com/file/Lm3vT8qW1zK6yH2d',
  desktopUrl: 'figma://file/Lm3vT8qW1zK6yH2d',
  ticketId: 4655,
  ticketTitle: 'Design system: date picker tokens',
  lastSeen: '2026-10-05T14:10:00Z',
};

const invoice: FigmaFileView = {
  key: 'Qa9sD4fG7hJ2kL5z',
  name: 'Invoice PDF layout',
  webUrl: 'https://www.figma.com/file/Qa9sD4fG7hJ2kL5z',
  desktopUrl: 'figma://file/Qa9sD4fG7hJ2kL5z',
  ticketId: null,
  ticketTitle: null,
  lastSeen: '2026-10-02T09:30:00Z',
};

const moodboard: FigmaFileView = {
  key: 'Rt5yU8iO1pA3sD6f',
  name: 'Moodboard autumn campaign',
  webUrl: 'https://www.figma.com/file/Rt5yU8iO1pA3sD6f',
  desktopUrl: 'figma://file/Rt5yU8iO1pA3sD6f',
  ticketId: null,
  ticketTitle: null,
  lastSeen: null,
};

const event = (id: string, timestamp: string, file: FigmaFileView, ticketId: number | null): FigmaContextEvent => ({
  id,
  timestamp,
  kind: 'activation',
  file: file.key,
  name: file.name,
  ticketId,
});

const history: FigmaContextEvent[] = [
  event('e5', '2026-10-06T07:52:00Z', checkout, 4821),
  event('e4', '2026-10-06T07:20:00Z', invoice, null),
  event('e3', '2026-10-05T14:10:00Z', tokens, 4655),
  event('e2', '2026-10-05T09:05:00Z', checkout, 4821),
  event('e1', '2026-10-02T09:30:00Z', invoice, null),
];

const figma: FigmaSlice = {
  preferences: { ...defaultConfiguration().figma, enabled: true },
  access: true,
  installed: true,
  titleOnly: false,
  status: 'file',
  currentFile: checkout.name,
  search: '',
  files: [checkout, tokens, invoice, moodboard],
  suggestions: [
    {
      suggestion: {
        id: 'figma-suggestion-1',
        file: tokens.key,
        name: tokens.name,
        ticketId: 4655,
        created: '2026-10-06T07:58:00Z',
      },
      ticketTitle: 'Design system: date picker tokens',
    },
  ],
  lastWorkedTicket: 4821,
  history,
  storageIssue: null,
  observing: true,
  label: `File: ${checkout.name}`,
  lastForegroundAt: '2026-10-06T07:59:30Z',
  lastWorked: [checkout],
  historyCount: history.length,
};

export default { figma } satisfies Partial<SliceMap>;

/** The sample with nothing observed yet. */
export const emptyFigma: FigmaSlice = {
  ...figma,
  status: 'waiting',
  label: 'Waiting for Figma',
  lastForegroundAt: null,
  currentFile: null,
  files: [],
  suggestions: [],
  lastWorkedTicket: null,
  lastWorked: [],
  history: [],
  historyCount: 0,
};

/** Observation is off (the default). */
export const disabledFigma: FigmaSlice = {
  ...emptyFigma,
  preferences: defaultConfiguration().figma,
  observing: false,
  label: 'Disabled',
};

/** macOS without the Accessibility permission. */
export const figmaWithoutAccess: FigmaSlice = {
  ...figma,
  access: false,
  status: 'missingAccess',
  label: 'Accessibility permission needed',
  currentFile: null,
  suggestions: [],
};

/** Windows: files are known by their window title only, without addresses. */
export const titleOnlyFigma: FigmaSlice = {
  ...figma,
  titleOnly: true,
  status: 'file',
  files: [
    { ...checkout, key: 'title:Checkout – payment retry flows', webUrl: null, desktopUrl: null },
    { ...invoice, key: 'title:Invoice PDF layout', webUrl: null, desktopUrl: null },
  ],
  suggestions: [],
};

/** Figma Desktop is not installed and the context could not be saved. */
export const figmaWithIssues: FigmaSlice = {
  ...figma,
  installed: false,
  status: 'waiting',
  label: `Waiting for Figma · Seen: ${checkout.name}`,
  storageIssue: 'Figma context could not be saved on this Mac. Resolve the storage error before quitting.',
};

/** The register filtered by the search "invoice". */
export const searchedFigma: FigmaSlice = { ...figma, search: 'invoice', files: [invoice] };

/** "Pause watching" in the sidebar: observation is on but paused. */
export const pausedFigma: FigmaSlice = { ...figma, observing: false, label: 'Paused', suggestions: [] };

/** A long history: the engine sends the newest 200 and the total. */
export const fullHistoryFigma: FigmaSlice = {
  ...figma,
  historyCount: 340,
  history: Array.from({ length: 200 }, (_, index) =>
    event(`h${index}`, new Date(Date.parse('2026-10-06T07:52:00Z') - index * 3_600_000).toISOString(), index % 2 ? invoice : checkout, index % 2 ? null : 4821),
  ),
};
