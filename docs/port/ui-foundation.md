# UI foundation (`apps/desktop`)

The React 19 + TypeScript UI of Azure timetracker 2.0. One Vite bundle renders all three windows.
It holds no business state: the Rust engine owns behaviour and state, and the UI shows slices
and sends intents (see `docs/engine.md`).

Replaces from 1.14.2 every SwiftUI view under `Sources/AzureTimetracker/` (`*View(s).swift`,
`Pages.swift`, `TimerDisplay.swift`, `Interface*.swift`, the views in `AzureTimetrackerApp.swift`).

## Commands

Run these from `apps/desktop`:

| Command | Does |
|---|---|
| `npm run dev` | Vite on http://localhost:1420 (strict port; the Tauri shell's `devUrl`). In a plain browser the mock engine serves the sample slices. |
| `npm run build` | Production bundle in `dist/`. Targets `safari17` on macOS and `chrome120` on Windows. |
| `npm run lint` | ESLint (typescript-eslint, react-hooks, jsx-a11y) with no warnings allowed |
| `npm run typecheck` | `tsc` for the app and the Node config files |
| `npm test` | Vitest + Testing Library + axe-core in jsdom |
| `npm run contract` | Regenerates `src/ipc/generated.ts` and `src/ipc/fixtures/defaults.json` from the Rust types |

In dev, `?surface=main|panel|mini|gallery` picks the surface. The component gallery exists in dev
and test builds only (`__GALLERY__`); production bundles never contain it.

## Layout of `src/`

| Folder | Contents |
|---|---|
| `surfaces/` | `SurfaceRoot` picks the window by Tauri label. `MainSurface` holds the sidebar from the `app` slice, routing, the visible-page report, banners and the global sheets. `PanelSurface` and `MiniSurface` delegate to `features/panel` and `features/mini`. |
| `pages/<id>/index.tsx` | One lazily loaded page per sidebar entry (`pages/registry.ts`). |
| `features/` | Page-independent UI: `app` (banners, connection status, header actions, appearance sync), `tracking`, `prompts`, `panel`, `mini`, `progress`, `ticketContext`, `onboarding`, `updates`, `settings`. |
| `ipc/` | `index.ts` (invoke/listen with a mock backend outside Tauri), `generated.ts` (types from Rust; do not edit), `contract.ts` (slice map and intent results), `engine.ts` (`dispatch`, `resync`, `onSlices`), `shell.ts` (windows, panel, shortcut, quit, shell events), `mockEngine.ts`, `fixtures/`. |
| `state/` | `store.ts` (one store of the latest slices), `hooks.ts` (`useSlice`, `useWorkItem`, `useAction`, `useNow`, `useLiveSeconds`), `EngineProvider.tsx`. |
| `components/` | Accessible primitives on react-aria-components: Button, fields, pickers, date and time fields, dialog, menu, popover, table, toggles, segmented control, tooltip, toast, banner, badge and status dot, card, empty state and skeleton, progress, keyboard shortcut, icons (lucide), and the live-region `Announcer`. |
| `charts/` | d3-scale/shape charts: Timeline, ActivityBars, CalendarHeatmap, HourHeatmap, CumulativeProgress, Donut, Legend, ChartFrame, ChartTooltip. Each has keyboard navigation and a `DataTable` twin. |
| `layout/` | AppShell (sidebar groups Today / Insights / Setup, ⌘1…⌘0 in visible order, hidden pages), PageHeader, PanelShell, MiniTimerShell, navigation model. |
| `timer/` | TimerDisplay (rolling digits, progress ring, reduced motion) and status labels. |
| `theme/` | Design tokens (`tokens.css`: light, dark, increased contrast, forced colours), appearance preferences (theme, scale 90–150 % through the root font size, contrast), ThemeProvider, contrast checks for every token pair. |
| `shortcuts/` | Command registry, the ⌘K / Ctrl+K command palette, the `?` cheat sheet, platform-aware key labels. |
| `gallery/` | Every component and surface in every theme, for review. |
| `test/` | `renderWithProviders`, `renderWithEngine` (mock engine with slices preloaded), `expectNoA11yViolations`, matchMedia and CSS helpers. |

## Data flow

1. `main.tsx` paints the first frame in the cached appearance. Outside Tauri it installs the mock
   engine. It then renders `AppProviders` (theme, locale en-GB, toasts, shortcuts) and
   `EngineProvider`.
2. `EngineProvider` subscribes to `engine://slices`, then calls `engine_resync`. Every slice
   arrives through the event; `useSlice(name)` re-renders only the components that read that
   slice.
3. Components send intents with `useAction().run({ type, …args })`. A run resolves to
   `{ ok, value | error }`; `pending` and `error` / `errorKind` drive buttons and inline messages.
   Effects arrive as slices.
4. Running clocks use `useLiveSeconds(base, since, extrapolate)` and one shared 1 Hz ticker that
   only runs while a clock is on screen. The engine never publishes per second.
5. `InterfaceSync` applies the `interface` slice to every window's theme.

## Rules for page work

- No business logic in the UI. Nothing starts a timer except a button that sends `tracking.start`.
- Every page has loading, empty, error and populated states, and long lists are paged or virtualised.
- WCAG 2.2 AA:
  - landmarks, and h2 sections under the header's h1;
  - labels on every control; status never by colour alone;
  - polite announcements for prompts and tracking changes;
  - charts with data tables;
  - trapped and returned focus in sheets;
  - reduced motion.
- Sample slices live in `ipc/fixtures/slices/*.ts` and are type-checked against the generated contract.
