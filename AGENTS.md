# FoxForge GG

Agent-oriented project context for **FoxForge GG** (`unite-build-optimizer`) — a Pokémon UNITE build optimizer with a pure calculation engine, versioned game data, and a React UI. Deeper dives live in `docs/`.

The mobile-first UI is implemented on branch `mobile-first-rebuild` (not merged to `main`). Follow-on polish is tracked in `../plans/Rebuild/`. This document describes the codebase as it exists today.

## Product Context

### Target Audience

Pokémon UNITE players ranging from casual newcomers to competitive optimizers who want to design, compare, and share emblem and held-item loadouts without manually crunching in-game math.

### Use Cases

- Select a Pokémon and assemble a loadout (up to 10 emblems, 3 held items, trainer/battle item) with live effective-stat feedback.
- Tune each held item's grade (1–40) — tap-to-type via shared `GradeField` on the Held Items page and in the Builder (Build held-item slots also keep a grade slider); pick each Pokémon's two final (upgraded) moves; both feed the live stats. Unique Items (Mega Stones and Rusted Sword) have no grade stats or grade UI on either surface (`isUniqueHeldItem` in `gameData.ts`).
- Visualize how a build scales from level 1–15, including attack-speed breakpoints and active combat boosts.
- Browse curated community builds (UNITE-DB sourced), apply them in one click, or get emblem recommendations constrained by an owned-inventory model.
- Save up to 20 loadouts locally, compare two builds side-by-side, and share builds via URL hash.
- Use the tool as a hosted PWA or local dev build.

### Key Benefits

- Accuracy-first stat engine that mirrors in-game stacking order, rounding, mitigation, RSB damage, and attack-speed frame logic.
- Rich visual presentation (portraits, item/emblem icons) with Basic vs Advanced modes to balance simplicity and depth.
- Patchable game data via versioned JSON bundles—no code changes required for balance updates.
- Offline-capable distribution via PWA install.

### Success Criteria

- Calculations pass documented validation targets and known-value gates (`docs/03-Calculation-Engine.md`, `npm run validate`).
- Casual users can apply a recommended build and understand resulting stats without jargon.
- Advanced users can tune emblem grades, toggle active effects, inspect analytics, and compare builds precisely.
- Game data and art can be refreshed from community tooling without breaking the app schema (zod-validated bundles).

### Key Constraints

- No Nintendo/UNITE account integration—owned emblems are tracked locally for security and ToS reasons.
- First-party APK datamining is blocked (rotated bundle encryption); community UNITE-DB sourcing is the live data path.
- Game accuracy is non-negotiable: stacking order and rounding rules must match in-game behavior.
- AGPL-3.0-only license; distribution is the GitHub Pages web app (PWA).

## Architecture & Patterns

### How This System Works

FoxForge GG is a three-layer app: a **pure calculation engine**, a **versioned data layer**, and a **React UI** that never reimplements game math inline.

User edits flow through `src/state/store.tsx` (reducer + context) into a `Loadout` model (`src/state/loadout.ts`, persisted in localStorage). Every stat display path calls `deriveBuild` / `deriveAtLevel` in `src/engine/derive.ts`, which is the single aggregation point: emblem flats and set bonuses → held items → active toggles → attack speed. UI components (`BuildSummaryBar`, `StatPanel`, `CompareView`, `LevelGraph`) consume `DerivedBuild` only—changing formulas happens in `src/engine/` without touching components.

Game facts live in zod-validated JSON loaded via `src/data/loadBundle.ts`, with lookup maps exposed via `src/data/gameData.ts`. The build-time baseline is `src/data/patch-current.json` (stable filename; `patchVersion` is inside the JSON). The published runtime copy under `public/data/` is version-stamped (`patch-<version>.json` plus `manifest.json`) for cache-busting and is produced by the data refresh workflow. Numeric data is refreshed by Python tooling under `tools/community/`—hand-editing bundle JSON is discouraged; curated builds and label overrides belong in `curated_builds.json` (see below). UNITE-DB ships blank move descriptions for many Pokémon; `tools/community/move_descriptions.json` (Serebii-sourced, via `scrape_serebii.py`) is merged by `normalize.py` to fill only empty move `description` fields—existing UNITE-DB text always wins. Blank passive descriptions are backfilled from the raw passive skill's `rsb.true_desc` in `_raw/pokemon.json` (local UNITE-DB mirror, not Serebii). Art mirrors under `public/assets/` and resolves portably via `src/ui/asset.ts` (supports relative `base: "./"` for static hosts and GitHub Pages sub-paths).

Recommendations (`src/engine/recommend.ts`) sit beside the engine but must respect the same stat model and owned-emblem inventory semantics as the editor.

### Engine-First, UI-Second Boundary

`src/engine/` modules are pure TypeScript with Vitest coverage. `formulas.ts`, `emblems.ts`, `attackSpeed.ts`, `effects.ts`, and `derive.ts` must remain free of React/DOM imports. New combat mechanics extend the engine and data schema first; UI toggles and panels follow.

Treat these paths as frozen unless a task explicitly requires engine or data-pipeline changes: `src/engine/`, `tools/`, `src/state/loadout.ts`, `src/state/heldItemGrades.ts`. Patch bundles under `src/data/` and `public/data/` are normally pipeline-generated; the baseline uses a stable filename while the published copy is version-stamped (see Data Bundle Versioning). `src/state/store.tsx` has been edited for theme preference wiring only (`themePref`, `setThemePref`, OS listener); all other store behavior is unchanged.

### Single Derivation Path

All effective-stat rendering goes through `deriveBuild`. Level-scaling graphs use `deriveAtLevel` rather than duplicating stacking logic. Violating this leads to StatPanel/CompareView drift.

Formatting for display: `src/ui/format.ts` (`STAT_ROWS`, `formatStat`, `formatDelta`). Never reimplement stat math or formatting in components.

### Integration Contract (`useStore`)

`loadout`, `dispatch` — the in-progress build + reducer (`setPokemon`, `setLevel`, `setHeldItem`, `setBattleItem`, `addEmblem`, `removeEmblem`, `setEmblemGrade`, `toggleBoost`, `setMove`, `applyBuild`, `load`, `reset`).

`saved`, `save`, `remove`, `loadSaved`, `saveError`, `shareUrl()` — saved loadouts + sharing.

`owned`, `toggleOwned`, `bulkSetOwned` — emblem inventory.

`mode` (`"beginner" | "expert"`), `setMode`, `expert` — complexity toggle (UI labels **Basic** / **Advanced**; stored values unchanged).

`heldItemGrade(id)`, `setHeldItemGradeById(id, g)`, `heldSlotGrades`, `setHeldItemGradeForSlot(slot, g)` — held-item grades.

`theme`, `themePref`, `setThemePref` — appearance (see Theming below).

Live stats: `deriveBuild(loadout, true, heldSlotGrades)` returns `{ pokemon, effective, base, attackSpeed, oocMoveSpeed, availableBoosts, emblemLoadout, buffedStats }`.

### Data Bundle Versioning

The build-time baseline bundle is `src/data/patch-current.json` plus optional sidecars (`attackSpeedBoosts.json`). The `patchVersion` field inside the JSON is the human-set patch id (`PATCH_VERSION` env in `normalize.py`, default `1.23.1.1` — UNITE-DB exposes no version). Published copies land in `public/data/patch-<version>.json` with a `manifest.json` pointer. At launch, `src/data/dataSource.ts` checks the remote manifest, downloads and caches validated payloads in localStorage (`unite-build-optimizer.dataCache.v1`), and `src/data/gameData.ts` loads via `activeRaw()` — cached data applies only when strictly newer than the baseline's `lastUpdated`, with a zod fallback to the shipped baseline on schema mismatch. Schema changes require zod updates in `loadBundle.ts` and corresponding tests (including the curated-merge guard in `patchBundle.test.ts`).

Each Pokémon may carry two build arrays:
- `builds` — **Recommended** tab; UNITE-DB builds emitted by `normalize.py`. Array order is the tab display order; the first entry auto-applies when the user switches Pokémon (`RecommendPanel`).
- `creativeBuilds` — **Creative** tab; hand-curated community builds (not emitted by `normalize.py`).

Runtime-only `builds` reordering (both patch copies, object fields unchanged) is occasionally applied for display/default-build preferences; `normalize.py` overwrites it unless the order is expressed as a per-Pokémon `builds` overlay in `curated_builds.json`.

Curated Recommended/Creative builds and build-label overrides live in `tools/community/curated_builds.json` and are merged by `normalize.py` (`apply_curated_builds`) after UNITE-DB normalization. **Do not hand-edit `emblemName` in patch JSON** — regeneration will clobber it. Instead:
- `_emblemNameRemap` (top-level): remap raw UNITE-DB `emblemName` strings across all Recommended builds before per-Pokémon overrides. A string value replaces unconditionally; an object value selects by the Pokémon's `role` (`AllRounder`, `Defender`, etc.).
- Per Pokémon `id`: `builds` (replace Recommended), `creativeBuilds` (set Creative), or `recommendedTitles` (override `emblemName` by build index — for distinct labels from one raw name, e.g. Scizor). `builds` and `recommendedTitles` are mutually exclusive.
- `lane` edits that aren't covered by remap use full `builds`/`creativeBuilds` overlay entries.

Move descriptions use the overlay pattern above: `scrape_serebii.py` writes `move_descriptions.json`; `normalize.py` backfills blank move descriptions from it (Serebii slug map is explicit—do not derive slugs algorithmically). Passive descriptions fall back to `rsb.true_desc` when UNITE-DB's top-level `description` is blank. In `RecommendPanel.tsx`, the Builds card header shows `emblemName ?? name`, then optional ` · lane`; its Final Moves sub-block always resolves both slots via `resolveFinalMove` + `moveIdsFromNames` so partial or empty curated `moves` lists still show two icons matching the applied loadout.

### State and Persistence

- Current loadout auto-persists; saved loadouts capped at 20.
- Owned emblems are keyed per grade (Bronze/Silver/Gold) independently.
- Held item grades (1–40) are global per item ID, not stored in saved builds or share links. Unique held items (`isUniqueHeldItem`) skip grade storage and controls entirely.
- Share links encode loadout state in the URL hash (`#b=`).
- Theme preference (`themePref`) and Basic/Advanced mode (`beginner`/`expert` in storage) persist locally (`unite-build-optimizer.theme.v1`, `unite-build-optimizer.mode.v1`).
- Collapsible card open state persists per section (`unite-build-optimizer.collapsed.{persistKey}`). First visit defaults (no stored toggle): Builds and Effective Stats open; all other Build-tab collapsible cards closed (Held Items, Trainer Item, Emblems, Moves, Save & Load; Advanced: Attack Speed, Level Scaling, Combat Analytics, Active Effects). Each card falls back to its `defaultOpen` prop when localStorage has no value for that `persistKey`.
- Active tab (`build` | `compare` | `emblems` | `items`) persists locally (`unite-build-optimizer.tab.v1`) for fast-resume on reload.

### Current UI Shell (`src/App.tsx`)

No router library — navigation is local React state.

- **App bar** — fixed top bar (`AppBar` from `src/components/shell/`), gradient from `--color-appbar-*` tokens, `pt-safe`. On the Build tab: selected Pokémon cropped thumbnail (`iconAsset`, same crop as the picker grid), name, role badge, and attack type. Icon and name are separate tappable buttons — both open the Pokémon picker overlay (placeholder circle opens the picker when none is selected). On other tabs: static screen title ("Emblems", "Held Items", "Compare"). Single **Basic**/**Advanced** mode toggle (`ModeToggle` in `AppBar.tsx` — shows current mode, tap flips; color-coded via `--color-mode-*` tokens) and settings gear on all tabs.
- **Tab bar** — fixed bottom navigation (`TabBar`): Build · Emblems · Items; Compare appears only in Advanced mode (4 tabs vs 3). Switching from Advanced to Basic while on Compare redirects to Build.
- **Build screen** — `BuildScreen` composes `BuildSummaryBar` (sticky glance hero pinned under the app bar), `RecommendPanel`, `LoadoutEditor`, `MovesCard`, `StatPanel`, `LoadoutBar`, and `LevelGraph` (Advanced only; lazy-loaded via `React.lazy` + `Suspense` in `BuildScreen.tsx` so recharts is not in the initial bundle). `LoadoutEditor` held-item slots use shared `GradeField` plus a grade slider (unique items skip both). Pokémon selection is not inline; the hero empty state and app-bar icon or title tap open `PokemonPickerSheet`.
- **Emblems screen** — `EmblemsScreen` renders `InventoryManager` (per-grade ownership, search, horizontal color chip filters, responsive emblem grid).
- **Items screen** — `ItemsScreen` renders `HeldItemsInventory` (global held-item grades via shared `GradeField`, grade instructions with a tap-for-detail hint, 3-column tile grid on phones, `HeldItemDetailModal` on icon tap).
- **Compare screen** — `CompareScreen` renders `CompareView` (Advanced only; build A/B selects stack on phones; stat table scrolls horizontally inside its wrapper).
- **Layout** — single column, `max-w-2xl` centered, `gap-3` between sections. `<main>` padding clears the fixed app bar and tab bar (safe-area aware). Interactive controls target ≥44px hit areas (`min-h-11`); tappable labels use `text-sm` minimum — the Build glance hero (`BuildSummaryBar`) is the primary oversized readout.
- **Overlays** — `BottomSheet` (`src/components/shell/BottomSheet.tsx`) is the shared responsive overlay (bottom sheet on phones, centered card on `sm+`). Callers: `SettingsMenu` (gear; Appearance theme picker, Updates with manual game-data check + displayed patch version and data attribution, app version/PWA-install copy, About, Legal), `PokemonPickerSheet` (app-bar icon or title tap, or hero empty state; search does not auto-focus on open so the grid is browsable without the on-screen keyboard), and `PickerModal` (held/trainer/emblem pickers from `LoadoutEditor`; search does not auto-focus on open so the list is browsable without the on-screen keyboard). Picker callers pass `fillHeight` so the panel stays at fixed `88vh`/`80vh` while search filters results in place; `SettingsMenu` omits it and keeps content-fit sizing. `HeldItemDetailModal` keeps its existing centered-modal shell.
- **Footer** — legal disclaimer, copyright, and patch line live in Settings → Legal (sourced from `src/ui/brand.ts`); they are not rendered in `App.tsx`.
- **Data updates** — `unite-data-updated` window event shows a reload banner inside `<main>`.

### Semantic Theming

UI surfaces use Tailwind v4 semantic tokens defined in `src/index.css` (`bg-surface`, `text-ink`, etc.), toggled via `data-theme` on the document root. Role/stat accent colors may stay literal; structural chrome must not hardcode light-only neutrals. Role badge classes (`ROLE_COLOR`) and solid filter-chip fills (`ROLE_FILTER_HEX`) live in `src/ui/theme.ts`; active picker role chips and emblem color chips pair those fills with `readableTextColor()` from `src/ui/colors.ts` for legible labels in light and dark mode. Native form controls (`<select>`, `<option>`) need explicit `bg-surface text-ink` so dropdown popups stay legible in dark mode (`color-scheme: dark`).

**Resolved themes:**

| `theme` | Palette |
| --- | --- |
| `light` | Clean & minimal — neutral surfaces, calm indigo accent |
| `dark` | Neon-graffiti brand — magenta→cyan accents, deep purple-black surfaces |

**Preference API** (`src/state/store.tsx`):

| Member | Type | Role |
| --- | --- | --- |
| `theme` | `"light" \| "dark"` | Resolved applied theme |
| `themePref` | `"system" \| "light" \| "dark"` | Stored preference (default `"system"`) |
| `setThemePref` | `(p: ThemePref) => void` | Sets preference and resolves `theme` |

`system` follows `prefers-color-scheme`, defaulting to dark when the OS states no preference. A `matchMedia` listener updates `theme` live while `themePref === "system"`. Resolved theme sets `document.documentElement.dataset.theme` and the `theme-color` meta (`#110d1f` dark, `#ffffff` light). Explicit `light`/`dark` persist in localStorage; `system` removes the key.

`SettingsMenu` → Appearance exposes a 3-way `System · Light · Dark` control bound to `themePref` / `setThemePref`.

**Token families in `src/index.css`:** core surfaces (`--color-bg`, `--color-surface`, …), tone cards (`--color-rec-*`, `--color-as-*`, `--color-an-*`), picker tiles (`--color-mon-*`), grade controls (`--color-grade-*`), app-bar tokens (`--color-appbar-*`), tab-bar tokens (`--color-tab-*`), mode-toggle pill (`--color-mode-basic-*`, `--color-mode-advanced-*`). Safe-area helpers: `@utility pt-safe` / `pb-safe` via `env(safe-area-inset-*)`. Viewport meta includes `viewport-fit=cover` in `index.html` and intentionally omits `maximum-scale=1` / `user-scalable=no` so pinch-zoom stays available. Base polish also forces `font-size: 16px` on text-entry controls (`input` except range/checkbox/radio, `select`, `textarea`) so iOS Safari does not auto-zoom on focus; the `:not([type=…])` chain keeps specificity above Tailwind `.text-sm`.

Branding constants: `src/ui/brand.ts`, `docs/08-branding.md`. Historical token rationale: `docs/06-theme-plan.md`.

### Web distribution & build

FoxForge GG ships as a **hosted PWA only** — no native desktop shell. The same Vite build serves local dev, installable PWA (`base: "./"`), and GitHub Pages (`VITE_BASE=/FoxForge-GG/` via `npm run build:pages`). [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs lint, format check, typecheck, tests, and accuracy gates on every push and pull request. [`.github/workflows/pages.yml`](.github/workflows/pages.yml) redeploys to GitHub Pages on push to `main` (after the same accuracy gates, then `build:pages`). Game-data refresh runs daily at 09:00 UTC (and on demand) via [`.github/workflows/data.yml`](.github/workflows/data.yml): scrape/normalize, mirror new art (`fetch_art.py`), validate (`verifyPatch.ts`, `npm test`, `validate:art`), publish to `public/data/`, and open or update a PR on `data/auto-refresh` with a semantic changelog from `tools/community/diff_bundle.py` (new entities flagged for curation). When that PR already exists, a follow-up `@AeroKita` comment re-notifies on each update — it never commits directly to `main`.

Two independent update channels: **app code** (PWA service worker picks up a new deploy on reload) and **game data** (`src/data/dataSource.ts` fetches `data/manifest.json` from Pages, caches to localStorage, and `gameData.ts` applies it on the next load via `activeRaw()`; see `docs/07-distribution.md`). `vite.config.ts` encodes Pages-specific service-worker self-destruct behavior to avoid stale-cache blank screens—distribution concerns live in config, not business logic.

### Documentation Authority

Human-oriented deep dives live in `docs/` (architecture, calculation engine, data sourcing, distribution, branding). When behavior is ambiguous, those docs and engine validation tests are the source of truth—not comments in components.

## Tech Stack & Tooling

TypeScript/React SPA with a pure calculation engine and community-sourced game data pipelines.

### Environment Setup

- **Node.js 24+** (matches CI in `.github/workflows/`).
- **npm** for JS dependencies and scripts (`package.json`).
- **Python 3** with a venv under `tools/extract/.venv` for community data refresh scripts (`tools/community/`).

Clone, `npm install`, and you're ready to develop.

### Build Tools

| Tool | Role | Configuration |
| --- | --- | --- |
| Vite 8 | Dev server, production bundler, Vitest host | `vite.config.ts` |
| TypeScript | Type-checking (`tsc --noEmit`) | `tsconfig.json` |
| Tailwind CSS v4 | Semantic token styling via `@tailwindcss/vite` | `src/index.css`, `vite.config.ts` |
| vite-plugin-pwa | PWA manifest + Workbox caching (non-Pages builds) | `vite.config.ts` |
| oxlint | Lint (React hooks, correctness category); CI fails on errors | `.oxlintrc.json` |
| oxfmt | Format TS/TSX (Prettier-compatible); data JSON bundles are excluded | `.oxfmtrc.json` |

Key scripts (from `package.json`): `npm run dev`, `npm run build`, `npm run build:pages`, `npm run typecheck`, `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`.

Version is sourced from `package.json`.

### Testing Process

Tests run in **Vitest** with `environment: "node"`, matching `src/**/*.test.ts` (configured in `vite.config.ts`).

| Command | Purpose |
| --- | --- |
| `npm run lint` | oxlint — errors fail CI; `react/exhaustive-deps` is warn-only |
| `npm run format:check` | oxfmt `--check` on `src/**/*.{ts,tsx}` and `vite.config.ts` |
| `npm test` | Engine, bundle, dataSource, attack-speed, share, and state unit tests |
| `npm run validate` | Known-values gate from `docs/03-Calculation-Engine.md` |
| `npx tsx src/data/verifyPatch.ts` | End-to-end validation of the live UNITE-DB bundle |
| `npm run validate:art` | Validates mirrored images under `public/assets/` are real files (not corrupt/HTML) |
| `python3 -m unittest tools/community/test_diff_bundle.py` | Semantic bundle-diff changelog unit tests (`diff_bundle.py`) |
| `npm run typecheck` | `tsc --noEmit` |

Every push and PR runs the full gate via `.github/workflows/ci.yml` (lint through `validate:art`, in that order). Local pre-push equivalent:

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run validate && npx tsx src/data/verifyPatch.ts
```

Game data refresh (separate `data.yml` workflow):

```bash
cd tools/community && source ../extract/.venv/bin/activate
python3 fetch.py && python3 scrape_serebii.py && python3 normalize.py && python3 fetch_art.py && python3 normalize_as_boosts.py
```

`scrape_serebii.py` fetches Serebii move text into `move_descriptions.json` (run after `fetch.py`, before `normalize.py`). `normalize.py` writes `src/data/patch-current.json`; the Refresh game data workflow copies it to `public/data/patch-<version>.json`, updates `manifest.json`, mirrors art, and posts a field-level PR changelog via `diff_bundle.py` (or sync manually when running locally). Edit `curated_builds.json` (`_emblemNameRemap`, per-Pokémon `builds`/`creativeBuilds`/`recommendedTitles`) before re-running — never hand-edit curated labels in the bundle. Bump the patch id via `PATCH_VERSION=… python3 normalize.py` or the workflow's optional `patch_version` input.

Curated-build-only edits (no UNITE-DB re-scrape):

```bash
python3 tools/community/normalize.py   # re-merge curated_builds.json (_emblemNameRemap + overlays) + move_descriptions.json into the bundle
npx tsx src/data/verifyPatch.ts && npm run typecheck && npm test
```

To refresh move descriptions only (no UNITE-DB re-scrape):

```bash
python3 tools/community/scrape_serebii.py && python3 tools/community/normalize.py
```

### Design System

Semantic color and surface tokens are defined in `src/index.css` using Tailwind v4 `@theme` blocks; dark overrides live under `[data-theme="dark"]`. Components should use generated utilities (`bg-surface`, `text-ink`, `border-line`, etc.) rather than raw palette classes for chrome.

Stat role colors (positive/negative, recommend/attack-speed/analytics tone cards) are intentional literals layered on top of semantic surfaces.

Shared modal behavior (`Escape` + scroll lock): `src/ui/useModalDismiss.ts` (used by `BottomSheet`, `HeldItemDetailModal`, and the touch long-press pinned popup in `Tooltip.tsx`). `BottomSheet` (`src/components/shell/BottomSheet.tsx`) is the shared responsive overlay primitive; callers are `SettingsMenu`, `PokemonPickerSheet`, and `PickerModal`. Pickers pass optional `fillHeight` for a constant panel height during live filtering; Settings stays content-fit.

`Tooltip.tsx` wraps emblems, moves, trainer items, and held items: CSS hover tooltip on mouse; touch/pen long-press (~500 ms) opens the same content in a dismissible centered popup (backdrop tap, Escape). Movement cancels the press; the trailing tap is suppressed so long-press does not trigger underlying controls.

Mobile layout conventions: column spacing `gap-3`; `CollapsibleCard` headers `px-4 py-3` with `min-h-11` tap row; buttons, chips, tab items, the app-bar mode toggle, picker tiles, sliders, and emblem grade dots use ≥44px hit areas. Section collapse uses `CollapsibleCard` (`src/components/CollapsibleCard.tsx`) — open state is per `persistKey`, not a global default.

## Key Components

| Area | Path |
| --- | --- |
| App shell | `src/App.tsx` |
| Shell primitives | `src/components/shell/AppBar.tsx`, `TabBar.tsx`, `BottomSheet.tsx` |
| Build tab | `src/components/screens/BuildScreen.tsx` — `BuildSummaryBar`, `RecommendPanel`, `LoadoutEditor`, `MovesCard`, `StatPanel`, `LoadoutBar`, `LevelGraph` (Advanced; lazy-loaded) |
| Pokémon picker | `PokemonPickerSheet` in `src/components/PokemonPicker.tsx` (`BottomSheet fillHeight`; role filter chips color-coded when active via `ROLE_FILTER_HEX`; search does not auto-focus on open) |
| Emblems tab | `src/components/screens/EmblemsScreen.tsx` → `InventoryManager` |
| Items tab | `src/components/screens/ItemsScreen.tsx` → `HeldItemsInventory` (`HeldItemDetailModal`) |
| Compare tab (Advanced) | `src/components/screens/CompareScreen.tsx` → `CompareView` |
| Pickers / settings | `PickerModal` (`BottomSheet fillHeight`; search does not auto-focus on open), `SettingsMenu` (content-fit `BottomSheet`; game-data update check + app version) |
| Grade input | `src/components/GradeField.tsx` — shared tap-to-type grade field (`HeldItemsInventory`, `LoadoutEditor` held-item slots) |
| Item detail | `src/ui/heldItemDetail.tsx` (`HeldItemDetailModal`) |
| Tooltips | `src/components/Tooltip.tsx` (hover + touch long-press popup), `src/components/tips.tsx` |
| State | `src/state/store.tsx`, `src/state/loadout.ts`, `src/state/heldItemGrades.ts` |
| Engine | `src/engine/derive.ts` |
| Data | `src/data/gameData.ts`, `src/data/loadBundle.ts`, `src/data/dataSource.ts` |
