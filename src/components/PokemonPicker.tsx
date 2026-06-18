import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { pokemonList } from "../data/gameData";
import { asset } from "../ui/asset";
import { readableTextColor } from "../ui/colors";
import { ROLE_FILTER_HEX } from "../ui/theme";
import { BottomSheet } from "./shell/BottomSheet";
import type { Role } from "../types";

const ROLES: (Role | "All")[] = ["All", "Attacker", "AllRounder", "Speedster", "Defender", "Supporter"];
const ROLE_LABEL: Record<string, string> = { AllRounder: "All-Rounder" };

interface PokemonPickerSheetProps {
  onClose: () => void;
}

/** Pokémon search + role filter in a bottom sheet; replaces the inline Build card. */
export function PokemonPickerSheet({ onClose }: PokemonPickerSheetProps) {
  const { loadout, dispatch } = useStore();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role | "All">("All");

  const filtered = useMemo(
    () =>
      pokemonList.filter(
        (p) =>
          (role === "All" || p.role === role) &&
          p.displayName.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, role],
  );

  return (
    <BottomSheet title="Choose Pokémon" onClose={onClose} fillHeight>
      <div className="sticky top-0 z-10 -mx-4 border-b border-line bg-surface px-4 pb-3 pt-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Pokémon…"
          className="mb-3 min-h-11 w-full rounded-lg border border-line px-3 text-sm outline-none focus:border-accent"
        />
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {ROLES.map((r) => (
            <FilterChip
              key={r}
              label={ROLE_LABEL[r] ?? r}
              active={role === r}
              activeColor={r === "All" ? undefined : ROLE_FILTER_HEX[r]}
              onClick={() => setRole(r)}
            />
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {filtered.map((p) => {
          const selected = p.id === loadout.pokemonId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                dispatch({ type: "setPokemon", pokemonId: p.id });
                onClose();
              }}
              title={p.displayName}
              aria-pressed={selected}
              className={`group relative aspect-square min-h-16 rounded-lg border-2 p-1 transition
                ${selected
                  ? "border-transparent bg-mon-sel-bg ring-2 ring-mon-sel-ring"
                  : "border-transparent bg-mon-bg hover:border-mon-hover"}`}
            >
              <img
                src={asset(p.iconAsset)}
                alt={p.displayName}
                loading="lazy"
                className="h-full w-full object-contain"
              />
              {selected && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-mon-sel-ring text-[9px] font-bold text-white ring-2 ring-surface">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-faint">{filtered.length} Pokémon</p>
    </BottomSheet>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  activeColor,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  activeColor?: string;
}) {
  const style = active && activeColor
    ? { background: activeColor, color: readableTextColor(activeColor) }
    : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className={`shrink-0 rounded-full border px-3 py-2 text-sm font-medium capitalize min-h-11 ${
        active
          ? activeColor ? "border-line" : "border-transparent bg-accent text-white"
          : "border-transparent bg-raise text-muted hover:bg-raise"
      }`}
    >
      {label}
    </button>
  );
}
