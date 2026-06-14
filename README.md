# Pokémon UNITE Build Optimizer

A personal tool that helps Pokémon UNITE players design optimized builds —
recommending Emblem loadouts and Held Items tailored to a selected Pokémon,
with real-time stat calculation and level-scaling visualization.

## Install & Run

There are two ways to use the tool. **No prebuilt installer is published yet**
(see [Get a one-click installer](#get-a-one-click-installer) below to create one).

### A. Run the web app from source (works on macOS / Windows / Linux)

1. Install **[Node.js](https://nodejs.org) 20 or newer** (includes `npm`).
2. Clone and enter the project:

```bash
git clone https://github.com/AeroKita/unite-build-optimizer.git
cd unite-build-optimizer
```

3. Install dependencies and start the app:

```bash
npm install
npm run dev
```

4. Open the URL it prints (default <http://localhost:5173>) in your browser.

To make an optimized static build instead, run `npm run build` and serve the
generated `dist/` folder with any static host (or `npm run preview`).

### B. Run the desktop app from source (optional — needs Rust)

```bash
curl https://sh.rustup.rs -sSf | sh   # one-time: install the Rust toolchain
npm install
npm run tauri dev                      # launches the native desktop window
```

To produce a native installer for **your current OS**, run `npm run tauri build`
— the `.dmg` / `.msi` / `.AppImage` lands in `src-tauri/target/release/bundle/`.

### Get a one-click installer

Cross-platform installers (Windows `.msi`/`.exe`, macOS `.dmg`, Linux
`.deb`/`.AppImage`) are built automatically by
[`release.yml`](.github/workflows/release.yml) when a version tag is pushed:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

CI then publishes them to this repo's **Releases** page. Two caveats:
- The release job needs the `TAURI_SIGNING_PRIVATE_KEY` repo secret set (for
  signed auto-updates) — see [docs/07-distribution.md](docs/07-distribution.md).
- This repo is **private**, so only people with repo access can download Release
  assets. To share with the public, make the repo public or host the web build
  on a static host.

## Documentation

- [Project Brief](docs/01-project-brief.md) — what we're building and why
- [Architecture](docs/02-architecture.md) — tech stack and structure
- [Calculation Engine](docs/03-calculation-engine.md) — the stat/damage math
- [Data Sourcing](docs/04-data-sourcing.md) — where game data comes from and how to update it
- [Implementation Plan](docs/05-implementation-plan.md) — milestones and datamining pipeline

## Layout

**Engine (pure, tested)**
- [`src/types.ts`](src/types.ts) — core data model
- [`src/engine/formulas.ts`](src/engine/formulas.ts) — stat stacking, mitigation, RSB damage, eHP
- [`src/engine/emblems.ts`](src/engine/emblems.ts) — emblem loadout aggregation (flats + set bonuses)
- [`src/engine/attackSpeed.ts`](src/engine/attackSpeed.ts) — AS-points → frame-breakpoint → attacks/sec
- [`src/engine/effects.ts`](src/engine/effects.ts) — toggleable active boosts (X-Atk, RFS proc, moves)
- [`src/engine/derive.ts`](src/engine/derive.ts) — Loadout → effective stats + attack speed (one path)

**Data (versioned, update-able)**
- [`src/data/patch-1.23.1.1.json`](src/data/patch-1.23.1.1.json) — full game bundle (94 Pokémon,
  41 held items, 10 battle items, 258 emblems), community-sourced from UNITE-DB
- [`src/data/attackSpeedBoosts.json`](src/data/attackSpeedBoosts.json) — AS boost catalog
  (10 global items + 61 per-Pokémon move buffs with level gating)
- [`src/data/loadBundle.ts`](src/data/loadBundle.ts) — zod-validated bundle loading
- `public/assets/` — mirrored art (497 images: portraits, thumbnails, item & emblem icons)

**App (React)**
- [`src/state/`](src/state) — `loadout.ts` (model + localStorage, 20-loadout cap) + `store.tsx` (reducer/context)
- [`src/components/`](src/components) — PokemonPicker, LoadoutEditor, StatPanel, LoadoutBar, CompareView, PickerModal

**Tooling**
- `tools/community/` — UNITE-DB scraper + normalizers (`fetch.py`, `normalize.py`, `fetch_art.py`,
  `normalize_as_boosts.py` — dissects `docs/Attack Speed Calculator.xlsx`)
- `tools/extract/` — first-party APK pipeline (**blocked**: rotated bundle encryption,
  see [ENCRYPTION-FINDINGS.md](tools/extract/ENCRYPTION-FINDINGS.md))

## Commands

```bash
npm run dev                     # vite dev server — the app
npm run build                   # production static site → dist/ (portable: base "./")
npm run preview                 # serve the built dist/ locally
npm test                        # engine + bundle + attack-speed + share tests (vitest, 58)
npm run validate                # known-values gate from docs/03-calculation-engine.md
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
- [x] Milestone 5 — recommendation engine ([`recommend.ts`](src/engine/recommend.ts) +
  [`RecommendPanel.tsx`](src/components/RecommendPanel.tsx)): surfaces each Pokémon's **curated
  UNITE-DB builds** (held/battle items + the **exact 10-emblem set** with grades + resulting set
  bonuses), **Reroll** to cycle a Pokémon's builds, and **Randomize** — a negative-minimizing emblem
  solver ([respects per-stat floors + attack-type "unneeded" stats](src/engine/recommend.ts)) for
  fresh sets and the few Pokémon without curated builds; one-click Apply
- [x] **Beginner / Expert modes** ([App.tsx](src/App.tsx)): Beginner shows the recommended build +
  clean rounded stats; Expert adds attack-speed detail, analytics, active-effect toggles, the level
  graph, Compare, and decimal precision. Every section is a **collapsible card**
  ([`CollapsibleCard.tsx`](src/components/CollapsibleCard.tsx), persisted open state).
- [x] **Emblem Inventory Manager** ([`InventoryManager.tsx`](src/components/InventoryManager.tsx)):
  bulk-mark owned emblems per grade (Bronze/Silver/Gold tabs, color filter, search, "Own all shown",
  live counts) — feeds the per-grade owned store.
- [x] Quality-of-life — combat analytics (physical/special eHP + relative basic-attack output),
  **shareable build links** (`#b=` URL hash), auto-persisted current build, **per-grade owned-emblem
  inventory** (Bronze/Silver/Gold favorited independently via the picker's grade toggle; "owned only"
  filter; recommendations prefer owned), Bronze/Silver/Gold swappable per equipped emblem,
  **emblem-set summary** ([`EmblemSetSummary.tsx`](src/components/EmblemSetSummary.tsx): net flat
  stats color-coded + per-color counts & active set bonus), **styled hover tooltips**
  ([`Tooltip.tsx`](src/components/Tooltip.tsx)) on emblems/held/trainer items, Clear button, portable static build

### Deliberately not built
- **Nintendo / Pokémon UNITE account login** to read owned emblems — there is no official public
  OAuth for third parties; the only route would be handling the user's Nintendo credentials, a
  security/ToS line not worth crossing. The local owned-emblem inventory delivers the same UX safely.

### Open refinements
- Dark mode (skipped to keep the light theme cohesive rather than ship a half-converted one)
- Per-move AS level-availability is best-effort; emblem-set quick presets; code-splitting the 1 MB bundle
