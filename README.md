# FoxForge GG

**Forge your UNITE loadout!** A build optimizer for Pokémon UNITE that helps
players design optimized builds — recommending Emblem loadouts and Held Items
tailored to a selected Pokémon, with real-time stat calculation and
level-scaling visualization.

## Install & Run

Two ways to use the tool — pick whichever suits you.

### 1. Use it in your browser (no install)

Open the hosted web app: **<https://aerokita.github.io/FoxForge-GG/>**

It's a PWA, so you can "Install" it from the browser for an app-like, offline-capable
window. It updates automatically on reload.

### 2. Run from source

Requires **[Node.js](https://nodejs.org) 24+** (matches CI). Clone, install, and start the dev server:

```bash
git clone https://github.com/AeroKita/FoxForge-GG.git
cd FoxForge-GG
npm install
npm run dev        # open the printed URL (default http://localhost:5173)
```

### Cutting a new release

The hosted app redeploys automatically: every push to `main` triggers
[`pages.yml`](.github/workflows/pages.yml), which builds `dist/` and publishes it to
GitHub Pages. There is no separate release step — bump `"version"` in `package.json`
when you want the displayed version to change, then push.

## Data & attribution

Game stats are sourced from [UNITE-DB](https://unite-db.com); move descriptions from [Serebii](https://serebii.net). Pokémon UNITE and all related data © Nintendo / The Pokémon Company / TiMi Studio Group. This is a non-commercial fan project.

Licensed under [AGPL-3.0-only](LICENSE).

## Documentation

- [Project Brief](docs/01-project-brief.md) — what we're building and why
- [Architecture](docs/02-architecture.md) — tech stack and structure
- [Calculation Engine](docs/03-Calculation-Engine.md) — the stat/damage math
- [Data Sourcing](docs/04-data-sourcing.md) — where game data comes from and how to update it
- [Implementation Plan](docs/05-implementation-plan.md) — milestones and datamining pipeline
- [Theme Plan](docs/06-theme-plan.md) — semantic tokens and the light/dark theming approach
- [Distribution & Updates](docs/07-distribution.md) — Pages web app, PWA install, game-data auto-update
- [Branding](docs/08-branding.md) — how to rename the app + regenerate icons
- [Data Sourcing Research](docs/09-data-sourcing-research.md) — upstream source landscape (UNITE-DB vs uniteapi, APK pipeline)

## Layout

**Engine (pure, tested)**
- [`src/types.ts`](src/types.ts) — core data model
- [`src/engine/formulas.ts`](src/engine/formulas.ts) — stat stacking, mitigation, RSB damage, eHP
- [`src/engine/emblems.ts`](src/engine/emblems.ts) — emblem loadout aggregation (flats + set bonuses)
- [`src/engine/attackSpeed.ts`](src/engine/attackSpeed.ts) — AS-points → frame-breakpoint → attacks/sec
- [`src/engine/effects.ts`](src/engine/effects.ts) — toggleable active boosts (X-Atk, RFS proc, moves)
- [`src/engine/derive.ts`](src/engine/derive.ts) — Loadout → effective stats + attack speed (one path)

**Data (versioned, update-able)**
- [`src/data/patch-current.json`](src/data/patch-current.json) — full game bundle (94 Pokémon,
  41 held items, 10 battle items, 258 emblems), community-sourced from UNITE-DB
- [`src/data/attackSpeedBoosts.json`](src/data/attackSpeedBoosts.json) — AS boost catalog
  (10 global items + 61 per-Pokémon move buffs with level gating)
- [`src/data/loadBundle.ts`](src/data/loadBundle.ts) — zod-validated bundle loading
- `public/assets/` — mirrored art (497 images: portraits, thumbnails, item & emblem icons)

**App (React)**
- [`src/state/`](src/state) — `loadout.ts` (model + localStorage, 20-loadout cap), `heldItemGrades.ts` (global per-item grades), `store.tsx` (reducer/context)
- [`src/components/`](src/components) — PokemonPicker, LoadoutEditor, StatPanel, LoadoutBar, CompareView, HeldItemsInventory, PickerModal

**Tooling**
- `tools/community/` — UNITE-DB scraper + normalizers (`fetch.py`, `normalize.py`, `fetch_art.py`,
  `normalize_as_boosts.py` — dissects `docs/Attack Speed Calculator.xlsx`)
- `tools/extract/` — first-party APK pipeline (**blocked**: rotated bundle encryption,
  see [ENCRYPTION-FINDINGS.md](tools/extract/ENCRYPTION-FINDINGS.md))

## Commands

```bash
npm run dev                     # vite dev server — the app
npm run build                   # production static site → dist/ (portable: base "./")
npm run build:pages             # static build with the GitHub Pages base path
npm run preview                 # serve the built dist/ locally
npm test                        # engine + bundle + attack-speed + share tests (vitest, 90)
npm run validate                # known-values gate from docs/03-Calculation-Engine.md
npx tsx src/data/verifyPatch.ts # validate the live UNITE-DB bundle end-to-end
npm run typecheck               # tsc --noEmit
```

## Deploying

`npm run build` emits a self-contained static site in `dist/` (≈258 KB gzipped JS + the
art). Because `vite.config.ts` sets `base: "./"` and images resolve through
[`src/ui/asset.ts`](src/ui/asset.ts), the same build works at a domain root, a sub-path
(GitHub Pages project site), or via `npm run preview` — just drop `dist/` on any static host.

## Updating game data

Everything numeric lives in versioned JSON, refreshed by scripts (never hand-edited):

```bash
cd tools/community && source ../extract/.venv/bin/activate
python3 fetch.py                # re-scrape UNITE-DB (pokemon/items/emblems/stats)
python3 normalize.py            # → src/data/patch-<patch>.json (zod-validated)
python3 fetch_art.py            # refresh public/assets/ icons & portraits
python3 normalize_as_boosts.py  # → src/data/attackSpeedBoosts.json from the xlsx
```

To add an active combat effect (e.g. a new item's in-combat buff), extend the catalog
in `attackSpeedBoosts.json` or the resolver in `src/engine/effects.ts` — the UI toggles
and recompute pick it up automatically.

## Status

- [x] Milestone 1 — calculation engine + tests (all validation targets pass)
- [x] Milestone 2 — game data + art (community-sourced from UNITE-DB; APK datamining
  blocked by rotated encryption, pipeline preserved in `tools/extract/`)
- [x] Milestone 3 — core UI: Pokémon picker, loadout editor (3 held + trainer item + 10
  emblems), live StatPanel, attack-speed calculator, active/inactive effect toggles
  (incl. X-Attack +20% Atk/SpAtk & +25% AS), loadout saver (20, localStorage), two-build comparison
- [x] Milestone 4 — level-scaling graph ([`LevelGraph.tsx`](src/components/LevelGraph.tsx),
  Recharts, any stat or attacks/sec across Lv 1–15 with current-level marker)
- [x] Milestone 5 — Builds panel ([`recommend.ts`](src/engine/recommend.ts) +
  [`RecommendPanel.tsx`](src/components/RecommendPanel.tsx)): three tabs — **Recommended**
  (each Pokémon's curated UNITE-DB builds: held/trainer items, the **exact 10-emblem set** with
  grades + resulting set bonuses, and the build's two final moves), **Creative** (data-driven,
  empty until creative builds are supplied), and **Your Emblems** (the best 10-emblem set solved
  from your owned inventory — [respects per-stat floors + attack-type "unneeded" stats](src/engine/recommend.ts));
  each with one-click Apply
- [x] **Interactive Moves card** ([`MovesCard.tsx`](src/components/MovesCard.tsx)): choose one
  upgrade per move (Move 1 / Move 2), with icons + hover tooltips for every move and the passive;
  the picks save with the build, and applying a Recommended build sets them
- [x] **Beginner / Expert modes** ([App.tsx](src/App.tsx)): Beginner shows the recommended build +
  clean rounded stats; Expert adds attack-speed detail, analytics, active-effect toggles, the level
  graph, Compare, and decimal precision. Every section is a **collapsible card**
  ([`CollapsibleCard.tsx`](src/components/CollapsibleCard.tsx), persisted open state).
- [x] **Emblem Inventory Manager** ([`InventoryManager.tsx`](src/components/InventoryManager.tsx)):
  bulk-mark owned emblems per grade (Bronze/Silver/Gold tabs, color filter, search, "Own all shown",
  live counts) — feeds the per-grade owned store.
- [x] **Held Items inventory** ([`HeldItemsInventory.tsx`](src/components/HeldItemsInventory.tsx)):
  dedicated page to set each held item's grade (1–40) globally; grades sync with the Builder's
  held-item sliders and apply everywhere that item is equipped. Detail modal shows flat stats at
  the current grade plus grade 1/10/20 effect tiers ([`heldItemDetail.tsx`](src/ui/heldItemDetail.tsx)).
- [x] **Held-item data** — bundle carries full `statsByGrade` tables (grades 1–40) and optional
  `effect` tiers (label + three values at item levels 1, 10, 20) from UNITE-DB via `normalize.py`.
- [x] Quality-of-life — combat analytics (physical/special eHP + relative basic-attack output),
  **shareable build links** (`#b=` URL hash), auto-persisted current build, **per-grade owned-emblem
  inventory** (Bronze/Silver/Gold favorited independently via the picker's grade toggle; "owned only"
  filter; recommendations prefer owned), Bronze/Silver/Gold swappable per equipped emblem,
  **emblem-set summary** ([`EmblemSetSummary.tsx`](src/components/EmblemSetSummary.tsx): net flat
  stats color-coded + per-color counts & active set bonus), **styled hover tooltips**
  ([`Tooltip.tsx`](src/components/Tooltip.tsx)) on emblems/held/trainer items, Clear button, portable static build
- [x] **Themes** — light + dark (neon "Neo"-derived palette), toggleable in the header and
  persisted; all surfaces read from semantic Tailwind tokens ([`src/index.css`](src/index.css)).
- [x] **Distribution** ([docs/07-distribution.md](docs/07-distribution.md)) — hosted web app +
  installable PWA on [GitHub Pages](https://aerokita.github.io/FoxForge-GG/)
  ([`pages.yml`](.github/workflows/pages.yml)); the service worker auto-updates the app on
  reload. Game-data updates are fetched at runtime from Pages
  ([`SettingsMenu.tsx`](src/components/SettingsMenu.tsx)), so a patch needs no app rebuild.

### Deliberately not built
- **Nintendo / Pokémon UNITE account login** to read owned emblems — there is no official public
  OAuth for third parties; the only route would be handling the user's Nintendo credentials, a
  security/ToS line not worth crossing. The local owned-emblem inventory delivers the same UX safely.

### Open refinements
- Per-move AS level-availability is best-effort; emblem-set quick presets; code-splitting the 1 MB bundle
