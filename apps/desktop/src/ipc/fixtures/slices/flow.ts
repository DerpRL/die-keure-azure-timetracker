import type { SliceMap } from '../../contract';

export default {
  flow: {
    surface: 'none',
    draft: null,
    selectedSuggestion: null,
    search: { query: '', results: [], searching: false, error: null },
    activityTypes: [
      { id: 'dev', name: 'Development', color: '#2f7de1' },
      { id: 'design', name: 'Design', color: '#b04fd9' },
      { id: 'meeting', name: 'Meeting', color: '#e0912f' },
      { id: 'standup', name: 'Standup', color: '#3aa76d' },
      { id: 'review', name: 'Code review', color: '#6b7280' },
    ],
    activitiesLoaded: true,
    loadingActivities: false,
    activityError: null,
    quickTickets: [
      { ticketId: 4821, title: 'Checkout: retry failed card payments', favorite: true },
      { ticketId: 4790, title: 'Invoice PDF shows the wrong VAT number', favorite: false },
      { ticketId: 4777, title: 'Sprint ceremonies', favorite: false },
    ],
    defaultActivityId: 'dev',
  },
  prompts: {
    branches: [
      {
        change: {
          id: '6b0d7a1e-1c1f-4c55-9a4f-3f2d8f0f9a11',
          repositoryId: '0f9a3c2e-5b7d-4e1a-8c6f-2d4b6a8c0e12',
          repositoryName: 'webshop',
          branch: 'feature/AB#4790-vat-number',
          previousBranch: 'feature/AB#4821-card-retry',
          ticketId: 4790,
          detectedAt: '2026-10-06T07:58:12Z',
        },
        ticketTitle: 'Invoice PDF shows the wrong VAT number',
        suggestsBreak: false,
      },
    ],
    meetings: [],
    microphone: [],
    microphoneEnd: null,
    canReturnAfterMicrophone: false,
    meetingReturn: null,
    figma: [],
    idle: null,
    idleCorrection: null,
    forgotten: null,
    forgottenTickets: [],
    ticketCompletion: null,
    dayReview: null,
  },
} satisfies Partial<SliceMap>;
