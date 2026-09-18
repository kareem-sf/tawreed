# SPEC — Tawreed Minimalist UI Redesign (Spectrum UI + motion)

> **RETIRED 2026-09-18** by the shadcn-only design-system overhaul
> (`docs/superpowers/specs/2026-09-18-design-system-overhaul-design.md`).
> Mantine, gold/Domine brand, AiOrb/HeroButton, auto-pilot, and the
> `data-mantine-color-scheme` mechanism below are all excised. Kept as
> migration history — do not treat as current spec.

## 1. Goal

Redesign Tawreed's desktop UI to a minimalist visual language, migrating
component-by-component from Mantine (`@mantine/core`) to Spectrum UI
components (installed via shadcn CLI), with interface motion built on the
`motion` package (`motion/react`) already in the dependency tree.

## 2. Non-goals

- No feature changes. Every screen keeps its current behavior, strings,
  and workflow states (`idle / consent / busy / review / done`).
- No engine, bridge, Tauri-command, or i18n-key changes.
- The `motion-design` agent skill (AI film/video generation) is out of
  scope for UI work; UI motion uses `motion/react`.
- No promo/onboarding video production in this spec.

## 3. Current-state map (verified 2026-09-17)

- Shell: `src/App.tsx` → boot loader (`WorkLoader`) → `Onboarding`
  wizard → `TitleBar` + `WorkflowWorkspace` + `AppDialogs`.
- Screens: onboarding (3 steps), workflow (idle/consent/busy/review/done),
  review (`ReviewPanel`, `ReviewItemsDialog`, `ReviewItemRow`,
  `PackageSummaryList`), settings modal, history drawer, about modal.
- Mantine footprint: 14 files, primitives only — `Button`, `Text`,
  `Group`/`Stack`, `Modal`, `Drawer`, `Select`, `PasswordInput`,
  `SegmentedControl`, `Tooltip`, `ScrollArea`, `Table`, `ActionIcon`,
  `Loader`, `useMantineColorScheme`. No complex Mantine components.
- Theming: Mantine theme (gold palette, Public Sans + Domine) +
  Tailwind v4 tokens in `src/index.css` (`--bg/--surface/--ink/--gold/
  --line/...`, `text-ledger-*` utilities). Dark mode keys off
  `data-mantine-color-scheme`; Tailwind's `dark:` variant is synced to it.
- Motion today: `motion/react` in `WorkLoader`, `blur-fade`,
  `WorkflowWorkspace` (`AnimatePresence`), `FileUpload`; CSS keyframes
  (shimmer, shiny text) with `prefers-reduced-motion` fallbacks.
- Bilingual EN/AR with RTL. Frameless window, custom `TitleBar`
  (not Mantine). No `components.json` — shadcn not yet initialized.

## 4. Decisions (user-confirmed)

1. Motion via `motion/react` + Spectrum UI animated components.
2. Slice-by-slice migration, each slice independently verifiable.
3. Replace Mantine with Spectrum UI (Tailwind tokens stay).
4. Work in place in the working tree (no separate branch).

## 5. Constraints

- C1: EN/AR + RTL must keep working on every migrated screen. Spectrum
  components must be verified dir-aware (Radix-based ones are; verify).
- C2: Dark/light/auto color scheme must keep working. Risk: Spectrum UI
  expects `.dark` class; app uses `data-mantine-color-scheme`. Each slice
  must resolve this without breaking unmigrated Mantine screens.
- C3: Accessibility bar must not drop: focus-visible rings, `role=alert`
  errors, keyboard shortcuts (Alt+H/S/M), `prefers-reduced-motion`,
  forced-colors support, `allow-select` for copyable text.
- C4: Existing UI tests (`tests/review-panel.test.tsx`,
  `tests/accessibility-ui.test.ts`, `tests/bridge.dom.test.ts`) must pass
  per slice; update queries that depend on Mantine markup.
- C5: `MantineProvider` + `@mantine/core/styles.css` stay until the last
  Mantine usage is removed (final slice). Never break unmigrated screens.
- C6: Another session is actively developing this tree. Keep diffs small,
  one slice at a time, no opportunistic refactors outside the slice.

## 6. Minimalist direction

- Keep brand identity: gold accent, Domine display serif, Public Sans.
- Reduce chrome: fewer borders competing for attention, one emphasis per
  view, generous whitespace, quieter secondary actions.
- Keep `TitleBar`, frameless 14px window, and app-frame background.
- Motion is functional only: view transitions (`BlurFade`/`AnimatePresence`
  pattern), subtle button/hover feedback, skeleton/load states. No
  decorative animation. Every animation respects reduced-motion.

## 7. Slice plan

- Slice 0 — Foundation spike (no visual change): init shadcn
  (`components.json`, path alias), install 2 Spectrum components in
  isolation, prove `tsc + vitest + vite build`, dark-mode + RTL behavior
  documented. Abort/adjust if spike fails.
- Slice 1 — Shell: `TitleBar` polish, `WorkLoader`, app-frame tokens.
  Mantine untouched elsewhere.
- Slice 2 — Onboarding wizard (incl. `ProviderSetup` fields).
- Slice 3 — Workflow idle/busy/done + consent modal (`WorkflowWorkspace`,
  `FileUpload`).
- Slice 4 — Review (`ReviewPanel`, dialogs, rows).
- Slice 5 — Settings modal + history drawer + about modal + `AppDialogs`.
- Slice 6 — Remove Mantine: drop provider/CSS/dep, resolve C2 permanently,
  full `npm run check` equivalent (lint + typecheck + tests + build).

## 8. Verification per slice

1. `npm run typecheck` clean.
2. `npm run lint` clean on touched files.
3. `npx vitest run` green (update Mantine-coupled queries).
4. `vite build` succeeds (Tauri `dev` smoke test for visual slices).
5. Manual check in the running desktop app: light + dark, EN + AR (RTL),
   keyboard-only pass, reduced-motion on.
6. Diff review: only the slice's files touched.

## 9. Open risks

- R1: Spectrum UI + Tailwind v4 + `data-mantine-color-scheme` dark-mode
  interop — ANSWERED by slice 0: a token bridge in `src/index.css` maps
  shadcn names (`--background`, `--primary`, ...) onto ledger vars under
  `:root` + `[data-mantine-color-scheme='dark']`, exposed via
  `@theme inline`. No `.dark` class needed.
- R2: shadcn CLI writing files outside agreed paths — SUPERSEDED: the CLI
  is unusable in this repo (it runs `npm install -- ... cn radix-ui`
  with junk entries and a flag npm rejects under
  `strict-allow-scripts`). Components are vendored manually from the
  registry JSON (`https://spectrumhq.in/r/<name>.json`) into
  `src/components/spectrumui/`, keeping registry-faithful code with only
  the `cn` import rewired. `components.json` documents the alias scheme.
- R3: Concurrent edits from the other dev session (mitigate with small,
  fast slices; re-verify `git status` before each slice).

## 10. Slice-0 findings (2026-09-17)

- Installed: `@radix-ui/react-dialog`, `@radix-ui/react-slot`,
  `class-variance-authority` (plain `npm install -S`; no install scripts,
  policy-compliant). `lucide-react`/`clsx`/`tailwind-merge` reused.
- Verified: `typecheck` clean, `eslint` clean, full `vitest` green
  (239 passed incl. new `tests/spectrum-spike.dom.test.tsx`: button
  variant, dialog open-from-trigger, RTL subtree), `vite build` succeeds.
- Nothing is wired into `App` yet — zero visual change.
- Follow-ups for later slices:
  - F1: `animate-in`/`fade-in-0`/`zoom-*`/`slide-*` classes in vendored
    components are no-ops until an animation plugin (`tw-animate-css`)
    or hand-written keyframes land. Decide in slice 1.
  - F2: Vendored files use physical positioning (`right-4`, `sm:text-left`,
    `left-`/`right-` slide sides). Radix inherits `dir` automatically, but
    each migrated screen needs an RTL pass for logical properties.
  - F3: shadcn `button` focus ring uses `ring-ring`; the app's
    `:focus-visible` gold style must be reconciled in the minimalist
    direction (slice 1).

## 11. Slice-1 notes (2026-09-17) — shell

- F1 DECIDED: no animation plugin in slice 1. Shell motion stays on
  `motion/react` (`BlurFade`/`AnimatePresence` entrance pattern); the
  `animate-in` no-op classes only matter once a vendored overlay is wired
  into a screen — revisit at slice 3 (consent modal), likely answer is
  `tw-animate-css`.
- `WorkLoader`: 4 stacked conic rings + breathing scale + center dot →
  single 80° gold arc sweeping a hairline `var(--line)` track. Sizes,
  progress clamping, `role=status`/`aria-live`, reduced-motion all
  preserved; pinned by new `tests/work-loader.dom.test.tsx` (4 tests,
  written before the restyle, green before and after).
- `TitleBar`: frame 38px → 36px, start padding 14px → 12px, nav gap
  5px → 6px. Class names, focus-ring CSS, shortcuts, aria contracts
  untouched (guarded by `tests/accessibility-ui.test.ts` string asserts).
- Verified: typecheck clean, eslint clean, full `vitest` green (243 passed),
  `vite build` succeeds, running desktop app (tauri dev) applied both
  edits via HMR with no runtime errors.

## 12. Slice-2 notes (2026-09-17) — onboarding shell

- Scope cut (incremental discipline): `Onboarding.tsx` shell only. The
  provider-field components (`ProviderSetup`, `NamedProviderCard` — shared
  with the settings modal, using Accordion/Select/PasswordInput/Alert)
  stay Mantine for a dedicated slice 2b; the searchable-`Select` and
  password-toggle behaviors deserve isolated verification.
- `Onboarding.tsx` is now Mantine-free: nav/close/finish buttons →
  shadcn `Button` (`ghost` for secondary, `default`/gold for primary),
  `Text` → ledger-token `<p>`, `Group` → flex divs. Mantine `loading`
  prop → `disabled` + `Loader2` with `motion-safe:animate-spin`
  (respects reduced-motion, zero new deps). Spacing mapped 1:1 from
  Mantine scale (`mt="lg"` → `mt-5`, `gap="xs"` → `gap-2.5`, `mt={5}` →
  `mt-[5px]`). Step error gained `allow-select` per app convention.
- No test referenced onboarding (verified by grep); behavior preserved by
  construction (same handlers, order, labels, `role=alert`, `rtl:rotate-180`).
- Verified: typecheck clean, eslint clean, full `vitest` green, `vite build`
  succeeds, tauri-dev HMR applied with no errors.
- Visual check (needs human eyes): Settings → re-run onboarding, walk the
  3 steps in EN + AR, light + dark. Button icons render at 16px now
  (shadcn `[&_svg]:size-4`) vs 12–14px before — accepted as standard.

## 13. Slice-2b notes (2026-09-17) — provider fields

- `ProviderSetup` + `NamedProviderCard` are now Mantine-free (they render
  inside both onboarding and the settings modal, so both surfaces migrate
  together — same component, same handlers).
- Vendored base primitives (registry-faithful, `cn` rewired): `alert`,
  `input`, `label` (@radix-ui/react-label), `accordion`
  (@radix-ui/react-accordion), `popover` (@radix-ui/react-popover),
  `command` (cmdk; `CommandDialog` omitted — needs the dialog primitive,
  unused until slice 3+). New npm deps: the three Radix packages + `cmdk`
  (all script-free, policy-compliant).
- New feature components: `Field` (label/description with htmlFor wiring),
  `PasswordField` (mask + eye toggle, translated show/hide labels),
  `ModelSelect` (combobox: type-to-filter, keyboard nav via cmdk,
  same `value: string|null` / onChange contract as Mantine `searchable`
  Select; accepts `{value,label}[]`, so string lists are mapped at the call
  site). Mantine `Alert` colors red/green/yellow → destructive / emerald /
  amber tones. Mantine `loading` → disabled + `motion-safe:animate-spin`.
- New i18n keys (parity test green): `noModelsFound`, `showApiKey`,
  `hideApiKey` in en + ar.
- CSS: `--popover` tokens + accordion-down/up keyframes with
  reduced-motion guard (partial F1 progress: overlays still lack the
  `animate-in` plugin — full decision stays with slice 3).
- Deviations documented in code: accordion trigger `text-start` (was
  `text-left`, RTL fix); combobox check icon uses logical `me-2`.
- Guard: `tests/provider-fields.dom.test.tsx` (label association,
  password toggle + aria-pressed, combobox select/filter/empty-state).
  Test-env note: cmdk needs `scrollIntoView`, stubbed like the other
  jsdom gaps (browser-native, not a component issue).
- Verified: typecheck clean, eslint clean, full `vitest` green (247 passed),
  `vite build` succeeds, tauri-dev HMR applied with no errors.
- Remaining Mantine users after 2b (11 files): `AppDialogs`,
  `ErrorBoundary`, `HistoryDrawer`, `ReviewPanel`, `ReviewItemsDialog`,
  `ReviewItemRow`, `WorkflowWorkspace`, `AboutModal`, `SettingsModal`,
  `GeneralPreferences`, `main.tsx` (provider + styles).

## 14. Slice-3 notes (2026-09-17) — workflow + consent

- F1 CLOSED: `tw-animate-css` installed and imported in `index.css` — all
  `animate-in/out`, `fade-*`, `zoom-*`, `slide-*` utilities in vendored
  overlays now run. Reduced-motion guard extended with
  `.animate-in, .animate-out { animation: none; }` (dialogs appear
  instantly, Radix behavior otherwise unchanged).
- `WorkflowWorkspace` is Mantine-free. Idle/busy/done: buttons → shadcn
  `Button` (done-view primary becomes `outline`, gold gradient styles prop
  deleted), Mantine `Tooltip` → vendored Radix tooltip
  (`@radix-ui/react-tooltip`, same 180ms delay), texts → ledger tokens.
- Consent is now a true Radix dialog: `ResponsiveModal` root + vendored
  overlay + centered content with enter/exit zoom-fade. The explicit-choice
  contract is preserved structurally — `onEscapeKeyDown` +
  `onPointerDownOutside` both `preventDefault`, and there is deliberately
  no close button (the vendored `ResponsiveModalContent` always renders its
  X, so consent composes `DialogPrimitive.Content` +
  `ResponsiveModalTitle/Description` instead; documented in code).
- `tests/accessibility-ui.test.ts` consent case rewritten from Mantine
  props (`closeOnEscape`, `withCloseButton`) to the Radix guarantees.
  New runtime guard `tests/workflow-consent.dom.test.tsx`: role=dialog
  with exactly 2 buttons, choice reporting, ESC ignored (4 tests).
- Verified: typecheck clean, eslint clean, full `vitest` green (251 passed),
  `vite build` succeeds, tauri-dev reloaded with no errors.
- Remaining Mantine users after 3 (10 files): `AppDialogs`, `ErrorBoundary`,
  `HistoryDrawer`, `ReviewPanel`, `ReviewItemsDialog`, `ReviewItemRow`,
  `AboutModal`, `SettingsModal`, `GeneralPreferences`, `main.tsx`.

## 15. Slice-4 notes (2026-09-17) — review

- `ReviewPanel`, `ReviewItemsDialog`, `ReviewItemRow` are Mantine-free.
  `PackageSummaryList` already was (untouched).
- Panel: header/error/footer → shadcn `Button` + ledger text; generate
  button's gold gradient + glow `styles` prop deleted (flat `default`);
  Mantine `ScrollArea` → native `overflow-y-auto` (global thin scrollbars
  already styled; no scroll-position logic existed to preserve).
- Items dialog: dismissible responsive modal (Root `onOpenChange` funnels
  ESC/backdrop/X into `onClose`), translated X via `DialogPrimitive.Close`
  (vendored content's baked-in English "Close" was unsuitable), `max-w-3xl`
  matching Mantine `xl`, header/pagination/footer in ledger tokens.
- Rows: Mantine searchable `Select` → `ModelSelect` with new compact mode
  (`label` omitted + `ariaLabel`, trigger fills the 261px column; popover
  portals out of the virtualized list so no clipping). `comboboxProps`
  `withinPortal` behavior preserved structurally.
- `ModelSelect` label is now optional (settings usages unchanged).
- Guard: `tests/review-dialog.dom.test.tsx` — dialog opens with title +
  pagination, closes via X and via ESC (2 tests). Existing
  `review-panel.test.tsx` untouched and green (banner markup preserved).
- Verified: typecheck clean, eslint clean, full `vitest` green (253 passed),
  `vite build` succeeds, tauri-dev HMR applied with no errors (one transient
  babel error from a mid-edit save self-recovered on the next save).
- Remaining Mantine users after 4 (7 files): `AppDialogs`, `ErrorBoundary`,
  `HistoryDrawer`, `AboutModal`, `SettingsModal`, `GeneralPreferences`,
  `main.tsx`.

## 16. Slice-5 notes (2026-09-17) — settings/history/about/dialogs + Mantine removal

- Slice 5 absorbed spec slice 6: **zero `@mantine/core` imports remain**;
  the dep is uninstalled, `styles.css` import dropped, `MantineProvider`
  removed from `main.tsx`, `manualChunks` mantine entry replaced with a
  `radix` chunk, dead `[data-mantine-scrollbar]` CSS removed. The
  `data-mantine-color-scheme` attribute NAME is kept deliberately (CSS,
  dark: variant and tests key off it).
- Color scheme: new `src/app/useColorScheme.ts` owns the attribute —
  localStorage persistence (like Mantine), system-follow on auto with live
  `matchMedia` subscription, one-time adoption of Mantine's legacy stored
  key so users keep their choice. `GeneralPreferences` keeps exact
  behavior incl. revert-on-failed-write. (Found en passant: the Rust
  `theme` setting was write-only even before — still is; localStorage is
  the source of truth, same as under Mantine.)
- `SegmentedControl` → vendored Radix tabs with segmented styling;
  processing-mode `Select` → styled native `<select>` (3 fixed options,
  never searchable — simplest correct control, RTL/dark native).
  `Loader` → `Loader2` + `motion-safe:animate-spin`.
- `DialogShell` (`src/components/DialogShell.tsx`): shared frame for
  settings/about modals + history sheet (center zoom-fade / side slide,
  translated X or none). About keeps its own header; its `h2` became
  `DialogPrimitive.Title asChild` so the dialog stays labelled.
- `HistoryDrawer`: native table (hover rows, row borders), icon buttons,
  vendored tooltips; scroll owned by the sheet shell.
- `AutopilotSetup` (other session's new file, also Mantine) migrated too:
  revoke flow and accessible names preserved (proven by existing tests).
- Catches during verification (all fixed): Radix `Tooltip` REQUIRES a
  `TooltipProvider` ancestor — added once in `main.tsx` (this would have
  crashed the done view/history at runtime); Tailwind v4 bare `border`
  renders `currentColor` — ledger-line added to dialog/popover/command
  surfaces; build needed the `manualChunks` fix above.
- Test-env notes: jsdom here has no `localStorage` (hook guards it;
  persistence precedence covered by pure `coalesceStoredSetting` unit
  tests) and no `scrollIntoView` (stubbed).
- Guards: `color-scheme` (resolve/precedence/attribute), `dialog-shell`
  (open/X/ESC), `history-drawer` (rows/empty/error) — 9 tests.
- Verified: `npm run lint` clean, typecheck clean, full `vitest` green
  (262 passed), `vite build` succeeds, tauri-dev restarted + HMR clean.
- Mantine fully removed. Remaining work is visual polish/eyeballing, not
  migration.

## 18. Libraries.dev effects (2026-09-17)

- Installed `thinking-orbs` 0.3.1, `liquid-gooey` 0.2.1, `metal-fx` 2.0.10
  (all MIT, zero runtime deps, React 19 compatible). Vetted before install:
  tarballs unpacked to temp, no install scripts (policy check
  `verify:install-scripts` green), APIs confirmed against shipped `.d.ts`
  and libraries.dev docs. NOTICES file untouched (only tracks 4 heavy pkgs).
- Corrections to the prompt snippets: orb takes `theme` ('auto'|'dark'|
  'light'), not a `dark` boolean — and `auto` watches Tailwind conventions
  our attribute doesn't match, so `AiOrb` passes the app scheme explicitly.
- Placements (each earns its place; one live effect per screen max):
  - `AiOrb` (new): busy AI view via `WorkLoader orbState="working"`.
    Boot keeps the quiet arc. Theme explicit, frozen under reduced-motion,
    decorative (live region announces).
  - `HeroButton` (new): `MetalFx` gold at strength 0.6 on exactly three
    CTAs — consent improve, review generate, onboarding finish. Paused when
    disabled or reduced-motion; plain button fallback without WebGL2.
  - Gooey: single experimental use — jelly `morph` on the history trust
    arm/grant toggle (`fill="var(--surface-2)"`, invisible at rest).
    The minimalist layout has no touching same-fill elements, so no merge
    composition was forced; onboarding dots are the noted future candidate.
- Cost: ~177KB added to the app chunk (mostly metal's shader engine),
  negligible for local desktop files — no code-splitting (measured: dwarfed
  by exceljs 918KB).
- Verified: typecheck clean, eslint clean, full `vitest` green (263 passed;
  Metal/Liquid degrade gracefully in jsdom), `vite build` succeeds,
  tauri-dev HMR clean.

## 19. Full shadcn catalog sweep (2026-09-17)

- Enumerated all 63 catalog entries from ui.shadcn.com/docs/components.
  Verdict: fetch only what a Tawreed screen needs — bulk import would add
  ~40 unused components + deps against the minimalist direction.
- ADOPTED: `separator` (@radix-ui/react-separator; settings/about
  dividers), `skeleton` (zero-dep; history loading rows with role=status;
  `animate-pulse` added to the reduced-motion guard).
- KEPT CUSTOM (deliberate, documented): `Field` (ours is smaller, tested,
  no validation system to feed); `ModelSelect` over new `combobox`
  (canonical is Base-UI-based = second headless lib + new dep, for
  equivalent behavior); native `select` over canonical `native-select`
  (canonical source is CSS-first and not published on the fetchable
  registry endpoints); dialogs/sheet/drawer compositions (canonical X
  close carries a hardcoded English label); native table, custom
  progress bars, custom pagination (lighter than canonical equivalents).
- REJECTED (no corresponding UI): avatar, badge (pills are text-only;
  badge adds bg chrome), breadcrumb, button-group (no joined actions),
  calendar/date-picker, card, carousel, chart, checkbox, collapsible,
  context-menu, data-table, dropdown-menu, empty (quiet one-line state
  kept), form libs, hover-card, input-group, input-otp, item, kbd, marker,
  menubar, message/chat family, navigation-menu, questionnaire, radio-group,
  resizable, scroll-area, sidebar, slider, spinner (bakes in English
  aria-label + unguarded spin; ours pairs aria-hidden with live regions),
  switch, textarea, toast/sonner (notification feature, out of scope),
  toggle, typography, aspect-ratio, attachment, direction.
- Verified: typecheck clean, eslint clean, full `vitest` green (264 passed),
  install-script policy green, `vite build` succeeds.

## 17. Button language (minimalist pass, 2026-09-17)

- Stock shadcn buttons carried `shadow`/`shadow-sm` fills that fought the
  minimalist direction. `buttonVariants` is now flat on every variant, the
  `outline` fill is transparent (was opaque), radius `md` → `lg`.
- Deliberately kept: gold `default` primary (brand), focus ring, sizes.
- One file propagates to every screen; suite (262) + build green.
