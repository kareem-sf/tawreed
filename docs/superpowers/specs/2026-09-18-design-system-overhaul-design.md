# Design: shadcn-only minimalist design-system overhaul

Date: 2026-09-18. Path: big-bang (explicit user call). Prior art:
SPEC-ui-redesign.md (Mantine→Spectrum migration, complete), provider-dropdown
+ brand-logo work, auto-pilot excision.

## 1. Goal

One UI library (shadcn/Radix), one token language (stock shadcn zinc),
zero decorative dependencies. Every screen keeps behavior, copy, and layout;
this arc changes color/type tokens, dependencies, and the dark-mode
mechanism only.

## 2. Non-goals

- No behavior, copy, layout, or IA changes on any screen.
- No token renames beyond ledger→canonical (no new palette design).
- No RTL, i18n-key, engine, bridge, Tauri-command, or schema changes.
- No resurrection of removed features (auto-pilot stays excised).

## 3. Decisions (user-confirmed)

1. `modelicons` stays (real provider marks; shadcn has no brand icons).
2. `motion` stays, transitions only (mount/unmount has no CSS equivalent).
3. `liquid-gooey`, `metal-fx`, `thinking-orbs` uninstalled (pure decoration).
4. Tokens go canonical shadcn zinc; ledger dialect deleted.
5. Brand cut: gold→`primary` monochrome, Domine/Public Sans→stock sans.
6. Dark mode cut to stock `.dark` class (Mantine attribute name retired).
7. Big-bang execution, single verification run, full revert on failure.

## 4. Foundation

- Deps: uninstall `liquid-gooey`, `metal-fx`, `thinking-orbs`; remove
  `AiOrb`, `HeroButton`, history gooey toggle, and their tests/fixtures.
  Keep `motion`, `modelicons`, `cmdk` (shadcn-canonical), Radix, Tailwind,
  lucide. Run `verify:install-scripts` after.
- `index.css`: stock shadcn zinc light/dark theme. Delete: ledger
  primitives, bridge aliases, `--speed` default (dead with shimmer code —
  shimmer/spin classes stay only because `accessibility-ui` asserts them;
  re-point or drop per §7), gold/Domine stacks, app-frame gradient+grain,
  `@custom-variant dark`, `data-mantine-color-scheme` selectors.
- `components.json`: `baseColor` stays `zinc`; nothing else changes.
- `useColorScheme`: writes `.dark` class on `<html>`; keep localStorage
  persistence, system-follow, legacy-key adoption. Tests assert the class.

## 5. Screens (token rename map)

| From | To |
|---|---|
| `text-ledger-ink`, `text-foreground` (unchanged) | `text-foreground` |
| `text-ledger-ink-dim`, `text-ledger-ink-faint` | `text-muted-foreground` |
| `bg-ledger-surface-2`, `bg-ledger-bg` | `bg-muted`, `bg-background` |
| `border-ledger-line`, `bg-ledger-line` | `border` (base rule resolves) |
| `text-ledger-danger`, `border-ledger-danger/*` | `text-destructive`, `border-destructive/*` |
| `bg-gold*`, `text-gold*`, `border-gold*`, `ring-gold*` | `bg-primary`, `text-primary`, `border-primary`, `ring-ring` |
| `font-serif-display` | remove (fall back to sans) |
| `var(--gold)`, `var(--gold-deep)`, `var(--line)`, `var(--surface-2)` bare uses | token equivalent or utility |

Per-screen: shell (TitleBar ring, WorkLoader arc, flat app-frame),
onboarding, workflow + consent, review set, settings/history/about
(compositions unchanged). `ConfirmDialog`, `ModelSelect`,
`PasswordField`, provider dropdown (modelicons marks stay) keep structure.

## 6. Guarantees

- Dark: `.dark` class end-to-end; `color-scheme` tests rewritten.
- RTL: no changes; Arabic suite must pass unmodified.
- A11y: rings, alerts, shortcuts, reduced-motion, forced-colors kept;
  `accessibility-ui` updated only where it asserts gold values.
- Architecture: re-pin budgets touched by deletions; reachability must
  pass (no orphaned primitives).

## 7. Open points (resolve in plan)

- Shimmer/spin CSS + its test assertion: re-point test at a live
  animation class or delete both.
- `field.tsx` radio-group slot selectors after radio-group deletion:
  harmless; delete if touching the file anyway.
- `THIRD_PARTY_NOTICES.md`: confirm `verify:notices` needs no entry
  for uninstalled libs (it tracks heavy pkgs only).

## 8. Verification (single run, all green or full revert)

1. `grep -ri` zero: `ledger-`, `--gold`, `Domine`, `metal-fx`, `liquid-gooey`,
   `thinking-orbs`, `data-mantine-color-scheme` (this spec exempt).
2. `npm run lint`, `typecheck`, `vitest run`, `vite build`.
3. `cargo test` (sanity, untouched).
4. `verify:architecture`, `verify:docs`, `verify:install-scripts`.
5. Cold-start desktop check: light/dark, EN/AR, keyboard-only,
   reduced-motion. Rollback: `git stash`/checkout, no partial commits.
