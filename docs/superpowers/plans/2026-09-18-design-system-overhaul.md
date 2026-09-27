# Design-system overhaul implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the app to shadcn-only tekens (stock zinc), uninstall all decorative UI deps, cut dark mode to stock `.dark`.

**Architecture:** Big-bang in dependency order: deps+dead components first, token core second, screen sweep third, single verification run last. No behavior, copy, layout, or IA changes anywhere.

**Tech Stack:** React 19, Tailwind v4, shadcn/Radix primitives, `motion` (transitions only), `modelicons` (provider marks), `cmdk` (shadcn command dep).

**Spec:** `docs/superpowers/specs/2026-09-18-design-system-overhaul-design.md`

## Global Constraints

- Node >= 24, packageManager npm. After any package.json change run `npm install` then `npm run verify:install-scripts`.
- PowerShell 5.1: no `head`, no `grep`, no `rg`. Use `Select-Object -First`, `Select-String`.
- Never edit files outside the task's file list. The other dev session works this tree concurrently.
- No new npm dependencies. No new Tauri commands. No i18n-key changes.
- EN/AR + RTL, light/dark, keyboard-only, reduced-motion, forced-colors must keep working.
- Commit per task with explicit file lists only (`git add <paths>` — never `git add -A`; the tree is shared with another session).

---

## Token maps (used by every screen task)

Apply with replace-all semantics within the listed file, then re-grep the file for leftovers.

**Class map:**
- `text-ledger-ink` → `text-foreground`
- `text-ledger-ink-dim` → `text-muted-foreground`
- `text-ledger-ink-faint` → `text-muted-foreground`
- `bg-ledger-bg` → `bg-background`
- `bg-ledger-surface` → `bg-card`
- `bg-ledger-surface-2` → `bg-muted`
- `hover:bg-ledger-surface-2` → `hover:bg-muted`
- `hover:bg-ledger-surface-2/60` → `hover:bg-muted/60`
- `border-ledger-line` → `border`
- `bg-ledger-line` → `bg-border`
- `text-ledger-danger` → `text-destructive`
- `border-ledger-danger` → `border-destructive`
- `border-ledger-danger/30` → `border-destructive/30`
- `bg-ledger-danger` → `bg-destructive`
- `bg-gold` → `bg-primary`
- `bg-gold/8` → `bg-primary/5`
- `bg-gold/6` → `bg-primary/5`
- `text-gold-deep` → `text-primary`
- `dark:text-gold` → delete (dark primary already light via token)
- `dark:hover:text-gold` → delete
- `dark:group-hover:text-gold` → delete
- `dark:text-gold-deep` → delete
- `dark:text-[#f0d8a0]` → delete
- `border-gold-deep` → `border-primary`
- `hover:border-gold-deep` → `hover:border-primary`
- `hover:text-gold-deep` → `hover:text-primary`
- `group-hover:text-gold-deep` → `group-hover:text-primary`
- `hover:bg-gold/8` → `hover:bg-primary/5`
- `ring-gold-deep/70` → `ring-ring`
- `focus-visible:ring-gold-deep/70` → `focus-visible:ring-ring`
- `font-serif-display` → delete (leave remaining classes; collapse double spaces)
- `hover:bg-gold` → `hover:bg-primary` (Onboarding dots: `bg-gold` → `bg-primary`)
- `bg-ledger-ink-dim` → `bg-muted-foreground`
- `bg-ledger-surface-2` (Onboarding dots) → `bg-muted`

**Raw CSS var map (index.css, titlebar CSS, inline styles):**
- `var(--gold)` → `var(--primary)`
- `var(--gold-deep)` → `var(--primary)`
- `var(--line)` → `var(--border)`
- `var(--surface-2)` → `var(--muted)`
- `var(--ink-faint)` → `var(--muted-foreground)`

---

### Task 1: Uninstall decorative deps, delete AiOrb + HeroButton

**Files:**
- Modify: `package.json`
- Delete: `src/components/AiOrb.tsx`, `src/components/HeroButton.tsx`
- Modify: `src/components/WorkLoader.tsx`, `src/features/workflow/components/WorkflowWorkspace.tsx`, `src/features/review/ReviewPanel.tsx`, `src/features/onboarding/Onboarding.tsx`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `Button` (shadcn) as the only CTA primitive; `WorkLoader` without `orbState`.

- [ ] **Step 1: List every consumer to be rewired**

Run: `Get-ChildItem -Recurse -Include "*.tsx","*.ts" -Path "src","tests" | Select-String -Pattern "AiOrb|HeroButton|orbState|MetalFx|ThinkingOrb|Liquid|liquid-gooey|metal-fx|thinking-orbs" | Select-Object Path, LineNumber`
Expected: only `src/components/WorkLoader.tsx`, `src/features/workflow/components/WorkflowWorkspace.tsx`, `src/features/review/ReviewPanel.tsx`, `src/features/onboarding/Onboarding.tsx`, `tests/work-loader.dom.test.tsx`, plus the two deleted files. If more files appear, stop and report.

- [ ] **Step 2: Uninstall the three packages**

Run: `npm uninstall liquid-gooey metal-fx thinking-orbs`
Expected: `package.json` no longer lists them; `package-lock.json` updated.

Run: `npm run verify:install-scripts`
Expected: `Verified exact npm install-script approvals and strict project enforcement.`

- [ ] **Step 3: Delete the two components**

Run: `Remove-Item -LiteralPath "src/components/AiOrb.tsx", "src/components/HeroButton.tsx" -Force`
Expected: both paths gone.

- [ ] **Step 4: Rewire WorkLoader to the quiet arc**

In `src/components/WorkLoader.tsx`, replace the full file content with:

```tsx
import { motion, useReducedMotion } from 'motion/react';
import { Progress } from './ui/progress';

interface WorkLoaderProps {
  title: string;
  subtitle?: string;
  progress?: number | null;
  size?: 'sm' | 'md' | 'lg';
}

const sizes = {
  sm: { box: 58, ring: 3 },
  md: { box: 76, ring: 3 },
  lg: { box: 96, ring: 4 },
};

export default function WorkLoader({
  title,
  subtitle,
  progress = null,
  size = 'lg',
}: WorkLoaderProps) {
  const reduceMotion = useReducedMotion();
  const config = sizes[size];
  const boundedProgress = progress === null
    ? null
    : Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div className="flex flex-col items-center text-center" role="status" aria-live="polite">
      {/* Quiet arc for all waits: signals "working", not content. */}
      <div
        className="relative text-primary"
        style={{ width: config.box, height: config.box }}
        aria-hidden="true"
      >
      <span
        className="absolute inset-0 rounded-full"
        style={{ border: `${config.ring}px solid var(--border)` }}
      />
      <motion.span
        className="absolute inset-0 rounded-full"
        style={{
          background: 'conic-gradient(from 0deg, currentColor 0deg, currentColor 80deg, transparent 140deg, transparent 360deg)',
          mask: `radial-gradient(farthest-side, transparent calc(100% - ${config.ring}px), #000 calc(100% - ${config.ring - 0.5}px))`,
          WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${config.ring}px), #000 calc(100% - ${config.ring - 0.5}px))`,
        }}
        animate={reduceMotion ? undefined : { rotate: 360 }}
        transition={{ duration: 1.4, ease: 'linear', repeat: Infinity }}
      />
      </div>

      <h2 className="mt-5 text-lg font-semibold tracking-[-0.01em] text-foreground">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
          {subtitle}
        </p>
      )}
      {boundedProgress !== null && (
        <div className="mt-4 w-52">
          <Progress value={boundedProgress} aria-label={`${boundedProgress}%`} />
          <div className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
            {boundedProgress}%
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Rewire the three HeroButton call sites to Button**

In `src/features/review/ReviewPanel.tsx`: replace `import { HeroButton } from '../../components/HeroButton';` with nothing; replace the `<HeroButton size="sm" disabled={busy || hasErrors} onClick={onGenerate}>` opening tag with `<Button size="sm" disabled={busy || hasErrors} onClick={onGenerate}>` and its `</HeroButton>` with `</Button>`. `Button` and `Check` are already imported in that file.

In `src/features/workflow/components/WorkflowWorkspace.tsx`: replace `import { HeroButton } from '../../../components/HeroButton';` with nothing; replace `<HeroButton onClick={() => onConsent(true)}>` with `<Button onClick={() => onConsent(true)}>` and its `</HeroButton>` with `</Button>`. `Button` is already imported. Delete the `orbState="working"` prop on the `WorkLoader` in the busy view (lines ~111-116), keeping title/subtitle/progress.

In `src/features/onboarding/Onboarding.tsx`: replace `import { HeroButton } from '../../components/HeroButton';` with nothing; replace the `<HeroButton` opening tag around line 229 with `<Button` and its `</HeroButton>` with `</Button>`. Check `Button` is imported in that file; if not, add `import { Button } from '../../components/ui/button';`.

- [ ] **Step 6: Rewrite the orb test as an arc-always test**

In `tests/work-loader.dom.test.tsx`, replace the last test with:

```tsx
  it('always renders the quiet arc (no orb variant)', () => {
    const { container } = render(<WorkLoader title="Working" />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByRole('status')).not.toBeNull();
  });
```

- [ ] **Step 7: Verify this task**

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run tests/work-loader.dom.test.tsx tests/review-dialog.dom.test.tsx tests/review-panel.test.tsx`
Expected: all pass.

- [ ] **Step 8: Commit**

Run: `git add package.json package-lock.json src/components/WorkLoader.tsx src/components/AiOrb.tsx src/components/HeroButton.tsx src/features/workflow/components/WorkflowWorkspace.tsx src/features/review/ReviewPanel.tsx src/features/onboarding/Onboarding.tsx tests/work-loader.dom.test.tsx && git commit -m "chore(design): purge decorative deps, AiOrb, HeroButton"`
Expected: commit created. Verify with `git status --short` that no unrelated files were staged.

---

### Task 2: Token core — stock zinc theme, fonts, dark mechanism

**Files:**
- Modify: `src/index.css`, `index.html`, `src/app/useColorScheme.ts`
- Modify: `tests/color-scheme.dom.test.tsx`, `tests/accessibility-ui.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: canonical tokens (`--background`, `--primary`, …), `.dark` class mechanism, `applyResolvedScheme` writing the class.

- [ ] **Step 1: Rewrite the token block in index.css**

Replace the entire `:root { … }` token section (ledger primitives + bridge aliases, currently lines ~261-302) with:

```css
:root {
  --radius: 0.625rem;
  --background: #ffffff;
  --foreground: #18181b;
  --card: #ffffff;
  --card-foreground: #18181b;
  --popover: #ffffff;
  --popover-foreground: #18181b;
  --primary: #18181b;
  --primary-foreground: #fafafa;
  --secondary: #f4f4f5;
  --secondary-foreground: #18181b;
  --muted: #f4f4f5;
  --muted-foreground: #52525b;
  --accent: #f4f4f5;
  --accent-foreground: #18181b;
  --destructive: #dc2626;
  --destructive-foreground: #fafafa;
  --border: #e4e4e7;
  --input: #e4e4e7;
  --ring: #a1a1aa;
  /* Default duration for the shimmer/spin keyframes below. */
  --speed: 2s;
}
```

Replace the entire `[data-mantine-color-scheme='dark'] { … }` token block with:

```css
.dark {
  --background: #09090b;
  --foreground: #fafafa;
  --card: #09090b;
  --card-foreground: #fafafa;
  --popover: #09090b;
  --popover-foreground: #fafafa;
  --primary: #fafafa;
  --primary-foreground: #18181b;
  --secondary: #27272a;
  --secondary-foreground: #fafafa;
  --muted: #27272a;
  --muted-foreground: #a1a1aa;
  --accent: #27272a;
  --accent-foreground: #fafafa;
  --destructive: #f87171;
  --destructive-foreground: #fafafa;
  --border: #27272a;
  --input: #27272a;
  --ring: #71717a;
}
```

- [ ] **Step 2: Delete the bridge and brand tokens from @theme inline**

Delete these lines from the `@theme inline` block: `--color-gold`, `--color-gold-deep`, all eight `--color-ledger-*` lines. Keep every `--color-background` … `--color-card-foreground` line, re-pointed at the same-named vars (they already are).

- [ ] **Step 3: Flatten the app frame, drop brand fonts**

Delete the `[data-mantine-color-scheme='dark'] .app-frame` gradient block, the `.app-frame::after` grain block, and the `[data-mantine-color-scheme='light'] .app-frame` block. Replace with:

```css
.app-frame {
  background: var(--background);
}
```

Keep the base `.app-frame` layout rule (height/flex/border-radius/overflow/border) that sits above those blocks; only the three theme blocks go.

In `body`, replace `font-family: 'Public Sans', 'Segoe UI', system-ui, sans-serif;` with `font-family: system-ui, sans-serif;`. Delete the `.font-serif-display` rule entirely. Delete `.font-mono-figures` only if `Select-String -Pattern "font-mono-figures" -Path "src/*","src/**/*"` outside index.css returns nothing; otherwise keep it.

In the titlebar focus CSS, replace `outline: 2px solid var(--gold-deep);` with `outline: 2px solid var(--ring);`.

Replace `@custom-variant dark (&:where([data-mantine-color-scheme=dark], [data-mantine-color-scheme=dark] *));` and its comment with nothing (Tailwind's built-in `dark:` variant takes over).

- [ ] **Step 4: Drop webfont loading from index.html**

Delete the `preconnect` link line and the Google Fonts stylesheet link line (currently lines 8-12, families Domine/Public Sans/IBM Plex Mono). If `font-mono-figures` was kept in Step 3, keep the IBM Plex Mono link and delete only the Domine/Public Sans families from the URL instead.

- [ ] **Step 5: Cut useColorScheme to the .dark class (test-first)**

First update the test file `tests/color-scheme.dom.test.tsx`:
- Line 3-5 comment: replace with `// App-owned color scheme writes the stock .dark class that Tailwind's`
  `// dark: variant keys off, and resolves the persisted choice with legacy adoption.`
- Line 28 test name: `'prefers our key, adopts the legacy setting key, else auto'`.
- Line 42: replace `expect(document.documentElement.dataset.mantineColorScheme).toBe('light');` with `expect(document.documentElement.classList.contains('dark')).toBe(false);`
- Line 49: replace `expect(document.documentElement.dataset.mantineColorScheme).toBe('dark');` with `expect(document.documentElement.classList.contains('dark')).toBe(true);`

Run: `npx vitest run tests/color-scheme.dom.test.tsx`
Expected: FAIL (hook still writes the dataset attribute).

Then rewrite `src/app/useColorScheme.ts`:
- Line 7-9 comment + `LEGACY_MANTINE_KEY`: replace with `/** Previous attribute-based scheme persisted under this key — adopt it once so users keep their choice. */` and `const LEGACY_MANTINE_KEY = 'mantine-color-scheme';` (key string unchanged, comment only).
- Delete line 10-11 (`ATTRIBUTE` const + comment).
- `applyResolvedScheme`: replace body with `document.documentElement.classList.toggle('dark', scheme === 'dark');`
- Line 51 comment: replace with `/** Owns the .dark class. Persists locally; callers mirror the choice */` keeping the rest of the comment lines as-is.

Run: `npx vitest run tests/color-scheme.dom.test.tsx`
Expected: PASS.

- [ ] **Step 6: Update accessibility-ui gold assertions**

In `tests/accessibility-ui.test.ts` lines 18-24, replace:
`expect(css).toMatch(/outline:\s*2px solid var\(--gold-deep\)/);` with `expect(css).toMatch(/outline:\s*2px solid var\(--ring\)/);`
and delete the line `expect(css).toMatch(/--gold-deep:\s*#9a6700/);`.

- [ ] **Step 7: Verify this task**

Run: `npm run typecheck`
Expected: clean (screen files still reference ledger classes — those resolve to nothing until Task 3, so typecheck passes; visual breakage is expected mid-flight).

Run: `npx vitest run tests/color-scheme.dom.test.tsx tests/accessibility-ui.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

Run: `git add src/index.css index.html src/app/useColorScheme.ts tests/color-scheme.dom.test.tsx tests/accessibility-ui.test.ts && git commit -m "chore(design): stock zinc tokens, fonts, .dark mechanism"`
Expected: commit created.

---

### Task 3: Screen sweep A — shell, onboarding, workflow

**Files:**
- Modify: `src/components/TitleBar.tsx`, `src/components/DialogShell.tsx`, `src/components/ErrorBoundary.tsx`
- Modify: `src/features/onboarding/Onboarding.tsx`, `tests/work-loader.dom.test.tsx` (orb test only), `src/features/onboarding/LiveDemo.tsx`
- Modify: `src/features/workflow/components/WorkflowWorkspace.tsx`, `src/features/workflow/components/FileUpload.tsx`, `src/features/workflow/components/FileUpload.tsx`

**Interfaces:**
- Consumes: canonical tokens from Task 2.
- Produces: ledger/gold-free shell, onboarding, workflow.

- [ ] **Step 1: TitleBar + DialogShell + ErrorBoundary**

Apply the class map and raw-var map (top of this plan) replace-all in each file, then:
- `TitleBar.tsx` line ~95: the `text-gold…` pill uses `absolute end-1 top-1…` — after map it must read `text-primary` with no `dark:*` suffix. Verify by reading the line.
- `FileUpload.tsx` line ~99-102: replace the inline `background: 'linear-gradient(180deg,#f3c968,var(--gold))'` with `background: 'var(--primary)'` and delete the `boxShadow` property on that style object.
- `WorkflowWorkspace.tsx` line 87: `text-gold-deep dark:text-gold` → `text-primary`. Line 148: `text-gold …` → `text-primary`.

- [ ] **Step 2: Onboarding + LiveDemo**

Apply both maps replace-all in `Onboarding.tsx` and `LiveDemo.tsx`. Onboarding keeps its layout, language cards, dots, and tour copy; only tokens change.

- [ ] **Step 3: Verify this task**

Run: `Get-ChildItem -Path "src/components/TitleBar.tsx","src/components/DialogShell.tsx","src/components/ErrorBoundary.tsx","src/features/onboarding/Onboarding.tsx","src/features/onboarding/LiveDemo.tsx","src/features/workflow/components/WorkflowWorkspace.tsx","src/features/workflow/components/FileUpload.tsx" | Select-String -Pattern "ledger-|gold|Gold|Domine|font-serif-display"`
Expected: no matches.

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

Run: `git add src/components/TitleBar.tsx src/components/DialogShell.tsx src/components/ErrorBoundary.tsx src/features/onboarding/Onboarding.tsx src/features/onboarding/LiveDemo.tsx src/features/workflow/components/WorkflowWorkspace.tsx src/features/workflow/components/FileUpload.tsx && git commit -m "chore(design): canonical tokens for shell, onboarding, workflow"`
Expected: commit created.

---

### Task 4: Screen sweep B — review set, settings, history, about

**Files:**
- Modify: `src/features/review/ReviewPanel.tsx`, `src/features/review/PackageSummaryList.tsx`, `src/features/review/ReviewItemRow.tsx`, `src/features/review/ReviewItemsDialog.tsx`
- Modify: `src/features/settings/ConfirmDialog.tsx`, `src/features/history/HistoryDrawer.tsx`, `src/features/about/AboutModal.tsx`

**Interfaces:**
- Consumes: canonical tokens from Task 2.
- Produces: ledger/gold-free review, settings, history, about.

- [ ] **Step 1: Review files**

Apply both maps replace-all in all four files, then fix these by hand:
- `ReviewPanel.tsx` line ~128: `font-serif-display text-[24px] font-semibold text-gold-deep dark:text-gold` → `text-[24px] font-semibold text-foreground`.
- `ReviewPanel.tsx` lines ~150, ~159: `bg-gold/8 … text-gold-deep dark:text-[#f0d8a0]` → `bg-primary/5 … text-primary`.
- `PackageSummaryList.tsx` line 45: `hover:bg-gold/6` → `hover:bg-primary/5`; `focus-visible:ring-gold-deep/70` → `focus-visible:ring-ring`; the `aria-[flagged]` gradient `rgba(226,116,90,0.08)` stays (destructive-tinted, not gold).
- `PackageSummaryList.tsx` line 86: `` `${workPackage.code === 'WP-99' ? 'bg-ledger-danger' : 'bg-gold'}` `` → `` `${workPackage.code === 'WP-99' ? 'bg-destructive' : 'bg-primary'}` ``.
- `PackageSummaryList.tsx` line 61: `border-ledger-danger/30 text-ledger-danger` → `border-destructive/30 text-destructive` (covered by map; verify).

- [ ] **Step 2: Settings confirm, history, about**

Apply both maps replace-all in `ConfirmDialog.tsx` (`font-serif-display text-[15px]` → `text-[15px] font-semibold`), `HistoryDrawer.tsx` (including the `tone === 'gold'` branch → retarget to `text-primary hover:text-primary` keeping the branch structure), `AboutModal.tsx` (all lines per map; the `bg-ledger-bg -m-6` wrapper → `bg-background`).

- [ ] **Step 3: Verify this task**

Run: `Get-ChildItem -Path "src/features/review/ReviewPanel.tsx","src/features/review/PackageSummaryList.tsx","src/features/review/ReviewItemRow.tsx","src/features/review/ReviewItemsDialog.tsx","src/features/settings/ConfirmDialog.tsx","src/features/history/HistoryDrawer.tsx","src/features/about/AboutModal.tsx" | Select-String -Pattern "ledger-|gold|Gold|Domine|font-serif-display"`
Expected: no matches.

Run: `npm run typecheck`
Expected: clean.

Run: `npx vitest run tests/review-panel.test.tsx tests/review-dialog.dom.test.tsx tests/history-drawer.dom.test.tsx tests/settings-tabs.dom.test.tsx tests/provider-fields.dom.test.tsx`
Expected: all pass.

- [ ] **Step 4: Commit**

Run: `git add src/features/review/ReviewPanel.tsx src/features/review/PackageSummaryList.tsx src/features/review/ReviewItemRow.tsx src/features/review/ReviewItemsDialog.tsx src/features/settings/ConfirmDialog.tsx src/features/history/HistoryDrawer.tsx src/features/about/AboutModal.tsx && git commit -m "chore(design): canonical tokens for review, settings, history, about"`
Expected: commit created.

---

### Task 5: Budgets, notices, full verification, cold-start check

**Files:**
- Modify: `scripts/verify-architecture.cjs` (budgets only)

**Interfaces:**
- Consumes: all tasks above.
- Produces: green verification chain.

- [ ] **Step 1: Sweep stragglers**

Run: `Get-ChildItem -Recurse -Include "*.tsx","*.ts","*.css" -Path "src","engine","shared" | Select-String -Pattern "ledger-|--gold|Domine|Public Sans|font-serif-display|metal-fx|thinking-orbs|liquid-gooey|AiOrb|HeroButton|orbState" | Select-Object Path, LineNumber`
Expected: no matches. Also run: `Select-String -Pattern "data-mantine-color-scheme|mantineColorScheme" -Path "src/*","src/**/*" -Include "*.tsx","*.ts","*.css"` — expected: no matches except possibly a legacy-adoption comment in `useColorScheme.ts`, which is fine if it no longer references the attribute mechanism.

Run: `Select-String -Pattern "radio-group" -Path "src/*","src/**/*" -Include "*.tsx","*.ts"` — expected: only `field.tsx` CSS slot selectors, if any. Leave those.

- [ ] **Step 2: Re-pin budgets**

Run: `node -e "for (const f of ['src/bridge.ts','src/features/workflow/useBoqWorkflow.ts','src/features/workflow/useGenerateRevision.ts','src/features/history/HistoryDrawer.tsx','src/components/WorkLoader.tsx','src-tauri/src/store.rs']) { const n = require('node:fs').readFileSync(f,'utf8').split(/\r?\n/).length; console.log(n, f); }"`
Expected: six line counts. For each file whose count differs from its budget in `scripts/verify-architecture.cjs`, update the budget number to the measured count and adjust the adjacent comment (delete stale `+N for …` justifications that no longer apply, e.g. orb/decorative lines). Do not raise any budget above its current value unless the file legitimately grew; prefer the measured count.

- [ ] **Step 3: Notices check**

Run: `npm run verify:notices`
Expected: pass (script tracks only tesseract/exceljs/pdfjs; uninstalls don't affect it). If it fails on a removed lib, delete that lib's section from `THIRD_PARTY_NOTICES.md`.

- [ ] **Step 4: Full verification chain**

Run in order, each must pass before the next:
1. `npm run lint`
2. `npm run typecheck`
3. `npm test` (vitest run, full suite)
4. `npx vite build`
5. `cargo test --manifest-path src-tauri/Cargo.toml`
6. `npm run verify:architecture`
7. `npm run verify:docs`
8. `npm run verify:install-scripts`

- [ ] **Step 5: Shimmer assertion disposition**

`tests/accessibility-ui.test.ts` asserts `.animate-shimmer-slide,` exists in CSS. If the shimmer/spin classes survived Task 2 untouched, do nothing. If Task 2 removed them, re-point that assertion at `.animate-accordion-down,` (a live animation class) instead.

- [ ] **Step 6: Cold-start desktop check (manual)**

Restart the desktop app (cold start, not HMR). Verify: Settings 2 tabs with provider dropdown + brand marks; onboarding 3 steps; workflow idle/busy/done + consent; review panel + dialog; history drawer; about modal — each in light + dark, EN + AR (RTL), keyboard-only pass, reduced-motion on. Log any visual defect as a follow-up; do not fix inside this plan.

- [ ] **Step 7: Commit**

Run: `git add scripts/verify-architecture.cjs THIRD_PARTY_NOTICES.md tests/accessibility-ui.test.ts && git commit -m "chore(design): re-pin budgets, final verification"`
Expected: commit created.
