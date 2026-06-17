// App state: the in-progress loadout (reducer) + saved loadouts (localStorage).
import { createContext, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import type { EmblemGrade } from "../types";
import {
  type Loadout,
  type SavedLoadout,
  type EmblemPick,
  emptyLoadout,
  loadSavedLoadouts,
  saveLoadout as persistSave,
  deleteLoadout as persistDelete,
  toLoadout,
  saveCurrent,
  loadCurrent,
  loadoutFromUrl,
  shareUrlFor,
  loadOwnedEmblems,
  saveOwnedEmblems,
  ownedKey,
  normalizeLoadout,
  MAX_EMBLEMS,
} from "./loadout";
import {
  clampHeldGrade,
  gradeForHeldItem,
  loadHeldItemGradeMemory,
  resolveSlotGrades,
  saveHeldItemGradeMemory,
} from "./heldItemGrades";

type Action =
  | { type: "setPokemon"; pokemonId: string }
  | { type: "setLevel"; level: number }
  | { type: "setHeldItem"; slot: number; id: string | null }
  | { type: "setBattleItem"; id: string | null }
  | { type: "addEmblem"; emblemId: string; grade: EmblemGrade }
  | { type: "removeEmblem"; index: number }
  | { type: "setEmblemGrade"; index: number; grade: EmblemGrade }
  | { type: "toggleBoost"; id: string }
  | { type: "setMove"; slot: "move1" | "move2"; moveId: string }
  | { type: "applyBuild"; heldItemIds: (string | null)[]; battleItemId: string | null; emblems: EmblemPick[]; move1Id?: string | null; move2Id?: string | null }
  | { type: "load"; loadout: Loadout }
  | { type: "reset" };

function reducer(state: Loadout, action: Action): Loadout {
  switch (action.type) {
    case "setPokemon":
      // Switching Pokémon invalidates move-based active boosts and move picks
      // (null → the Moves UI derives the new Pokémon's default final moves).
      return { ...state, pokemonId: action.pokemonId, move1Id: null, move2Id: null, activeBoostIds: state.activeBoostIds.filter((b) => !b.startsWith("move:")) };
    case "setLevel":
      return { ...state, level: Math.max(1, Math.min(15, action.level)) };
    case "setHeldItem": {
      // Prevent the same held item in two slots.
      const heldItemIds = state.heldItemIds.map((cur, i) =>
        i === action.slot ? action.id : cur === action.id ? null : cur,
      );
      return { ...state, heldItemIds };
    }
    case "setBattleItem":
      return { ...state, battleItemId: action.id, activeBoostIds: state.activeBoostIds.filter((b) => b !== "x-attack") };
    case "addEmblem": {
      if (state.emblems.length >= MAX_EMBLEMS) return state;
      return { ...state, emblems: [...state.emblems, { emblemId: action.emblemId, grade: action.grade }] };
    }
    case "removeEmblem":
      return { ...state, emblems: state.emblems.filter((_, i) => i !== action.index) };
    case "setEmblemGrade":
      return { ...state, emblems: state.emblems.map((e, i) => (i === action.index ? { ...e, grade: action.grade } : e)) };
    case "toggleBoost": {
      const on = state.activeBoostIds.includes(action.id);
      return { ...state, activeBoostIds: on ? state.activeBoostIds.filter((b) => b !== action.id) : [...state.activeBoostIds, action.id] };
    }
    case "setMove":
      return action.slot === "move1"
        ? { ...state, move1Id: action.moveId }
        : { ...state, move2Id: action.moveId };
    case "applyBuild":
      return normalizeLoadout({
        ...state,
        heldItemIds: [action.heldItemIds[0] ?? null, action.heldItemIds[1] ?? null, action.heldItemIds[2] ?? null],
        battleItemId: action.battleItemId,
        move1Id: action.move1Id !== undefined ? action.move1Id : state.move1Id,
        move2Id: action.move2Id !== undefined ? action.move2Id : state.move2Id,
        emblems: action.emblems.slice(0, MAX_EMBLEMS),
      });
    case "load":
      return normalizeLoadout(action.loadout);
    case "reset":
      return emptyLoadout(state.pokemonId);
    default:
      return state;
  }
}

export type ViewMode = "beginner" | "expert";
const MODE_KEY = "unite-build-optimizer.mode.v1";
function loadMode(): ViewMode {
  try { return localStorage.getItem(MODE_KEY) === "expert" ? "expert" : "beginner"; } catch { return "beginner"; }
}

export type Theme = "light" | "dark";
const THEME_KEY = "unite-build-optimizer.theme.v1";
function loadTheme(): Theme {
  try { const t = localStorage.getItem(THEME_KEY); return t === "dark" || t === "neo" ? "dark" : "light"; } catch { return "light"; }
}

interface Store {
  loadout: Loadout;
  dispatch: React.Dispatch<Action>;
  saved: SavedLoadout[];
  save: (name: string, id?: string) => void;
  remove: (id: string) => void;
  loadSaved: (saved: SavedLoadout) => void;
  saveError: string | null;
  owned: Set<string>; // keys are `${emblemId}:${grade}`
  toggleOwned: (emblemId: string, grade: EmblemGrade) => void;
  bulkSetOwned: (emblemIds: string[], grade: EmblemGrade, own: boolean) => void;
  shareUrl: () => string;
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  expert: boolean; // convenience: mode === "expert"
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Global per-item held grade (default 40). Synced with Builder sliders. */
  heldItemGrade: (itemId: string) => number;
  setHeldItemGradeById: (itemId: string, grade: number) => void;
  heldSlotGrades: [number, number, number];
  setHeldItemGradeForSlot: (slot: number, grade: number) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  // Initial build: a shared link (#b=) wins, else the last in-progress build, else empty.
  const [loadout, dispatch] = useReducer(reducer, null, () => {
    const fromUrl = loadoutFromUrl();
    if (fromUrl) return normalizeLoadout(fromUrl);
    const current = loadCurrent();
    if (current) return current;
    return emptyLoadout();
  });
  const [saved, setSaved] = useState<SavedLoadout[]>(() => loadSavedLoadouts());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [owned, setOwned] = useState<Set<string>>(() => loadOwnedEmblems());
  const [heldGradeMemory, setHeldGradeMemory] = useState<Record<string, number>>(() => loadHeldItemGradeMemory());
  const [mode, setModeState] = useState<ViewMode>(() => loadMode());
  const [theme, setThemeState] = useState<Theme>(() => loadTheme());

  const heldSlotGrades = useMemo(
    () => resolveSlotGrades(loadout, heldGradeMemory),
    [loadout, heldGradeMemory],
  );

  const setHeldItemGradeById = (itemId: string, grade: number) => {
    const g = clampHeldGrade(grade);
    setHeldGradeMemory((prev) => {
      const next = { ...prev, [itemId]: g };
      saveHeldItemGradeMemory(next);
      return next;
    });
  };

  // Set the grade for whatever item occupies a Builder slot (no-op for an empty slot).
  const setHeldItemGradeForSlot = (slot: number, grade: number) => {
    const id = loadout.heldItemIds[slot];
    if (id) setHeldItemGradeById(id, grade);
  };

  // Persist the in-progress build across reloads.
  useEffect(() => { saveCurrent(loadout); }, [loadout]);

  // Apply the theme to <html data-theme>; CSS variables cascade from there.
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const store = useMemo<Store>(() => ({
    loadout,
    dispatch,
    saved,
    saveError,
    owned,
    save: (name, id) => {
      try {
        setSaved(persistSave(saved, loadout, name, id));
        setSaveError(null);
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    },
    remove: (id) => setSaved(persistDelete(saved, id)),
    loadSaved: (s) => dispatch({ type: "load", loadout: toLoadout(s) }),
    toggleOwned: (emblemId, grade) => setOwned((prev) => {
      const next = new Set(prev);
      const key = ownedKey(emblemId, grade);
      next.has(key) ? next.delete(key) : next.add(key);
      saveOwnedEmblems(next);
      return next;
    }),
    bulkSetOwned: (emblemIds, grade, own) => setOwned((prev) => {
      const next = new Set(prev);
      for (const id of emblemIds) {
        const key = ownedKey(id, grade);
        own ? next.add(key) : next.delete(key);
      }
      saveOwnedEmblems(next);
      return next;
    }),
    shareUrl: () => shareUrlFor(loadout),
    mode,
    expert: mode === "expert",
    setMode: (m) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* quota */ } },
    theme,
    setTheme: (t) => { setThemeState(t); try { localStorage.setItem(THEME_KEY, t); } catch { /* quota */ } },
    heldItemGrade: (itemId) => gradeForHeldItem(heldGradeMemory, itemId),
    setHeldItemGradeById,
    heldSlotGrades,
    setHeldItemGradeForSlot,
  }), [loadout, saved, saveError, owned, mode, theme, heldGradeMemory, heldSlotGrades]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
