import type {
  ActivityType,
  BranchPromptView,
  DraftView,
  FigmaPromptView,
  FlowSlice,
  MeetingPromptView,
  PromptsSlice,
  QuickTicketView,
  SliceMap,
} from '../../contract';

// -- flow (ticket search and activity chooser) -----------------------------------------------

export const sampleActivities: ActivityType[] = [
  { id: 'dev', name: 'Development', color: '#2f7de1' },
  { id: 'design', name: 'Design', color: '#b04fd9' },
  { id: 'meeting', name: 'Meeting', color: '#e0912f' },
  { id: 'standup', name: 'Standup', color: '#3aa76d' },
  { id: 'review', name: 'Code review', color: '#6b7280' },
];

export const sampleQuickTickets: QuickTicketView[] = [
  { ticketId: 4821, title: 'Checkout: retry failed card payments', favorite: true },
  { ticketId: 4790, title: 'Invoice PDF shows the wrong VAT number', favorite: false },
  { ticketId: 4777, title: 'Sprint ceremonies', favorite: false },
];

/** Nothing is being chosen. */
export const idleFlow: FlowSlice = {
  surface: 'none',
  draft: null,
  selectedSuggestion: null,
  search: { query: '', results: [], searching: false, error: null },
  activityTypes: sampleActivities,
  activitiesLoaded: true,
  loadingActivities: false,
  activityError: null,
  quickTickets: sampleQuickTickets,
  defaultActivityId: 'dev',
};

/** Quick switch in the panel: search with favourites and recent tickets. */
export const panelSearchFlow: FlowSlice = { ...idleFlow, surface: 'panel' };

/** The main window's ticket picker sheet, before a ticket is chosen. */
export const pickerSearchFlow: FlowSlice = { ...idleFlow, surface: 'picker' };

export const searchingFlow: FlowSlice = {
  ...panelSearchFlow,
  search: { query: 'vat', results: [], searching: true, error: null },
};

export const searchResultsFlow: FlowSlice = {
  ...panelSearchFlow,
  search: {
    query: 'vat',
    results: [
      { id: 4790, title: 'Invoice PDF shows the wrong VAT number', teamProject: 'Webshop', type: 'Bug' },
      { id: 4512, title: 'VAT exemption for intra-EU customers', teamProject: 'Webshop', type: 'User Story' },
    ],
    searching: false,
    error: null,
  },
};

export const noResultsFlow: FlowSlice = {
  ...panelSearchFlow,
  search: { query: 'zzz', results: [], searching: false, error: null },
};

export const searchErrorFlow: FlowSlice = {
  ...panelSearchFlow,
  search: { query: '#99999', results: [], searching: false, error: 'Azure ticket #99999 was not found or is not accessible.' },
};

/** Choosing a ticket for a branch suggestion: "Continue without a ticket…" replaces the manual choices. */
export const branchSuggestionFlow: FlowSlice = {
  ...panelSearchFlow,
  selectedSuggestion: { kind: 'branch', title: 'webshop · feature/AB#4790-vat-number', ticketId: 4790 },
  search: {
    query: '4790',
    results: [{ id: 4790, title: 'Invoice PDF shows the wrong VAT number', teamProject: 'Webshop', type: 'Bug' }],
    searching: false,
    error: null,
  },
};

export const figmaSuggestionFlow: FlowSlice = {
  ...panelSearchFlow,
  selectedSuggestion: { kind: 'figma', title: 'Checkout redesign', ticketId: null },
};

export const ticketDraft: DraftView = {
  id: '5d0c2c1e-8a3b-4c7d-9e1f-2a4b6c8d0e13',
  source: 'ticket',
  title: 'Invoice PDF shows the wrong VAT number',
  item: { id: 4790, title: 'Invoice PDF shows the wrong VAT number', teamProject: 'Webshop', type: 'Bug' },
  allowsNoTicket: false,
  manual: null,
  preferredActivityId: 'dev',
  allowedActivityIds: [],
  requiredActivity: null,
  defaultComment: '',
  resume: false,
};

/** The activity chooser for #4790 in the panel. */
export const ticketDraftFlow: FlowSlice = { ...panelSearchFlow, draft: ticketDraft };

/** The same draft in the main window's sheet. */
export const pickerDraftFlow: FlowSlice = { ...pickerSearchFlow, draft: ticketDraft };

/** A branch suggestion: the ticket is optional and the branch becomes the comment. */
export const branchDraftFlow: FlowSlice = {
  ...panelSearchFlow,
  selectedSuggestion: branchSuggestionFlow.selectedSuggestion,
  draft: {
    ...ticketDraft,
    id: '7e1d3b2a-9c4f-4a5e-8b6d-1c3e5f7a9b24',
    source: 'branch',
    allowsNoTicket: true,
    defaultComment: 'feature/AB#4790-vat-number',
  },
};

export const standupDraftFlow: FlowSlice = {
  ...panelSearchFlow,
  draft: {
    id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c55',
    source: 'manual',
    title: 'Stand-up',
    item: null,
    allowsNoTicket: false,
    manual: 'standup',
    preferredActivityId: 'standup',
    allowedActivityIds: ['standup'],
    requiredActivity: null,
    defaultComment: 'daily standup',
    resume: false,
  },
};

/** The Standup activity is missing in 7pace: the chooser explains and cannot start. */
export const missingStandupDraftFlow: FlowSlice = {
  ...standupDraftFlow,
  activityTypes: sampleActivities.filter((activity) => activity.id !== 'standup'),
  draft: {
    ...standupDraftFlow.draft!,
    allowedActivityIds: [],
    preferredActivityId: '',
    requiredActivity: 'The Standup activity is missing in 7pace. Add or enable it before tracking this stand-up.',
  },
};

export const figmaDraftFlow: FlowSlice = {
  ...panelSearchFlow,
  selectedSuggestion: { kind: 'figma', title: 'Checkout redesign', ticketId: 4821 },
  draft: {
    id: '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b66',
    source: 'figma',
    title: 'Checkout: retry failed card payments',
    item: { id: 4821, title: 'Checkout: retry failed card payments', teamProject: 'Webshop', type: 'User Story' },
    allowsNoTicket: true,
    manual: null,
    preferredActivityId: 'design',
    allowedActivityIds: ['design'],
    requiredActivity: null,
    defaultComment: 'Checkout redesign',
    resume: false,
  },
};

/** Resuming the paused session: the primary button says Resume. */
export const resumeDraftFlow: FlowSlice = {
  ...panelSearchFlow,
  draft: {
    ...ticketDraft,
    id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d77',
    source: 'resume',
    resume: true,
  },
};

export const loadingActivitiesFlow: FlowSlice = {
  ...ticketDraftFlow,
  activityTypes: [],
  activitiesLoaded: false,
  loadingActivities: true,
};

export const activityErrorFlow: FlowSlice = {
  ...ticketDraftFlow,
  activityTypes: [],
  activitiesLoaded: false,
  activityError: 'Could not load activity types: The request timed out.',
};

/** 7pace has no activity types: its workspace default is used. */
export const noActivitiesFlow: FlowSlice = { ...ticketDraftFlow, activityTypes: [] };

// -- prompts ----------------------------------------------------------------------------------

export const noPrompts: PromptsSlice = {
  branches: [],
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
};

export const sampleBranch: BranchPromptView = {
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
};

/** A branch without a ticket number. */
export const ticketlessBranch: BranchPromptView = {
  change: {
    ...sampleBranch.change,
    id: '8c2e4a6b-0d1f-4e3a-9b5c-7d9f1b3d5e88',
    branch: 'chore/upgrade-node',
    previousBranch: 'feature/AB#4790-vat-number',
    ticketId: null,
    detectedAt: '2026-10-06T07:59:00Z',
  },
  ticketTitle: null,
  suggestsBreak: false,
};

/** `develop`: offer Pause, Stop or Keep instead of a switch. */
export const integrationBranch: BranchPromptView = {
  change: {
    ...sampleBranch.change,
    id: '4d6f8b0a-2c3e-4f5a-8b7c-9d1e3f5a7b99',
    branch: 'develop',
    previousBranch: 'feature/AB#4821-card-retry',
    ticketId: null,
    detectedAt: '2026-10-06T07:59:30Z',
  },
  ticketTitle: null,
  suggestsBreak: true,
};

export const sampleMeeting: MeetingPromptView = {
  event: {
    id: 'E1F2-occurrence-2026-10-06T08:00:00Z',
    title: 'Sprint review · Webshop',
    start: '2026-10-06T08:00:00Z',
    end: '2026-10-06T08:45:00Z',
    calendar: 'Work',
    ticketId: 4777,
    allDay: false,
    cancelled: false,
    declined: false,
    free: false,
  },
  ticketId: 4777,
};

/** A meeting without a ticket: the title becomes the comment. */
export const ticketlessMeeting: MeetingPromptView = {
  event: { ...sampleMeeting.event, id: 'E9A8-occurrence-2026-10-06T08:00:00Z', title: '1:1 with Robin', ticketId: null },
  ticketId: null,
};

export const sampleFigma: FigmaPromptView = {
  suggestion: {
    id: 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f7a8b9c01',
    file: 'Fk2pQ9xYbL0',
    name: 'Checkout redesign',
    ticketId: 4821,
    created: '2026-10-06T07:57:00Z',
  },
  ticketTitle: 'Checkout: retry failed card payments',
};

export const branchPrompts: PromptsSlice = { ...noPrompts, branches: [sampleBranch] };
export const integrationBranchPrompts: PromptsSlice = { ...noPrompts, branches: [integrationBranch] };
export const meetingPrompts: PromptsSlice = { ...noPrompts, meetings: [sampleMeeting] };
export const microphonePrompts: PromptsSlice = {
  ...noPrompts,
  microphone: [
    { id: 'mic-teams-2026-10-06T07:59:10Z', owner: { id: 'com.microsoft.teams2', name: 'Microsoft Teams' }, started: '2026-10-06T07:59:10Z' },
  ],
};
export const microphoneEndPrompts: PromptsSlice = {
  ...noPrompts,
  microphoneEnd: {
    id: 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e02',
    workspace: 'https://contoso.timehub.7pace.com',
    trackingIdentity: '4821|dev|2026-10-06T06:37:00Z',
    appNames: ['Microsoft Teams'],
    endedAt: '2026-10-06T07:58:55Z',
    notified: true,
  },
  canReturnAfterMicrophone: true,
};
export const meetingReturnPrompts: PromptsSlice = {
  ...noPrompts,
  meetingReturn: {
    ticketId: 4790,
    title: 'Invoice PDF shows the wrong VAT number',
    activityName: 'Development',
    end: '2026-10-06T07:59:00Z',
    ready: true,
  },
};
export const figmaPrompts: PromptsSlice = { ...noPrompts, figma: [sampleFigma] };
export const idlePrompts: PromptsSlice = {
  ...noPrompts,
  idle: {
    id: 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f03',
    session: {
      identity: '4821|dev|2026-10-06T06:37:00Z',
      workLogId: 'wl-running',
      title: 'Checkout: retry failed card payments',
      start: '2026-10-06T06:37:00Z',
    },
    start: '2026-10-06T07:20:00Z',
    end: '2026-10-06T07:52:00Z',
    reason: 'Screen locked',
  },
};
export const idleCorrectionPrompts: PromptsSlice = { ...noPrompts, idleCorrection: idlePrompts.idle };
export const forgottenPrompts: PromptsSlice = {
  ...noPrompts,
  forgotten: { id: 'e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a04', since: '2026-10-06T07:35:00Z', appName: 'Visual Studio Code' },
  forgottenTickets: [
    { repository: 'webshop', ticketId: 4790, title: 'Invoice PDF shows the wrong VAT number' },
    { repository: 'design-system', ticketId: 4655, title: 'Design system: date picker tokens' },
  ],
};
export const completionPrompts: PromptsSlice = {
  ...noPrompts,
  ticketCompletion: {
    id: 'f6a7b8c9-d0e1-4f2a-9b3c-4d5e6f7a8b05',
    scope: 'https://contoso.timehub.7pace.com|contoso',
    trackingIdentity: '4821|dev|2026-10-06T06:37:00Z',
    ticketId: 4821,
    title: 'Checkout: retry failed card payments',
    workflowState: 'Closed',
    notified: true,
  },
};
export const dayReviewPrompts: PromptsSlice = { ...noPrompts, dayReview: { day: '2026-10-06', canSnooze: true } };

/** One of every prompt at once (the idle correction waits behind the idle prompt). */
export const allPrompts: PromptsSlice = {
  ...noPrompts,
  branches: [sampleBranch, ticketlessBranch],
  meetings: [sampleMeeting, ticketlessMeeting],
  microphone: microphonePrompts.microphone,
  microphoneEnd: microphoneEndPrompts.microphoneEnd,
  canReturnAfterMicrophone: true,
  meetingReturn: meetingReturnPrompts.meetingReturn,
  figma: [sampleFigma],
  idle: idlePrompts.idle,
  forgotten: forgottenPrompts.forgotten,
  forgottenTickets: forgottenPrompts.forgottenTickets,
  ticketCompletion: completionPrompts.ticketCompletion,
  dayReview: dayReviewPrompts.dayReview,
};

export default {
  flow: idleFlow,
  prompts: branchPrompts,
} satisfies Partial<SliceMap>;
