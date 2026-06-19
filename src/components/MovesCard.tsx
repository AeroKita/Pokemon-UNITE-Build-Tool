import { useStore } from "../state/store";
import { pokemonById } from "../data/gameData";
import { baseMove, upgradeOptions, resolveFinalMove, type FinalSlot } from "../engine/moves";
import { CollapsibleCard } from "./CollapsibleCard";
import { Tooltip } from "./Tooltip";
import { MoveIcon } from "./MoveIcon";
import { moveTip } from "./tips";
import type { Move, Pokemon } from "../types";

/** A read-only move row (base skill, Unite move) — icon + name + tooltip. */
function MoveRow({ move, dimLabel }: { move: Move; dimLabel?: string }) {
  return (
    <Tooltip content={moveTip(move)}>
      <span className="flex items-center gap-2">
        <MoveIcon src={move.iconAsset} alt={move.name} size="h-8 w-8" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{move.name}</span>
          <span className="text-[10px] uppercase text-faint">
            {dimLabel}
            {dimLabel && move.moveType ? " · " : ""}
            {move.moveType}
          </span>
        </span>
      </span>
    </Tooltip>
  );
}

/**
 * An interactive move slot: the base skill (locked) plus the upgrade options the
 * player chooses between. The selected upgrade is the "final move" shown in the
 * Builds card. Clicking an option updates the loadout (single source of truth).
 */
function ChoosableMoveSlot({
  label,
  pokemon,
  slot,
}: {
  label: string;
  pokemon: Pokemon;
  slot: FinalSlot;
}) {
  const { loadout, dispatch } = useStore();
  const base = baseMove(pokemon, slot);
  const options = upgradeOptions(pokemon, slot);
  const chosenId = slot === "move1" ? loadout.move1Id : loadout.move2Id;
  const selected = resolveFinalMove(pokemon, slot, chosenId);
  if (!base && options.length === 0) return null;

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-faint">{label}</p>
      {base && <MoveRow move={base} dimLabel="Base" />}
      {options.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {options.map((u) => {
            const isSel = selected?.id === u.id;
            return (
              <Tooltip key={u.id} content={moveTip(u)} className="w-full">
                <button
                  type="button"
                  onClick={() => dispatch({ type: "setMove", slot, moveId: u.id })}
                  aria-pressed={isSel}
                  className={`flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition ${
                    isSel
                      ? "border-accent bg-accent-weak ring-1 ring-accent"
                      : "border-line hover:bg-raise"
                  }`}
                >
                  <MoveIcon src={u.iconAsset} alt={u.name} size="h-8 w-8" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{u.name}</span>
                  {u.upgradeLevel ? (
                    <span className="shrink-0 rounded bg-raise px-1 text-[10px] text-faint">
                      Lv {u.upgradeLevel}
                    </span>
                  ) : null}
                  {isSel && <span className="shrink-0 text-xs font-bold text-accent-ink">✓</span>}
                </button>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The selected Pokémon's move kit — Move 1 / Move 2 are choosable; the two
 *  selected upgrades are the "final moves" shown in the Builds card. */
export function MovesCard() {
  const { loadout } = useStore();
  const pokemon = loadout.pokemonId ? pokemonById.get(loadout.pokemonId) : null;
  if (!pokemon) return null;

  const unite = pokemon.moves.find((m) => m.slot === "uniteMove");
  const passive = pokemon.passiveAbility;

  return (
    <CollapsibleCard title="Moves" persistKey="moves" tone="sky" defaultOpen={false}>
      <p className="mb-3 text-xs text-faint">
        {pokemon.displayName}'s kit — pick one upgrade per move; your picks set the final moves in
        the Builds card.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ChoosableMoveSlot label="Move 1" pokemon={pokemon} slot="move1" />
        <ChoosableMoveSlot label="Move 2" pokemon={pokemon} slot="move2" />
        {unite && (
          <div>
            <p className="mb-1 text-xs font-medium text-faint">Unite Move</p>
            <MoveRow move={unite} />
          </div>
        )}
        <div>
          <p className="mb-1 text-xs font-medium text-faint">Passive</p>
          <Tooltip
            content={
              <span>
                <span className="font-semibold">{passive.name}</span>
                {passive.description && (
                  <span className="mt-0.5 block text-faint">{passive.description}</span>
                )}
              </span>
            }
          >
            <span className="flex items-center gap-2">
              <MoveIcon src={passive.iconAsset} alt={passive.name} size="h-8 w-8" />
              <span className="truncate text-sm font-medium text-ink">{passive.name}</span>
            </span>
          </Tooltip>
        </div>
      </div>
    </CollapsibleCard>
  );
}
