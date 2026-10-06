/**
 * An in-memory engine for the browser preview, the gallery and tests. It answers
 * `engine_dispatch`, `engine_resync` and `engine_snapshot` on the mock IPC backend, publishes
 * slices as `engine://slices` like the Rust engine, and records every intent.
 *
 *   const engine = installMockEngine({ slices: sampleSlices() });
 *   engine.handle('tracking.stop', (_intent, mock) => mock.setSlice('tracking', stopped));
 */
import { createMockIpc, setMockIpc, type MockIpc } from './index';
import {
  SLICES_EVENT,
  type Intent,
  type IntentOf,
  type IntentType,
  type SliceMap,
  type SliceName,
  type SliceUpdate,
} from './contract';

/** What a handler throws to reject an intent like the engine does (`{ kind, message }`). */
export class MockEngineError extends Error {
  readonly kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.name = 'MockEngineError';
    this.kind = kind;
  }
}

export type MockIntentHandler<T extends IntentType> = (intent: IntentOf<T>, engine: MockEngine) => unknown;

export interface MockEngine {
  readonly ipc: MockIpc;
  /** Every intent dispatched so far, in order. */
  readonly intents: Intent[];
  /** The current slices (what a resync sends). */
  readonly slices: Partial<SliceMap>;
  /** Replaces one slice and publishes it. */
  setSlice<K extends SliceName>(name: K, value: SliceMap[K]): void;
  /** Applies a partial change to one slice and publishes it. */
  patchSlice<K extends SliceName>(name: K, patch: Partial<SliceMap[K]>): void;
  /** Publishes a batch as the engine would. */
  emit(updates: SliceUpdate[]): void;
  /** Answers one intent type: its return value is the result; throw `MockEngineError` to reject. */
  handle<T extends IntentType>(type: T, handler: MockIntentHandler<T>): this;
  /** The intents of one type, for assertions. */
  dispatched<T extends IntentType>(type: T): IntentOf<T>[];
}

export interface MockEngineOptions {
  slices?: Partial<SliceMap>;
  /** Defaults to a fresh mock IPC installed as the backend. */
  ipc?: MockIpc;
  latencyMs?: number;
}

function updatesOf(slices: Partial<SliceMap>): SliceUpdate[] {
  return (Object.keys(slices) as SliceName[]).map((name) => ({ name, value: slices[name] }) as SliceUpdate);
}

export function installMockEngine({ slices = {}, ipc, latencyMs }: MockEngineOptions = {}): MockEngine {
  const backend = ipc ?? createMockIpc({ latencyMs });
  if (!ipc) setMockIpc(backend);
  const current: Partial<SliceMap> = { ...slices };
  // Handlers are stored untyped and called with the intent of their own type.
  const handlers = new Map<string, (intent: Intent, engine: MockEngine) => unknown>();
  const intents: Intent[] = [];

  const engine: MockEngine = {
    ipc: backend,
    intents,
    slices: current,
    setSlice(name, value) {
      current[name] = value;
      engine.emit([{ name, value } as SliceUpdate]);
    },
    patchSlice(name, patch) {
      const value = { ...(current[name] as object), ...patch } as SliceMap[typeof name];
      engine.setSlice(name, value);
    },
    emit(updates) {
      backend.emit(SLICES_EVENT, updates);
    },
    handle(type, handler) {
      handlers.set(type, handler as unknown as (intent: Intent, engine: MockEngine) => unknown);
      return this;
    },
    dispatched(type) {
      return intents.filter((intent) => intent.type === type) as IntentOf<typeof type>[];
    },
  };

  backend.handle('engine_resync', () => {
    // Like the engine: the full set arrives through the event, after the call returns.
    queueMicrotask(() => engine.emit(updatesOf(current)));
    return null;
  });
  backend.handle('engine_snapshot', () => updatesOf(current));
  backend.handle('engine_dispatch', (args) => {
    const intent = (args as { intent: Intent } | undefined)?.intent;
    if (!intent || typeof intent.type !== 'string') {
      throw new MockEngineError('invalidIntent', 'The request has no type.');
    }
    intents.push(intent);
    if (intent.type === 'app.snapshot') return updatesOf(current);
    const handler = handlers.get(intent.type);
    return handler ? (handler(intent, engine) ?? null) : null;
  });
  return engine;
}
