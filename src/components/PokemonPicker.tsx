import { useMemo, useState } from "react";
import { useStore } from "../state/store";
import { pokemonList } from "../data/gameData";
import { asset } from "../ui/asset";
import { CollapsibleCard } from "./CollapsibleCard";
import type { Role } from "../types";

const ROLES: (Role | "All")[] = ["All", "Attacker", "AllRounder", "Speedster", "Defender", "Supporter"];
const ROLE_LABEL: Record<string, string> = { AllRounder: "All-Rounder" };

export function PokemonPicker() {
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
    <CollapsibleCard title="Pokémon" persistKey="picker">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Pokémon…"
          className="flex-1 rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role | "All")}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        >
          {ROLES.map((r) => (
            <option key={r} value={r} className="bg-surface text-ink">{ROLE_LABEL[r] ?? r}</option>
          ))}
        </select>
      </div>
      <div className="grid max-h-72 grid-cols-6 gap-1.5 overflow-y-auto sm:grid-cols-8">
        {filtered.map((p) => {
          const selected = p.id === loadout.pokemonId;
          return (
            <button
              key={p.id}
              onClick={() => dispatch({ type: "setPokemon", pokemonId: p.id })}
              title={p.displayName}
              aria-pressed={selected}
              className={`group relative aspect-square rounded-lg border-2 p-0.5 transition
                ${selected
                  ? "border-transparent bg-mon-sel-bg ring-2 ring-mon-sel-ring"
                  : "border-transparent bg-mon-bg hover:border-mon-hover"}`}
            >
              <img src={asset(p.iconAsset)} alt={p.displayName} loading="lazy" className="h-full w-full object-contain" />
              {selected && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-mon-sel-ring text-[9px] font-bold text-white ring-2 ring-surface">✓</span>
              )}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-faint">{filtered.length} Pokémon</p>
    </CollapsibleCard>
  );
}
