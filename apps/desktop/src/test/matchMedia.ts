/** A controllable `window.matchMedia` for jsdom: tests flip media features and listeners fire. */
type Listener = (event: MediaQueryListEvent) => void;

const active = new Set<string>();
const lists = new Set<FakeMediaQueryList>();

function evaluate(query: string): boolean {
  // Supports the simple `(feature: value)` queries the app uses, joined with `and`.
  return query
    .split(/\s+and\s+/)
    .map((part) => part.trim().replace(/^\(|\)$/g, '').replace(/\s+/g, ' '))
    .every((feature) => active.has(feature));
}

class FakeMediaQueryList implements MediaQueryList {
  readonly media: string;
  onchange: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null = null;
  private readonly listeners = new Set<Listener>();
  private last: boolean;

  constructor(query: string) {
    this.media = query;
    this.last = evaluate(query);
  }

  get matches(): boolean {
    return evaluate(this.media);
  }

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener === 'function') this.listeners.add(listener);
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (typeof listener === 'function') this.listeners.delete(listener);
  }

  addListener(listener: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null): void {
    if (listener) this.listeners.add(listener);
  }

  removeListener(listener: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null): void {
    if (listener) this.listeners.delete(listener);
  }

  dispatchEvent(): boolean {
    return true;
  }

  notify(): void {
    const matches = this.matches;
    if (matches === this.last) return;
    this.last = matches;
    const event = { matches, media: this.media } as MediaQueryListEvent;
    for (const listener of this.listeners) listener(event);
    this.onchange?.call(this, event);
  }
}

export function installMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const list = new FakeMediaQueryList(query);
      lists.add(list);
      return list;
    },
  });
}

/** Turns a media feature on or off, e.g. `setMediaFeature('prefers-color-scheme: dark', true)`. */
export function setMediaFeature(feature: string, on: boolean): void {
  const key = feature.replace(/^\(|\)$/g, '').replace(/\s+/g, ' ').trim();
  if (on) active.add(key);
  else active.delete(key);
  for (const list of lists) list.notify();
}

export function resetMatchMedia(): void {
  active.clear();
  lists.clear();
}
