/**
 * Emblem → EmblemCandidate adapter.
 *
 * Provenance: clean-room TypeScript port of pool-building concepts from
 * uniteemblemfinder.github.io, adapted for FoxForge-GG's type system.
 */

import type { Emblem, EmblemGrade } from "../../types";
import type { EmblemCandidate } from "./types";

export const GRADE_ORDER: EmblemGrade[] = ["gold", "silver", "bronze"];

/** Resolve a grade key for statsByGrade lookup (platinum reuses gold values). */
export function resolveGradeKey(grade: EmblemGrade): "bronze" | "silver" | "gold" {
  return grade === "platinum" ? "gold" : grade;
}

/** Convert one Emblem at a specific grade to a flat EmblemCandidate. */
export function emblemToCandidate(emblem: Emblem, grade: EmblemGrade): EmblemCandidate {
  const key = resolveGradeKey(grade);
  return {
    id: emblem.id,
    pokemonName: emblem.pokemonName,
    grade,
    colors: [...emblem.colors],
    stats: { ...emblem.statsByGrade[key] },
  };
}

/**
 * Build the full candidate pool.
 *
 * - If ownedKeys is provided: include owned emblems.
 *   - Optional `grades`: restrict to owned keys at these grades only (Basic owned mode).
 *   - mixedGrades=true (default): include all matching owned grade variants per Pokémon
 *     so the search can mix grades across the 10 slots.
 *   - mixedGrades=false: include only the best-owned grade per Pokémon (among allowed grades).
 * - Otherwise: include all emblems at the specified grades.
 *
 * goldOnly emblems are excluded from silver/bronze grade levels.
 */
export function buildCandidatePool(
  emblems: Emblem[],
  opts: {
    grades?: EmblemGrade[];
    ownedKeys?: Set<string>;
    /** Only relevant when ownedKeys is set. Default: true. */
    mixedGrades?: boolean;
  } = {},
): EmblemCandidate[] {
  const candidates: EmblemCandidate[] = [];

  if (opts.ownedKeys) {
    const mixed = opts.mixedGrades ?? true;
    const gradeFilter = opts.grades ? new Set(opts.grades) : null;
    for (const emblem of emblems) {
      if (mixed) {
        // Include all owned grades for this emblem (highest stat wins during search)
        for (const g of GRADE_ORDER) {
          if (gradeFilter && !gradeFilter.has(g)) continue;
          if (!opts.ownedKeys.has(`${emblem.id}:${g}`)) continue;
          if ((g === "bronze" || g === "silver") && emblem.goldOnly) continue;
          candidates.push(emblemToCandidate(emblem, g));
        }
      } else {
        // Only the best-owned grade among allowed grades
        const bestGrade = GRADE_ORDER.find(
          (g) => (!gradeFilter || gradeFilter.has(g)) && opts.ownedKeys!.has(`${emblem.id}:${g}`),
        );
        if (!bestGrade) continue;
        candidates.push(emblemToCandidate(emblem, bestGrade));
      }
    }
    return candidates;
  }

  const grades = opts.grades ?? (["gold"] as EmblemGrade[]);
  const gradeSet = new Set(grades);
  const mixed = opts.mixedGrades ?? true;
  for (const emblem of emblems) {
    if (mixed) {
      for (const grade of grades) {
        if ((grade === "bronze" || grade === "silver") && emblem.goldOnly) continue;
        candidates.push(emblemToCandidate(emblem, grade));
      }
    } else {
      const bestGrade = GRADE_ORDER.find((g) => gradeSet.has(g));
      if (!bestGrade) continue;
      if ((bestGrade === "bronze" || bestGrade === "silver") && emblem.goldOnly) continue;
      candidates.push(emblemToCandidate(emblem, bestGrade));
    }
  }
  return candidates;
}

/** The number of distinct Pokémon names in a candidate pool. */
export function distinctPokemonCount(pool: EmblemCandidate[]): number {
  return new Set(pool.map((c) => c.pokemonName)).size;
}

/**
 * Group pool candidates by pokemonName.
 * Returns an array of groups sorted by name (lexicographic).
 * Each group has all grade variants for that Pokémon in the pool.
 */
export function groupByPokemon(
  pool: EmblemCandidate[],
): { name: string; variants: EmblemCandidate[] }[] {
  const map = new Map<string, EmblemCandidate[]>();
  for (const c of pool) {
    if (!map.has(c.pokemonName)) map.set(c.pokemonName, []);
    map.get(c.pokemonName)!.push(c);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, variants]) => ({ name, variants }));
}
