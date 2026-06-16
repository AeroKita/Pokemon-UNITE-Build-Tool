// Loadout model + localStorage persistence (up to 20 saved loadouts).
// A loadout fully describes a build: Pokémon, level, 3 held items, 1 trainer
// (battle) item, an emblem set, and which active effects are toggled on.

import type { EmblemGrade } from "../types";

export interface EmblemPick {
  emblemId: string;
  grade: EmblemGrade;
}

export interface Loadout {
  pokemonId: string | null;
  level: number; // 1-15
  heldItemIds: (string | null)[]; // exactly 3 slots
  battleItemId: string | null; // "Trainer Item"
  emblems: EmblemPick[]; // up to 10
  activeBoostIds: string[]; // toggled-on active effects (default: none)
}

export interface SavedLoadout extends Loadout {
  id: string;
  name: string;
  savedAt: number;
}

export const MAX_HELD_ITEMS = 3;
export const MAX_EMBLEMS = 10;
export const MAX_SAVED_LOADOUTS = 20;
const STORAGE_KEY = "unite-build-optimizer.loadouts.v1";
const CURRENT_KEY = "unite-build-optimizer.current.v1";
const OWNED_KEY = "unite-build-optimizer.ownedEmblems.v2"; // v2: keyed by emblemId:grade

export function emptyLoadout(pokemonId: string | null = null): Loadout {
  return {
    pokemonId,
    level: 15,
    heldItemIds: [null, null, null],
    battleItemId: null,
    emblems: [],
    activeBoostIds: [],
  };
}

export function loadSavedLoadouts(): SavedLoadout[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(list: SavedLoadout[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

/** Save a loadout (new or overwrite by id). Enforces the 20-loadout cap. */
export function saveLoadout(current: SavedLoadout[], loadout: Loadout, name: string, id?: string): SavedLoadout[] {
  const now = Date.now();
  if (id) {
    const next = current.map((l) => (l.id === id ? { ...loadout, id, name, savedAt: now } : l));
    persist(next);
    return next;
  }
  if (current.length >= MAX_SAVED_LOADOUTS) {
    throw new Error(`Loadout limit reached (${MAX_SAVED_LOADOUTS}). Delete one first.`);
  }
  const entry: SavedLoadout = { ...loadout, id: crypto.randomUUID(), name, savedAt: now };
  const next = [...current, entry];
  persist(next);
  return next;
}

export function deleteLoadout(current: SavedLoadout[], id: string): SavedLoadout[] {
  const next = current.filter((l) => l.id !== id);
  persist(next);
  return next;
}

/** Strip the saved-metadata fields back to a plain editable Loadout. */
export function toLoadout(saved: SavedLoadout): Loadout {
  const { id: _id, name: _name, savedAt: _savedAt, ...rest } = saved;
  void _id; void _name; void _savedAt;
  return structuredClone(rest);
}

// ----- Current (in-progress) build persistence ------------------------------

export function saveCurrent(loadout: Loadout): void {
  try { localStorage.setItem(CURRENT_KEY, JSON.stringify(loadout)); } catch { /* quota */ }
}
export function loadCurrent(): Loadout | null {
  try {
    const raw = localStorage.getItem(CURRENT_KEY);
    return raw ? (JSON.parse(raw) as Loadout) : null;
  } catch { return null; }
}

// ----- Shareable build links (base64 in the URL hash) -----------------------

export function encodeLoadout(loadout: Loadout): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(loadout))));
}
export function decodeLoadout(encoded: string): Loadout | null {
  try {
    const json = decodeURIComponent(escape(atob(encoded)));
    const l = JSON.parse(json);
    if (l && typeof l === "object" && Array.isArray(l.heldItemIds)) return l as Loadout;
    return null;
  } catch { return null; }
}

/** Read a shared build from the URL hash (#b=...), if present. */
export function loadoutFromUrl(): Loadout | null {
  const m = typeof location !== "undefined" && location.hash.match(/[#&]b=([^&]+)/);
  return m ? decodeLoadout(decodeURIComponent(m[1])) : null;
}

/** Build a shareable URL encoding the given loadout. */
export function shareUrlFor(loadout: Loadout): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#b=${encodeURIComponent(encodeLoadout(loadout))}`;
}

// ----- Shareable file export/import (.json) ---------------------------------
// A small versioned wrapper so exported builds stay readable if the loadout
// shape changes later. Import is lenient: it accepts a wrapped export or a bare
// Loadout, and sanitizes the shape (clamps level, 3 held slots, caps emblems).

const FILE_KIND = "foxforge.loadout";
const FILE_SCHEMA_VERSION = 1;

export interface LoadoutFile {
  app: string;
  kind: typeof FILE_KIND;
  schemaVersion: number;
  exportedAt: number;
  loadout: Loadout;
}

/** Serialize the current loadout into a shareable, versioned JSON string. */
export function loadoutToFileJSON(loadout: Loadout): string {
  const payload: LoadoutFile = {
    app: "FoxForge GG",
    kind: FILE_KIND,
    schemaVersion: FILE_SCHEMA_VERSION,
    exportedAt: Date.now(),
    loadout,
  };
  return JSON.stringify(payload, null, 2);
}

/** Coerce arbitrary parsed JSON into a valid Loadout, or null if unusable. */
export function sanitizeLoadout(x: unknown): Loadout | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.heldItemIds) || !Array.isArray(o.emblems)) return null;
  const held: (string | null)[] = [0, 1, 2].map((i) => {
    const v = (o.heldItemIds as unknown[])[i];
    return typeof v === "string" ? v : null;
  });
  const emblems: EmblemPick[] = (o.emblems as unknown[])
    .filter((e): e is EmblemPick => {
      const p = e as Record<string, unknown>;
      return !!p && typeof p.emblemId === "string" && typeof p.grade === "string";
    })
    .slice(0, MAX_EMBLEMS)
    .map((e) => ({ emblemId: e.emblemId, grade: e.grade }));
  return {
    pokemonId: typeof o.pokemonId === "string" ? o.pokemonId : null,
    level: typeof o.level === "number" ? Math.max(1, Math.min(15, Math.round(o.level))) : 15,
    heldItemIds: held,
    battleItemId: typeof o.battleItemId === "string" ? o.battleItemId : null,
    emblems,
    activeBoostIds: Array.isArray(o.activeBoostIds)
      ? (o.activeBoostIds as unknown[]).filter((b): b is string => typeof b === "string")
      : [],
  };
}

/** Parse an exported file (wrapped or bare) into a Loadout, or null. */
export function parseLoadoutFile(text: string): Loadout | null {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const inner = data && typeof data === "object" && "loadout" in data ? data.loadout : data;
    return sanitizeLoadout(inner);
  } catch {
    return null;
  }
}

/** A filesystem-safe download name, e.g. "foxforge-lucario.json". */
export function loadoutFileName(loadout: Loadout, pokemonName?: string): string {
  const slug = (pokemonName ?? loadout.pokemonId ?? "build")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `foxforge-${slug || "build"}.json`;
}

// ----- Owned-emblem inventory (local; no account) ---------------------------

/** Composite key for owning a specific grade of an emblem (independent grades). */
export function ownedKey(emblemId: string, grade: EmblemGrade): string {
  return `${emblemId}:${grade}`;
}

export function loadOwnedEmblems(): Set<string> {
  try {
    const raw = localStorage.getItem(OWNED_KEY);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}
export function saveOwnedEmblems(owned: Set<string>): void {
  try { localStorage.setItem(OWNED_KEY, JSON.stringify([...owned])); } catch { /* quota */ }
}
