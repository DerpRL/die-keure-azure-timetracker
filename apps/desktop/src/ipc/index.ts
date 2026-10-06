/**
 * Typed IPC wrapper. In the Tauri web view it forwards to `@tauri-apps/api`; in a plain browser
 * (preview, gallery) and in tests it talks to a pluggable mock backend.
 *
 * Business commands and events are not defined yet. When the typed contract lands (tauri-specta),
 * augment `IpcCommandMap` / `IpcEventMap` with declaration merging, e.g.
 *
 *   declare module '../ipc' {
 *     interface IpcCommandMap { 'tracking.stop': { args: { expectedIdentity: string }; result: void } }
 *     interface IpcEventMap { 'state.tracking': TrackingSlice }
 *   }
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';
import { createMockIpc, type MockIpc } from './mock';

export { createMockIpc, type MockIpc, type MockCommandHandler } from './mock';

export type InvokeArgs = Record<string, unknown>;
export type Unlisten = () => void;

// Intentionally empty: augmented by the generated contract.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IpcCommandMap {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IpcEventMap {}

type KnownCommand = Extract<keyof IpcCommandMap, string>;
type KnownEvent = Extract<keyof IpcEventMap, string>;
type CommandArgs<C extends KnownCommand> = IpcCommandMap[C] extends { args: infer A } ? A : undefined;
type CommandResult<C extends KnownCommand> = IpcCommandMap[C] extends { result: infer R } ? R : unknown;
type ArgsParameter<C extends KnownCommand> = undefined extends CommandArgs<C> ? [args?: CommandArgs<C>] : [args: CommandArgs<C>];

/** The two operations every backend provides. */
export interface IpcBackend {
  invoke(command: string, args?: InvokeArgs): Promise<unknown>;
  listen(event: string, handler: (payload: unknown) => void): Promise<Unlisten>;
}

/** Rejection type for every failed `invoke`, whichever backend produced it. */
export class IpcError extends Error {
  readonly command: string;
  readonly payload: unknown;

  constructor(command: string, payload: unknown) {
    super(describe(payload));
    this.name = 'IpcError';
    this.command = command;
    this.payload = payload;
  }
}

function describe(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (payload instanceof Error) return payload.message;
  if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
    return payload.message;
  }
  try {
    return JSON.stringify(payload) ?? 'Unknown IPC error';
  } catch {
    return 'Unknown IPC error';
  }
}

/** True inside the Tauri web view (the runtime injects `__TAURI_INTERNALS__`). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const tauriBackend: IpcBackend = {
  invoke: (command, args) => tauriInvoke(command, args),
  listen: (event, handler) => tauriListen(event, (message) => handler(message.payload)),
};

let mock: IpcBackend = createMockIpc();

/** Replaces the mock backend used outside Tauri. Returns the previous one. */
export function setMockIpc(backend: IpcBackend): IpcBackend {
  const previous = mock;
  mock = backend;
  return previous;
}

/** Installs a fresh, empty mock (tests call this between cases). */
export function resetMockIpc(): MockIpc {
  const fresh = createMockIpc();
  mock = fresh;
  return fresh;
}

function backend(): IpcBackend {
  return isTauri() ? tauriBackend : mock;
}

export function invoke<C extends KnownCommand>(command: C, ...args: ArgsParameter<C>): Promise<CommandResult<C>>;
export function invoke<R = unknown>(command: string, args?: InvokeArgs): Promise<R>;
export async function invoke(command: string, args?: unknown): Promise<unknown> {
  try {
    return await backend().invoke(command, args as InvokeArgs | undefined);
  } catch (error) {
    throw error instanceof IpcError ? error : new IpcError(command, error);
  }
}

export function listen<E extends KnownEvent>(event: E, handler: (payload: IpcEventMap[E]) => void): Promise<Unlisten>;
export function listen<P = unknown>(event: string, handler: (payload: P) => void): Promise<Unlisten>;
export function listen(event: string, handler: (payload: unknown) => void): Promise<Unlisten> {
  return backend().listen(event, handler);
}
