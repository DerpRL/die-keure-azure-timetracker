/**
 * The engine contract (docs/engine.md §5–§6), on top of the types generated from Rust in
 * `generated.ts`. Only this file is hand-written: slice names, intent result types and the
 * event envelope. Change it together with `crates/att-engine/src/view.rs` and the intent enums.
 */
import type {
  AgendaSlice,
  AppSlice,
  ConnectionSlice,
  ControllerIntent,
  DayReviewSlice,
  EntriesPage,
  FigmaSlice,
  FlowSlice,
  GenericIntent,
  HistorySlice,
  InterfacePreferences,
  OfflineSlice,
  ProgressSlice,
  PromptsSlice,
  RepositoriesSlice,
  SessionIntent,
  SettingsSlice,
  StatisticsSlice,
  TicketContextSlice,
  TimeEditorSlice,
  TrackingSlice,
  WeeklySlice,
  WorkItem,
} from './generated';

export type * from './generated';

/** Ticket titles the engine knows, keyed by work item id (JSON object keys are strings). */
export type WorkItemsSlice = Record<string, WorkItem>;

/** Every slice the engine publishes, by name. */
export interface SliceMap {
  app: AppSlice;
  interface: InterfacePreferences;
  connection: ConnectionSlice;
  tracking: TrackingSlice;
  flow: FlowSlice;
  prompts: PromptsSlice;
  progress: ProgressSlice;
  history: HistorySlice;
  workItems: WorkItemsSlice;
  repositories: RepositoriesSlice;
  agenda: AgendaSlice;
  settings: SettingsSlice;
  figma: FigmaSlice;
  statistics: StatisticsSlice;
  timeEditor: TimeEditorSlice;
  dayReview: DayReviewSlice;
  weekly: WeeklySlice;
  offline: OfflineSlice;
  ticketContext: TicketContextSlice;
}

export type SliceName = keyof SliceMap;

export const SLICE_NAMES: readonly SliceName[] = [
  'app',
  'interface',
  'connection',
  'tracking',
  'flow',
  'prompts',
  'progress',
  'history',
  'workItems',
  'repositories',
  'agenda',
  'settings',
  'figma',
  'statistics',
  'timeEditor',
  'dayReview',
  'weekly',
  'offline',
  'ticketContext',
];

/** One element of the `engine://slices` event payload. */
export type SliceUpdate = { [K in SliceName]: { name: K; value: SliceMap[K] } }[SliceName];

/** The Tauri event that carries `SliceUpdate[]` (only slices whose JSON changed). */
export const SLICES_EVENT = 'engine://slices';

/** Everything the UI can ask the engine to do: `{ type: "<namespace>.<name>", …args }`. */
export type Intent = GenericIntent | SessionIntent | ControllerIntent;
export type IntentType = Intent['type'];
export type IntentOf<T extends IntentType> = Extract<Intent, { type: T }>;
/** The arguments of an intent, without its `type`. */
export type IntentArgs<T extends IntentType> = Omit<IntentOf<T>, 'type'>;

/**
 * Intents that return a value. Every other intent resolves to `null`; its effect arrives as
 * slices. Failures reject with `{ kind, message }` (`IpcError`): `kind` is stable for logic
 * (`busy`, `invalidIntent`, `notImplemented`, `needsConfirmation`, `authentication`,
 * `accessDenied`, `remoteChanged`, `network`, `timeout`, `storage`, …), `message` is shown
 * verbatim.
 */
export interface IntentResults {
  'app.snapshot': SliceUpdate[];
  'statistics.entries': EntriesPage;
  /** The Settings tester line for the branch under the pattern. */
  'settings.testBranchPattern': string;
}

export type IntentResult<T extends IntentType> = T extends keyof IntentResults ? IntentResults[T] : null;
