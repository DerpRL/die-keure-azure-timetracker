import type { SliceMap, TicketContextSlice } from '../../contract';

/** Closed: no ticket requested (the preview opens it from any ticket link). */
const ticketContext: TicketContextSlice = {
  ticketId: null,
  details: null,
  loading: false,
  issue: null,
  azureUrl: null,
};

export const contextLoading: TicketContextSlice = {
  ticketId: 4821,
  details: null,
  loading: true,
  issue: null,
  azureUrl: 'https://dev.azure.com/contoso/_workitems/edit/4821',
};

export const contextLoaded: TicketContextSlice = {
  ...contextLoading,
  loading: false,
  details: {
    id: 4821,
    title: 'Checkout: retry failed card payments',
    state: 'Active',
    type: 'User Story',
    assignedTo: 'Sam Peeters',
    project: 'Webshop',
    iteration: 'Webshop\\Sprint 41',
    tags: 'checkout; payments',
    description:
      'When a card payment fails with a temporary error, retry it once before showing the error.\n\nKeep the order in the "pending" state while the retry runs.',
    acceptanceCriteria: '- A temporary failure is retried once\n- The customer sees one message, not two\n- Permanent failures are not retried',
    links: [
      { title: 'Payment provider: retry guidance', url: 'https://docs.example.com/payments/retries' },
      { title: 'Checkout flow (Figma)', url: 'https://www.figma.com/file/AbC123/Checkout' },
      { title: 'Internal wiki', url: 'http://wiki.contoso.local/checkout' },
    ],
  },
};

/** A ticket with empty fields: "Not set" and "No details provided." */
export const contextSparse: TicketContextSlice = {
  ...contextLoading,
  ticketId: 4777,
  loading: false,
  azureUrl: 'https://dev.azure.com/contoso/_workitems/edit/4777',
  details: {
    id: 4777,
    title: 'Sprint ceremonies',
    state: 'New',
    type: 'Task',
    assignedTo: '',
    project: 'Webshop',
    iteration: '',
    tags: '',
    description: '',
    acceptanceCriteria: '',
    links: [],
  },
};

export const contextFailed: TicketContextSlice = {
  ...contextLoading,
  loading: false,
  issue: 'Add your Azure organization and PAT in Settings to load ticket details.',
};

export default { ticketContext } satisfies Partial<SliceMap>;
