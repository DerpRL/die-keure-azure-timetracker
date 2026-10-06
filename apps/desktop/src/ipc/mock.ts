import type { IpcBackend, InvokeArgs, Unlisten } from './index';

export type MockCommandHandler = (args: InvokeArgs | undefined) => unknown;

export interface MockIpc extends IpcBackend {
  /** Registers (or replaces) the handler for a command. */
  handle(command: string, handler: MockCommandHandler): this;
  /** Delivers an event payload to every listener, like the engine pushing a state slice. */
  emit(event: string, payload: unknown): void;
  /** Every invoke so far, in order. */
  readonly calls: ReadonlyArray<{ command: string; args: InvokeArgs | undefined }>;
  listenerCount(event: string): number;
}

export interface MockIpcOptions {
  handlers?: Record<string, MockCommandHandler>;
  /** Simulated round trip for previews; 0 (the default) resolves on the next microtask. */
  latencyMs?: number;
}

/** In-memory backend for the browser preview, the gallery and tests. */
export function createMockIpc({ handlers = {}, latencyMs = 0 }: MockIpcOptions = {}): MockIpc {
  const commands = new Map<string, MockCommandHandler>(Object.entries(handlers));
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const calls: Array<{ command: string; args: InvokeArgs | undefined }> = [];

  const wait = () => (latencyMs > 0 ? new Promise((resolve) => setTimeout(resolve, latencyMs)) : Promise.resolve());

  const ipc: MockIpc = {
    calls,
    handle(command, handler) {
      commands.set(command, handler);
      return this;
    },
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0;
    },
    async invoke(command, args) {
      calls.push({ command, args });
      await wait();
      const handler = commands.get(command);
      if (!handler) throw new Error(`No mock handler for "${command}"`);
      return handler(args);
    },
    listen(event, handler): Promise<Unlisten> {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
      return Promise.resolve(() => {
        set.delete(handler);
      });
    },
  };
  return ipc;
}
