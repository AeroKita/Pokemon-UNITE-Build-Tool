# Data Sourcing & Maintenance  
  
The data layer is the project's backbone and the part most likely to break on a  
patch. Treat it as first-class.  
  
## Current source (v1): UNITE-DB  
  
The shipping bundle `src/data/patch-1.23.1.1.json` is sourced from  
[UNITE-DB](https://unite-db.com) via `tools/community/` (`fetch.py` →  
`normalize.py`; art via `fetch_art.py`). This is the documented community  
fallback: first-party APK datamining is **blocked** because v1.23.1.1 encrypts  
its asset bundles with a rotated XOR key absent from any public tool (full  
analysis in `tools/extract/ENCRYPTION-FINDINGS.md`). The bundle's `dataSource`  
block records this provenance. If the APK keys are recovered later, the  
`tools/extract/` pipeline can replace UNITE-DB as the first-party source.  
  
Verified accurate against in-game targets (Lucario Lv15 = HP 7249 / Atk 429,  
Float Stone +28/+175, Muscle Band +17.5/+8.75%) by `src/data/verifyPatch.ts`.  
  
## Held items in the bundle  
  
Each held item carries:  
  
- **`statsByGrade`** — flat stat contributions for every grade 1–40 (in-game max is 40;  
  G40 is the build value). `normalize.py` emits the full table from UNITE-DB params  
  (linear scaling through G30, then half-increment steps for G31–G40).  
- **`effect`** (optional) — the item's conditional effect at item levels 1, 10, and 20:  
  `{ label, tiers: [string, string, string] }`. Shown in the Held Items detail UI;  
  not yet wired into the calculation engine.  
- **`conditionalEffects`** — structured combat toggles consumed by `src/engine/effects.ts`.  
  
Hand-curated Recommended/Creative builds and title overrides live in  
`tools/community/curated_builds.json` and are merged by `normalize.py` on top of the  
UNITE-DB-derived bundle, so they survive data refreshes while raw builds stay the base layer.

After `normalize.py`, run `npm run generate:presets` (or `npm run data:post-normalize` to chain both), then `npm test`, `npx tsx src/data/verifyPatch.ts`, and sync  
`public/data/` if the runtime fetch path should match.  
  
## Principles  
  
- **Everything patchable.** Every numeric value lives in a versioned data bundle,  
  never hardcoded in logic.  
- **Version each bundle** with `patchVersion` and `lastUpdated`.  
- **Validate on load** against the schema so a malformed bundle fails loudly.  
  
## Candidate Data Sources  
  
- **In-game screens** — the most authoritative source. Item and emblem values  
  shown in-game override third-party sites, which are frequently out of date.  
- **Community databases** (Unite-DB, UniteAPI.dev) — useful for structured stat  
  tables and emblem data; cross-check against in-game values.  
- **Mathcord community** — documented formulas and testing for mechanics that are  
  never officially published.  
  
> Note: third-party sources disagree and lag behind patches. When values  
> conflict, prefer current in-game readouts, then reconcile.  
  
## Recommended Workflow per Patch  
  
1. Pull the patch notes; identify changed stats/items/emblems/moves.  
2. Update the affected entries in a NEW bundle file (`patch-x.y.z.json`).  
3. Bump `patchVersion` / `lastUpdated`.  
4. Run the validation suite (schema + known-value checks from the calc-engine  
   doc).  
5. Spot-check a few builds against in-game numbers.  
  
## Update Checklist  
  
- [ ] Per-level base stats for any rebalanced Pokémon  
- [ ] Held-item flat stats and effects (verify in-game)  
- [ ] Emblem stats / colors / set-bonus thresholds  
- [ ] Move RSB values and effects  
- [ ] Damage/defense formula constants (rarely change, but check)  
