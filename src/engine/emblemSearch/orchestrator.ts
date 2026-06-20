/**
 * Search orchestrator: coordinates the recipe solver, exact enumeration,
 * and heuristic passes, returning the best result found.
 *
 * Scope (v1): heuristic + recipe solver (target mode) + exact color
 * enumeration (for small color-constrained pools). MITM/IndexedDB target
 * search is deferred to v2.
 */

import type { EmblemSetBonus, EmblemSlot } from "../../types";
import type { EmblemCandidate, SearchOptions, SearchProgress, SearchResult } from "./types";
import { evaluateLoadout, SCORE_EPS, type EvalResult } from "./evaluate";
import { searchByRecipes } from "./recipeSearch";
import { searchColorExact, EXACT_PARALLEL_MIN } from "./exactColor";
import { searchColorExactParallel } from "./exactParallel";
import { runHeuristic } from "./heuristic";
import { runHeuristicParallel } from "./heuristicParallel";
import { candidatesToEmblemSlots } from "./pokemonScore";
import { countExactEnumerationSpace, formatBuildCount } from "./pool";

export const DEFAULT_EXACT_CAP = 1_000_000_000;

/**
 * Single source of truth for the exact-vs-heuristic gate.
 *
 * Returns true when the orchestrator should run exact color enumeration:
 *  • constrainedCount must be non-null, non-zero (feasible and DP-countable)
 *  • constrainedCount ≤ exactCap (within the user's permutation budget)
 *
 * No pool-size limit. The k-vector enumeration in searchColorExact operates
 * on the color-constrained space (bounded by exactCap), not raw C(n,10), so
 * it is tractable on the full 258-emblem dataset whenever the constrained
 * count is within the cap.
 *
 * Exported so the UI indicator and tests share this definition exactly,
 * preventing silent drift between the indicator and real search behavior.
 */
export function shouldRunExact(constrainedCount: bigint | null, exactCap: number): boolean {
  if (constrainedCount === null || constrainedCount === 0n) return false;
  return constrainedCount <= BigInt(exactCap);
}

export interface OrchestratorInput {
  pool: EmblemCandidate[];
  options: SearchOptions;
  setBonuses: EmblemSetBonus[];
  effort: "quick" | "normal" | "thorough";
  onProgress?: (p: SearchProgress) => void;
}

/** Convert candidates → EmblemSlot[] using the real emblem data from the store. */
function toEmblemSlots(candidates: EmblemCandidate[]): EmblemSlot[] {
  return candidatesToEmblemSlots(candidates, []);
}

export async function runSearch(
  input: OrchestratorInput,
  shouldAbort?: () => boolean,
): Promise<SearchResult | null> {
  const { pool, options, setBonuses, effort } = input;
  const slots = options.slots;
  const t0 = Date.now();
  let candidates = 0;
  let totalCandidates: number | undefined;
  let bestLoadout: EmblemCandidate[] | null = null;
  let bestEv: EvalResult | null = null;
  let phase = "none";

  const report = (pct: number, label: string) => {
    input.onProgress?.({ pct, label, candidates, totalCandidates });
  };

  function updateBest(loadout: EmblemCandidate[], ev: EvalResult, newPhase: string) {
    if (
      !bestEv ||
      !bestEv.valid ||
      (ev.valid &&
        (options.mode === "target"
          ? (ev.error ?? Infinity) < (bestEv.error ?? Infinity) - SCORE_EPS
          : ev.score > bestEv.score + SCORE_EPS))
    ) {
      bestLoadout = loadout;
      bestEv = ev;
      phase = newPhase;
    }
  }

  // ---- Phase 1: Recipe solver (target mode only) ----
  if (options.mode === "target" && Object.values(options.targetActive).some(Boolean)) {
    report(2, "Target · recipe signature solver…");
    const recipe = searchByRecipes(pool, options, slots, shouldAbort);
    if (recipe) {
      candidates += 1;
      const ev = evaluateLoadout(recipe.loadout, options, setBonuses);
      updateBest(recipe.loadout, ev, "recipe");
      if ((recipe.error ?? Infinity) <= SCORE_EPS) {
        report(100, "Done — exact recipe match");
        return buildResult(bestLoadout!, bestEv!, candidates, t0, phase);
      }
    }
    if (shouldAbort?.()) return null;
  }

  // ---- Phase 2: Exact color enumeration (cap-gated, build-count aware) ----
  //
  // Runs when color constraints are active and the number of color-feasible
  // builds is ≤ exactCap (default 1B). The enumeration uses the k-vector
  // architecture (group Pokémon by color signature, enumerate valid per-group
  // pick-count vectors, then iterate within-group combinations) — bounded by
  // the constrained count, not by pool size. Runs on the full 258-emblem
  // dataset whenever the constrained count is within the cap.
  //
  // Fall-through cases:
  //  • constrainedCount === null: DP state space was too large → heuristic.
  //  • constrainedCount === 0n: infeasible targets → heuristic.
  //  • constrainedCount > exactCap: above budget → heuristic.
  const hasColorConstraints = options.colorConstraints && options.colorConstraints.size > 0;
  const capValue = options.exactCap ?? DEFAULT_EXACT_CAP;

  let constrainedCount: bigint | null = null;
  let willRunExact = false;

  if (hasColorConstraints) {
    const enumerateGrades = options.enumerateGradeVariants ?? false;
    constrainedCount = countExactEnumerationSpace(
      pool,
      options.colorConstraints!,
      slots,
      enumerateGrades,
    );
    willRunExact = shouldRunExact(constrainedCount, capValue);
  }

  if (willRunExact) {
    const countLabel = formatBuildCount(constrainedCount!);
    const totalCombos = Number(constrainedCount!);
    totalCandidates = totalCombos;
    report(5, `Exact · enumerating ${countLabel} color-valid builds…`);

    // Try parallel when the space is large enough to amortize worker overhead.
    // Falls back automatically to single-threaded on failure / unavailability.
    //
    // Progress mapping: pass pct through directly (0–100 range) so the bar
    // fills the full width during exact search. Previously the mapping was
    // `5 + pct * 0.5` which capped at ~55% and reserved 55–100% for a
    // heuristic phase that no longer runs after a completed exact search.
    let result = null;
    if (totalCombos >= EXACT_PARALLEL_MIN) {
      try {
        result = await searchColorExactParallel(
          pool,
          options,
          setBonuses,
          totalCombos,
          async (pct, label, ev) => {
            candidates = ev;
            report(pct, label);
          },
          shouldAbort,
        );
      } catch {
        result = null; // fall through to single-threaded
      }
    }

    if (!result) {
      result = await searchColorExact(
        pool,
        options,
        setBonuses,
        async (pct, label, ev) => {
          candidates = ev;
          report(pct, label);
        },
        shouldAbort,
      );
    }

    if (result && result.ev.valid) {
      // Exact is exhaustive — it is the guaranteed optimum over the color-
      // constrained space. Return immediately; no heuristic chaser needed.
      // Mirrors uniteemblemfinder's exact path which returns at this point.
      candidates = result.evaluated;
      updateBest(result.loadout, result.ev, "exact");
      report(
        100,
        `Done — exact · ${candidates.toLocaleString()} builds · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      return buildResult(bestLoadout!, bestEv!, candidates, t0, phase);
    } else if (result) {
      // result non-null but somehow invalid — count the work and fall through
      candidates = result.evaluated;
    }
    if (shouldAbort?.()) return buildResult(bestLoadout, bestEv, candidates, t0, phase);
  }

  // ---- Phase 3: Heuristic search ----
  // Runs when exact was gated off (no color constraints / count null/0 / above
  // cap) OR when exact returned null (shouldn't happen normally).
  totalCandidates = undefined;
  const heuristicLo = willRunExact ? 55 : 5;
  report(heuristicLo, "Smart search…");

  const heuristicProgress = async (pct: number, label: string, cands: number) => {
    candidates = cands;
    // Map the heuristic's 0–100 onto the remaining bar (heuristicLo→100) so a
    // heuristic pct of 100 fills the bar completely while still "running",
    // rather than stalling at 95 until the post-loop Done report (which races
    // with the overlay closing).
    report(heuristicLo + (pct / 100) * (100 - heuristicLo), label);
  };

  // Prefer parallel restarts (one full heuristic per shard worker, merge best).
  // Falls back to single-threaded when workers are unavailable / it bails.
  let hResult = await runHeuristicParallel(
    pool,
    options,
    setBonuses,
    effort,
    heuristicProgress,
    shouldAbort,
  );
  if (!hResult) {
    hResult = await runHeuristic(pool, options, setBonuses, effort, heuristicProgress, shouldAbort);
  }

  if (hResult.loadout.length === slots) {
    candidates = hResult.candidates;
    updateBest(hResult.loadout, hResult.ev, "heuristic");
  }

  if (shouldAbort?.()) return buildResult(bestLoadout, bestEv, candidates, t0, phase);

  report(
    100,
    `Done · ${candidates.toLocaleString()} candidates · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  return buildResult(bestLoadout, bestEv, candidates, t0, phase);
}

function buildResult(
  loadout: EmblemCandidate[] | null,
  ev: EvalResult | null,
  candidates: number,
  t0: number,
  phase: string,
): SearchResult | null {
  if (!loadout || !ev?.valid) return null;
  return {
    picks: toEmblemSlots(loadout),
    score: ev.score,
    error: ev.error,
    candidates,
    totalMs: Date.now() - t0,
    phase,
    exact: phase === "exact" || phase === "recipe",
  };
}
