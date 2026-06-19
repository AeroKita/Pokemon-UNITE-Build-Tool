# Held-Item Recommendation Improvement — Plan for Review

> Status: Draft for review by a stronger model. Self-contained — all context needed to
> critique the plan is inline. Repo: `FoxForge-GG` (Pokémon UNITE build optimizer,
> React + TS + Vite). Author: optimizer agent. Date: 2026-06-18.

## 1. Goal

Improve the held-item suggestions produced by the **emblem build optimizer** so the three
recommended held items "actually make sense in multiple different ways" for the selected
Pokémon. Many held items derive most of their value from **conditional effects** (procs,
stacking, on-Unite, sustain) rather than flat stats, and the current recommender largely
ignores those effects. We want recommendations that respect a Pokémon's kit and item
mechanics — without necessarily building a full combat simulator.

This is a recommendation-quality problem, not a UI problem. (The result card that displays
the items was recently reworked separately.)

## 2. Where this lives in the code

- `src/engine/recommend.ts` — rule-based core. `priorityWeights()`, `scoreHeldItem()`,
  `coreItemsFor()`, `recommendBuild()`.
- `src/engine/emblemSearch/heldItemSynergy.ts` — `recommendItemsForEmblemBuild()`. Called by
  the optimizer result panel; emblem-build-aware wrapper around `scoreHeldItem()`.
- `src/engine/emblemSearch/basicObjective.ts` — `rankOwnedHeldItems()` (Basic mode item ranking).
- `src/data/recommendationProfiles.json` — curated "core" item id pools per archetype
  (`physicalCore`, `specialCore`, `bulkCore`, `supportCore`).
- `src/data/patch-current.json` — game data bundle (Pokémon, emblems, held items, curated builds).
- `tools/community/normalize.py` — data pipeline that builds the bundle.
- `tools/community/curated_builds.json` — hand-curated per-Pokémon overrides merged by the pipeline.
- `src/components/EmblemOptimizer.tsx` — consumes `recommendItemsForEmblemBuild()` for display.
- `src/components/RecommendPanel.tsx` — Build page; already shows curated community builds.

## 3. How recommendation works today

`recommendItemsForEmblemBuild()`:
1. Computes which stats the chosen emblem set boosts via color set bonuses.
2. Reduces priority weights for those already-covered stats (so items "fill gaps"),
   floored at 0.3x.
3. Scores every eligible item with `scoreHeldItem()` at a hardcoded grade 30 and takes top 3.

`scoreHeldItem()` (the heart of it):

```ts
export function scoreHeldItem(item, weights, coreIds?, grade = 30): number {
  const stats = item.statsByGrade[grade] ?? {};
  let score = 0;
  for (const [stat, value] of Object.entries(stats)) {
    const weight = weights[stat] ?? 0;
    if (weight && value) score += weight * (value / SCALE[stat]);   // flat-stat alignment
  }
  const offensive = (weights.attack ?? 0) + (weights.spAttack ?? 0) > 0;
  if (offensive && item.conditionalEffects.some(e => e.stacking || e.type === "onBasicAttack"))
    score += 0.5;                                                    // (effectively dead — see below)
  if (coreIds?.has(item.id)) score += META_BONUS;                    // +2 for archetype core items
  return score;
}
```

Inputs actually used: **flat stats at grade 30**, **role/attack-type weights**
(`priorityWeights`), and a **+2 archetype-core bonus** from `recommendationProfiles.json`.

## 4. Why complex items get mis-ranked

1. **Conditional effects are not in the data.** `tools/community/normalize.py` writes
   `"conditionalEffects": []` for every item (verified: all 41 items have empty arrays).
   The structured effect data lives only in `description` (prose) and an optional `effect`
   field (`{ label, tiers: [g1, g10, g20] }`). So the `conditionalEffects` branch in
   `scoreHeldItem()` is **dead code** — it never fires. `computeEffectiveStats()` similarly
   only models Attack Weight stacking (on-score) and Float Stone OOC move speed; nothing else.

2. **Flats poorly proxy real value.** Examples:
   - Energy Amplifier: ~tiny CDR flats, but its value is +7/14/21% damage after Unite Move
     (core on several supports/mages, e.g. Blissey "Soft Bomb" community build).
   - Accel Bracer: small atk+CDR flats; real value is assist/KO stacking attack.
   - Muscle Band: scored on atk + atk-speed flats; real value is % remaining-HP on basics.
   - Attack Weight: atk flats; real value is +atk per goal scored (stacking carry item).

3. **Items are picked independently, not as a set.** Top-3-by-score can return three crit
   items or three pure-atk items with no utility/sustain, ignoring diminishing returns and
   cross-item synergy windows.

4. **Per-Pokémon community item knowledge is unused.** `pokemon.builds[].heldItemIds`
   (curated UNITE-DB triplets) is already shown on the Build page and used for emblem color
   targets (`colorTargetsFor` reads a 10-emblem community build), but held-item recommendation
   ignores it entirely.

5. **Kit is ignored.** No use of moves, move tags, passive ability, or basic-attack vs
   ability-vs-Unite playstyle. `unneededStats()` (attack-type exclusions) is applied to emblems
   but not to held items.

6. **Grade hardcoded to 30** rather than the user's actual held-item grades.

## 5. Options considered

### Tier 1 — quick wins (no engine rewrite)
- **A. Community-build item voting.** Aggregate `heldItemIds` frequency across `pokemon.builds`
  (+ optional curated overrides); add a frequency bonus, optionally amplified when the emblem
  result resembles that build's color shell. Mirrors the existing emblem `colorTargetsFor`
  pattern. Highest ROI; limited where build data is thin/absent.
- **B. Per-Pokémon core item overrides** in `curated_builds.json` (e.g. `heldItemCore`).
  Fixes known outliers; manual per patch.
- **C. Effect-tag scoring from existing `effect`/`description`.** Map keywords → tags
  (`onUniteMove`, `onBasicAttack`, `stacking`, `assist`, `sustain`, `shield`, `score`) and
  Pokémon kit tags (role + move tags + passive), then score tag matches (replacing the dead
  `conditionalEffects` branch).
- **D. Pick triplets, not 3 singles.** Score top ~12–15, then choose the best 3-set with
  redundancy penalties (duplicate crit/atk-speed) and small pairwise synergy bonuses.
- **E. Use the user's real held-item grades** instead of hardcoded 30.

### Tier 2 — structural
- **F. Populate `conditionalEffects` in the pipeline** (`normalize.py`) from UNITE-DB fields,
  then score them and (eventually) apply in `computeEffectiveStats()`.
- **G. Pokémon kit-profile data file** (playstyle flags), semi-auto from RSB ratios + tags,
  hand-tuned for edge cases.
- **H. Effective-stat triplet search** using `computePokemonScore()` against the found emblem
  build (captures emblem–item stat synergy; still misses proc effects).

### Tier 3 — full accuracy (long-term)
- **I. Damage-model item valuation** (move RSB + proc rules → DPS/sustain contribution).
- **J. Unite-move interaction table** for items like Energy Amplifier with per-Unite exceptions.

## 6. Proposed approach (the plan to critique)

Combine Tier 1 items A + C + D, plus B for known-complex kits, to get "makes sense in multiple
ways" without a combat simulator:

1. **Community item voting (A)** — per-Pokémon frequency signal from curated builds.
2. **Effect-tag scoring (C)** — unlock the `effect`/`description` data we already ship; match
   item effect tags to Pokémon kit tags.
3. **Triplet selection (D)** — redundancy penalty + light synergy bonuses so the final 3 are
   complementary.
4. **Per-Pokémon overrides (B)** in `curated_builds.json` for complex kits (supports with Energy
   Amp, stacking carries with Accel Bracer/Attack Weight).

Long-term, F (populate `conditionalEffects`) is the right foundation for items whose value is
not in flats at all, but it's not required for a meaningful near-term improvement.

## 7. Known gaps / constraints

- Unique held items (Mega Stones, Rusted Sword) are filtered out — `statsByGrade` is empty.
- `unneededStats()` is not applied to held-item scoring (hybrid / `excludeStats` Pokémon).
- `heldItemOptional` from community builds is ignored.
- No tests assert item recs match community builds for real Pokémon (only synthetic stat items
  in `src/engine/emblemSearch/__tests__/pokemonScoring.test.ts`).
- `AGENTS.md` marks `src/engine/`, `tools/`, and parts of `src/state/` as "frozen unless a task
  explicitly requires" changes — so engine/pipeline edits need to be deliberate and well-tested.
- Data is patch-generated; any per-Pokémon curation must live in `curated_builds.json`
  (merged by `normalize.py`), never hand-edited into the bundle.

## 8. Questions for the reviewer

1. Is the **community-voting + effect-tag + triplet** combination the right near-term bet, or is
   it worth investing directly in **F (populate `conditionalEffects`)** as the foundation first?
2. For effect tags (C), is **keyword mapping from prose** acceptable, or should effect tags be a
   curated data field to avoid brittle parsing?
3. How should we **weight community votes vs computed score**? Hard override, additive bonus, or
   tie-breaker only? Concern: over-fitting to possibly-stale community builds vs. the engine's
   stat reasoning.
4. Triplet selection (D): explicit redundancy/synergy rules (hand-tuned) vs. evaluating triplets
   through `computeEffectiveStats()` / `computePokemonScore()` (H)?
5. Scope: should this also fix Basic mode (`rankOwnedHeldItems`) and the Build-page "Your Emblems"
   item suggestion, or only the optimizer result panel?
6. Coverage fallback: what should recommendations do for Pokémon with **no/thin community builds**?
7. Is touching `tools/community/normalize.py` (F) in-scope given the "frozen pipeline" guidance,
   or should effect data come from a separate overlay file?
