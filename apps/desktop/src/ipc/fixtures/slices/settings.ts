import type { InterruptionChoice, PromptKind, SliceMap } from '../../contract';
import { defaultConfiguration } from '../defaults';

/** `PromptKind::label()` in crates/att-core/src/config.rs. */
const LABELS: Record<PromptKind, string> = {
  branch: 'Branch changes',
  meeting: 'Calendar meetings',
  microphone: 'Microphone meetings',
  microphoneEnd: 'Meeting ended',
  meetingReturn: 'Return after meetings',
  figma: 'Figma files',
  idle: 'Time away',
  forgottenTimer: 'Working without a timer',
  ticketCompletion: 'Completed tickets',
  trackingAttention: '7pace timer checks',
  dayReview: 'Day review',
  update: 'App updates',
};

const configuration = {
  ...defaultConfiguration(),
  organization: 'contoso',
  project: 'Webshop',
  sevenPaceUrl: 'https://contoso.timehub.7pace.com',
  activityTypeId: 'dev',
  interfaceSetupCompleted: true,
  repositories: [
    { id: '0f9a3c2e-5b7d-4e1a-8c6f-2d4b6a8c0e12', path: '/Users/sam/Documents/repositories/webshop', enabled: true },
    { id: '7c1e9b3a-2d4f-4a6b-9c8e-1f3a5b7d9e24', path: '/Users/sam/Documents/repositories/design-system', enabled: true },
  ],
};

export default {
  settings: {
    configuration,
    hasAzurePat: true,
    hasSevenPaceToken: true,
    pairing: { pin: null, expiresAt: null, status: null, pairedHost: null, busy: false },
    microphone: { supported: true, owners: [], fresh: true, issue: null },
    interruptions: (Object.keys(LABELS) as PromptKind[]).map(
      (kind): InterruptionChoice => ({ kind, label: LABELS[kind], level: kind === 'trackingAttention' ? 'openAndFocus' : 'openPanel' }),
    ),
  },
} satisfies Partial<SliceMap>;
