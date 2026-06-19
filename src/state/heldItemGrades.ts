// Per-item held item grade memory (1–40), persisted like emblem ownership.
// Grades set on the Held Items page or Builder sync here and apply everywhere.

import { ITEM_GRADE_DEFAULT } from "../data/gameData";
import type { Loadout } from "./loadout";

const STORAGE_KEY = "unite-build-optimizer.heldItemGrades.v1";

export interface GradeInputResult {
  digits: string;
  valid: boolean;
  value: number | null;
}

/** Parse a typed grade field: strips non-digits, validates 1–40. */
export function parseGradeInput(raw: string): GradeInputResult {
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return { digits, valid: false, value: null };
  const n = Number(digits);
  const valid = n >= 1 && n <= 40;
  return { digits: valid ? String(n) : digits, valid, value: valid ? n : null };
}

export function clampHeldGrade(grade: number): number {
  return Math.max(1, Math.min(40, Math.round(grade)));
}

export function loadHeldItemGradeMemory(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, number> = {};
    for (const [id, g] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof g === "number") out[id] = clampHeldGrade(g);
    }
    return out;
  } catch {
    return {};
  }
}

export function saveHeldItemGradeMemory(memory: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    /* quota */
  }
}

/** Grade for one held item id (default 40 when unset). */
export function gradeForHeldItem(memory: Record<string, number>, itemId: string | null): number {
  if (!itemId) return ITEM_GRADE_DEFAULT;
  const g = memory[itemId];
  return g !== undefined ? clampHeldGrade(g) : ITEM_GRADE_DEFAULT;
}

/** Resolve the three Builder slot grades from global per-item memory (default 40). */
export function resolveSlotGrades(
  loadout: Loadout,
  memory: Record<string, number>,
): [number, number, number] {
  const [a, b, c] = loadout.heldItemIds;
  return [gradeForHeldItem(memory, a), gradeForHeldItem(memory, b), gradeForHeldItem(memory, c)];
}
