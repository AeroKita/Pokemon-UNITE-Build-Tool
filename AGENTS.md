# FoxForge GG

Agent-oriented project context for **FoxForge GG** (`unite-build-optimizer`) — a Pokémon UNITE build optimizer with a pure calculation engine, versioned game data, and a React UI. Deeper dives live in `docs/`.

## Product Context

### Target Audience

Pokémon UNITE players ranging from casual newcomers to competitive optimizers who want to design, compare, and share emblem and held-item loadouts without manually crunching in-game math.

### Use Cases

- Select a Pokémon and assemble a loadout (up to 10 emblems, 3 held items, trainer/battle item) with live effective-stat feedback.
- Tune each held item's grade (1–40) — on a dedicated Held Items page or inline in the Builder — and pick each Pokémon's two final (upgraded) moves; both feed the live stats. Unique Items (Mega Stones and Rusted Sword) have no grade stats or grade UI on either surface (`isUniqueHeldItem` in `gameData.ts`).
- Visualize how a build scales from level 1–15, including attack-speed breakpoints and active combat boosts.
- Browse curated community builds (UNITE-DB sourced), apply them in one click, or get emblem recommendations constrained by an owned-inventory model.
- Save up to 20 loadouts locally, compare two builds side-by-side, and share builds via URL hash.
- Use the tool as a hosted PWA, native desktop app (Tauri), or local dev build.

### Key Benefits

- Accuracy-first stat engine that mirrors in-game stacking order, rounding, mitigation, RSB damage, and attack-speed frame logic.
- Rich visual presentation (portraits, item/emblem icons) with Beginner vs Expert modes to balance simplicity and depth.
- Patchable game data via versioned JSON bundles—no code changes required for balance updates.
- Offline-capable distribution options (PWA install, desktop installers with auto-update).

### Success Criteria

- Calculations pass documented validation targets and known-value gates (`docs/03-Calculation-Engine.md`, `npm run validate`).
- Casual users can apply a recommended build and understand resulting stats without jargon.
- Advanced users can tune emblem grades, toggle active effects, inspect analytics, and compare builds precisely.
- Game data and art can be refreshed from community tooling without breaking the app schema (zod-validated bundles).

### Key Constraints

- No Nintendo/UNITE account integration—owned emblems are tracked locally for security and ToS reasons.
- First-party APK datamining is blocked (rotated bundle encryption); community UNITE-DB sourcing is the live data path.
- Game accuracy is non-negotiable: stacking order and rounding rules must match in-game behavior.
- GPL-3.0-only license; distribution uses GitHub Pages (web) and signed Tauri auto-updates (desktop).
- Desktop installers are ad-hoc signed (not Apple/Microsoft code-signed), so first-launch OS warnings are expected.

## Architecture & Patterns

### How This System Works

FoxForge GG is a three-layer app: a **pure calculation engine**, a **versioned data layer**, and a **React UI** that never reimplements game math inline.

User edits flow through `src/state/store.tsx` (reducer + context) into a `Loadout` model (`src/state/loadout.ts`, persisted in localStorage). Every stat display path calls `deriveBuild` / `deriveAtLevel` in `src/engine/derive.ts`, which is the single aggregation point: emblem flats and set bonuses → held items → active toggles → attack speed. UI components (`StatPanel`, `CompareView`, `LevelGraph`) consume `DerivedBuild` only—changing formulas happens in `src/engine/` without touching components.

Game facts live in patch-keyed JSON (`src/data/patch-*.json`) loaded and validated by zod in `src/data/loadBundle.ts`, with lookup maps exposed via `src/data/gameData.ts`. Numeric data is refreshed by Python tooling under `tools/community/`—hand-editing bundle JSON is discouraged; curated builds and label overrides belong in `curated_builds.json` (see below). UNITE-DB ships blank move descriptions for many Pokémon; `tools/community/move_descriptions.json` (Serebii-sourced, via `scrape_serebii.py`) is merged by `normalize.py` to fill only empty move `description` fields—existing UNITE-DB text always wins. Blank passive descriptions are backfilled from the raw passive skill's `rsb.true_desc` in `_raw/pokemon.json` (local UNITE-DB mirror, not Serebii). The bundled baseline (`src/data/`) and the published runtime copy (`public/data/`) must stay byte-identical. Art mirrors under `public/assets/` and resolves portably via `src/ui/asset.ts` (supports relative `base: "./"` for Tauri, static hosts, and GitHub Pages sub-paths).

Recommendations (`src/engine/recommend.ts`) sit beside the engine but must respect the same stat model and owned-emblem inventory semantics as the editor.

### Engine-First, UI-Second Boundary

`src/engine/` modules are pure TypeScript with Vitest coverage. `formulas.ts`, `emblems.ts`, `attackSpeed.ts`, `effects.ts`, and `derive.ts` must remain free of React/DOM imports. New combat mechanics extend the engine and data schema first; UI toggles and panels follow.

### Single Derivation Path

All effective-stat rendering goes through `deriveBuild`. Level-scaling graphs use `deriveAtLevel` rather than duplicating stacking logic. Violating this leads to StatPanel/CompareView drift.

### Data Bundle Versioning

Each game patch is a self-contained JSON bundle (e.g. `patch-1.23.1.1.json`) plus optional sidecars (`attackSpeedBoosts.json`). Runtime can fetch updated bundles from GitHub Pages without rebuilding the app binary. Schema changes require zod updates in `loadBundle.ts` and corresponding tests.

Each Pokémon may carry two build arrays:
- `builds` — **Recommended** tab; UNITE-DB builds emitted by `normalize.py`.
- `creativeBuilds` — **Creative** tab; hand-curated community builds (not emitted by `normalize.py`).

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
- Theme, collapsible card open state, and Beginner/Expert mode persist locally.

### Semantic Theming

UI surfaces use Tailwind v4 semantic tokens defined in `src/index.css` (`bg-surface`, `text-ink`, etc.), toggled via `data-theme` on the document root. Role/stat accent colors may stay literal; structural chrome must not hardcode light-only neutrals. Native form controls (`<select>`, `<option>`) need explicit `bg-surface text-ink` so dropdown popups stay legible in dark mode (`color-scheme: dark`).

### Dual Distribution Shell

The same Vite build serves web (PWA), GitHub Pages (`VITE_BASE=/FoxForge-GG/`), and Tauri desktop (`src-tauri/`). `vite.config.ts` encodes Pages-specific service-worker self-destruct behavior to avoid stale-cache blank screens—web distribution concerns live in config, not business logic.

### Documentation Authority

Human-oriented deep dives live in `docs/` (architecture, calculation engine, data sourcing, distribution, branding). When behavior is ambiguous, those docs and engine validation tests are the source of truth—not comments in components.

## Tech Stack & Tooling

TypeScript/React SPA with a pure calculation engine, optional Tauri desktop shell, and community-sourced game data pipelines.

### Environment Setup

- **Node.js 24+** (matches CI in `.github/workflows/`).
- **npm** for JS dependencies and scripts (`package.json`).
- **Rust toolchain** ([rustup](https://rustup.rs)) only when building or running the Tauri desktop app.
- **Python 3** with a venv under `tools/extract/.venv` for community data refresh scripts (`tools/community/`).

Clone, `npm install`, and you're ready to develop.

### Build Tools

| Tool | Role | Configuration |
| --- | --- | --- |
| Vite 8 | Dev server, production bundler, Vitest host | `vite.config.ts` |
| TypeScript | Type-checking (`tsc --noEmit`) | `tsconfig.json` |
| Tailwind CSS v4 | Semantic token styling via `@tailwindcss/vite` | `src/index.css`, `vite.config.ts` |
| Tauri 2 | Native desktop shell, auto-updater | `src-tauri/tauri.conf.json` |
| vite-plugin-pwa | PWA manifest + Workbox caching (non-Pages builds) | `vite.config.ts` |

Key scripts (from `package.json`): `npm run dev`, `npm run build`, `npm run build:pages`, `npm run tauri dev`, `npm run tauri build`, `npm run typecheck`.

Version is sourced from `package.json` and kept in sync with `src-tauri/tauri.conf.json` on release.

### Testing Process

Tests run in **Vitest** with `environment: "node"`, matching `src/**/*.test.ts` (configured in `vite.config.ts`).

| Command | Purpose |
| --- | --- |
| `npm test` | Engine, bundle, attack-speed, share, and state unit tests |
| `npm run validate` | Known-values gate from `docs/03-Calculation-Engine.md` |
| `npx tsx src/data/verifyPatch.ts` | End-to-end validation of the live UNITE-DB bundle |
| `npm run typecheck` | `tsc --noEmit` |

Game data refresh (not part of routine CI for app logic):

```bash
cd tools/community && source ../extract/.venv/bin/activate
python3 fetch.py && python3 scrape_serebii.py && python3 normalize.py && python3 fetch_art.py && python3 normalize_as_boosts.py
```

`scrape_serebii.py` fetches Serebii move text into `move_descriptions.json` (run after `fetch.py`, before `normalize.py`). `normalize.py` writes `src/data/patch-*.json`; sync to `public/data/` manually (or via the Refresh game data CI workflow) so the runtime fetch path matches. Edit `curated_builds.json` (`_emblemNameRemap`, per-Pokémon `builds`/`creativeBuilds`/`recommendedTitles`) before re-running — never hand-edit curated labels in the bundle.

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

Semantic color and surface tokens are defined in `src/index.css` using Tailwind v4 `@theme` blocks; light and dark themes override CSS variables under `[data-theme="dark"]`. Components should use generated utilities (`bg-surface`, `text-ink`, `border-line`, etc.) rather than raw palette classes for chrome.

Branding constants and rename guidance: `src/ui/brand.ts`, `docs/08-branding.md`. Theme rationale and token plan: `docs/06-theme-plan.md`.

Stat role colors (positive/negative, recommend/attack-speed/analytics tone cards) are intentional literals layered on top of semantic surfaces.
