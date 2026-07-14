# Tawreed desktop redesign system

## Product rule

Every screen answers three questions in this order: where am I, what needs my attention, and what is the next action. Secondary facts stay behind disclosure controls.

## Accepted states

The production system covers the selected-workbook, approval, generated-run,
and connection-settings states. Design decisions are represented by this
specification and the implemented components rather than committed mockup
exports. The reference canvas is 1440 x 900 and the production minimum is
960 x 680.

## Tokens

| Role                  | Value          |
| --------------------- | -------------- |
| App background        | `#0a0d11`      |
| Rail background       | `#080b0f`      |
| Working surface       | `#10151b`      |
| Raised surface        | `#151b22`      |
| Border                | `#2a323c`      |
| Border strong         | `#3b4653`      |
| Primary text          | `#f4f7fb`      |
| Secondary text        | `#a4adba`      |
| Tertiary text         | `#788391`      |
| Accent                | `#2583ff`      |
| Accent hover          | `#1673eb`      |
| Success               | `#38c977`      |
| Warning               | `#e9a23b`      |
| Danger                | `#ef5b64`      |
| Radius small / medium | `8px` / `12px` |
| Border width          | `1px`          |
| Control height        | `44px` minimum |

Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64px. Shadows are reserved for menus and overlays; primary layout uses borders and contrast.

## Typography

- Geist Sans for navigation, headings, body, controls, forms, and tables.
- Geist Mono only for file sizes, timestamps, counts, model IDs, and paths.
- Page title: 36px / 1.12 / 500 / -0.035em.
- Section title: 20px / 1.3 / 500 / -0.015em.
- Body: 15px / 1.6 / 400.
- Control: 14px / 1.2 / 500.
- Metadata: 12px / 1.5 / 450.

## Container model

- One fixed 184px command rail at large widths; 76px compact rail at the minimum window.
- One main content plane with a maximum readable width of 1090px.
- Workbench uses a single open task canvas, not a stack of cards.
- Runs uses open list rows with separators.
- Settings uses local section navigation plus one visible category.
- Drawers, accordions, and menus hold package breakdowns, filesystem paths, API details, and destructive actions.

## Component families

- `NavigationRail`: Workbench and Runs as primary destinations; Settings at the bottom. About moves inside Settings.
- `WorkflowRoute`: four stable stages — Workbook, Process, Review, Export — with active, complete, and pending states.
- `TaskHeader`: one title and one sentence maximum.
- `FileRow`: workbook icon, name, size, and Replace action.
- `StatusRow`: success or warning message with an optional text action.
- `DisclosureRow`: one-line expandable details; never open by default.
- `RunRow`: project, generated filename, time, package count, Open, overflow menu.
- `SettingsNav`: Connection, Appearance, About; one section rendered at a time.

## Visible-copy lock

Workbench: `Choose the BOQ workbook`, `Tawreed will inspect and validate it before anything is exported.`, `Start analysis`, `Browse for a different workbook`.

Review: `Ready for your review`, `Every BOQ item is classified. Confirm the summary, then generate the workbook.`, `Items`, `Work packages`, `Warning`, `View package breakdown`, `Generate workbook`, `Cancel`.

Runs: `Generated workbooks`, `Outputs saved on this device.`

Settings: `Settings`, `Connection`, `Appearance`, `About`, `Advanced connection`, `Credentials stay in your operating system keychain.`, `Save changes`.

## Responsive behavior

- At 1100px and below, shrink the rail to 76px and hide rail labels while retaining tooltips and accessible names.
- At 960px, the workflow route keeps all four stages but hides connector labels that cannot fit cleanly.
- Review metrics wrap only as a last resort; details remain collapsed.
- Settings local navigation becomes a horizontal segmented row at the minimum width.
- No primary screen should require horizontal scrolling at 960 x 680.

## Motion and accessibility

- 140–180ms opacity/translate transitions only for state changes and disclosures.
- Respect `prefers-reduced-motion`.
- Native buttons, links, headings, lists, tables, and form labels remain semantic.
- Every icon-only control has an accessible name and tooltip.
- Focus states use a 2px accent outline with 2px offset.
