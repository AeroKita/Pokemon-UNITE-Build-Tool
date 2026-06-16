import { useEffect, useMemo, useState } from "react";
import { useStore } from "../state/store";
import { pokemonById, heldItemById, battleItemById, emblemById, emblems as allEmblems, setBonuses } from "../data/gameData";
import { recommendBuild, solveEmblemSet } from "../engine/recommend";
import { asset } from "../ui/asset";
import { EMBLEM_COLOR_HEX, GRADE_LETTER } from "../ui/colors";
import { emblemIconForGrade } from "../ui/emblemIcon";
import { EmblemSetSummary } from "./EmblemSetSummary";
import { CollapsibleCard } from "./CollapsibleCard";
import { Tooltip } from "./Tooltip";
import { itemTip, emblemTip } from "./tips";
import type { EmblemBuildPick, Pokemon } from "../types";

// A unified shape for both curated builds and generated/fallback ones.
interface DisplayBuild {
  name: string;
  emblemName?: string;
  lane?: string;
  source: "curated" | "generated";
  heldItemIds: string[];
  battleItemId?: string;
  emblems: EmblemBuildPick[];
}

function generatedBuild(pokemon: Pokemon, owned: Set<string>, seed: number): DisplayBuild {
  const rec = recommendBuild(pokemon, [...heldItemById.values()], setBonuses);
  const emblems = solveEmblemSet(pokemon, allEmblems, { owned, seed });
  return {
    name: "Randomized",
    emblemName: "Optimized emblem set",
    source: "generated",
    heldItemIds: rec.heldItemIds,
    battleItemId: rec.battleItemId ?? undefined,
    emblems,
  };
}

export function RecommendPanel() {
  const { loadout, dispatch, owned, expert } = useStore();
  const pokemon = loadout.pokemonId ? pokemonById.get(loadout.pokemonId) : null;

  const curated: DisplayBuild[] = useMemo(
    () =>
      (pokemon?.builds ?? [])
        .filter((b) => b.emblems.length === 10)
        .map((b) => ({
          name: b.name,
          emblemName: b.emblemName,
          lane: b.lane,
          source: "curated" as const,
          heldItemIds: b.heldItemIds,
          battleItemId: b.battleItemId,
          emblems: b.emblems,
        })),
    [pokemon],
  );

  const [idx, setIdx] = useState(0);
  const [custom, setCustom] = useState<DisplayBuild | null>(null);

  // Reset selection when the Pokémon changes; generate a fallback if none curated.
  useEffect(() => {
    setIdx(0);
    setCustom(pokemon && curated.length === 0 ? generatedBuild(pokemon, owned, Date.now()) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pokemon]);

  if (!pokemon) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-5 text-muted shadow-sm">
        Select a Pokémon to get a recommended build.
      </div>
    );
  }

  const variants = custom ? [...curated, custom] : curated;
  const build = variants[Math.min(idx, variants.length - 1)] ?? null;

  const resolvedEmblems = (build?.emblems ?? [])
    .map((p) => { const e = emblemById.get(p.emblemId); return e ? { emblem: e, grade: p.grade } : null; })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const reroll = () => { if (variants.length > 1) setIdx((i) => (i + 1) % variants.length); };
  const randomize = () => { setCustom(generatedBuild(pokemon, owned, Math.floor(Math.random() * 1e9))); setIdx(variants.length); };
  const apply = () => build && dispatch({ type: "applyBuild", heldItemIds: build.heldItemIds, battleItemId: build.battleItemId ?? null, emblems: build.emblems });

  const trainer = build?.battleItemId ? battleItemById.get(build.battleItemId) : null;

  const actions = (
    <div className="flex gap-2">
      {variants.length > 1 && (
        <button onClick={reroll} className="rounded-lg border border-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-weak">↻ Reroll</button>
      )}
      <button onClick={randomize} title="Generate an optimized emblem set" className="rounded-lg border border-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-weak">🎲 Randomize</button>
      <button onClick={apply} disabled={!build} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-white shadow hover:bg-accent-strong disabled:opacity-40">Apply build</button>
    </div>
  );

  return (
    <CollapsibleCard title="Recommended Build" persistKey="recommend" tone="indigo" right={actions}>
      {build && (
        <p className="mb-3 text-xs text-muted">
          <span className="font-semibold text-ink">{build.emblemName ?? build.name}</span>
          {build.lane ? ` · ${build.lane}` : ""}
          {build.source === "curated" ? " · Curated" : " · Generated"}
          {variants.length > 1 ? ` · ${Math.min(idx, variants.length - 1) + 1}/${variants.length}` : ""}
        </p>
      )}
      {!build ? (
        <p className="text-sm text-faint">No build available — try Randomize.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            {/* Held items */}
            <div>
              <p className="mb-1 text-xs font-medium text-faint">Held Items</p>
              <div className="flex gap-2">
                {build.heldItemIds.map((id) => {
                  const item = heldItemById.get(id);
                  return item ? (
                    <Tooltip key={id} content={itemTip(item)}>
                      <span className="flex w-16 flex-col items-center">
                        <img src={asset(item.iconAsset)} alt={item.displayName} className="h-10 w-10 object-contain" />
                        <span className="mt-0.5 text-center text-[10px] leading-tight text-muted">{item.displayName}</span>
                      </span>
                    </Tooltip>
                  ) : null;
                })}
              </div>
            </div>
            {/* Trainer item */}
            <div>
              <p className="mb-1 text-xs font-medium text-faint">Trainer Item</p>
              {trainer ? (
                <Tooltip content={itemTip(trainer)}>
                  <span className="flex w-16 flex-col items-center">
                    <img src={asset(trainer.iconAsset)} alt={trainer.displayName} className="h-10 w-10 object-contain" />
                    <span className="mt-0.5 text-center text-[10px] leading-tight text-muted">{trainer.displayName}</span>
                  </span>
                </Tooltip>
              ) : <span className="text-xs text-faint">—</span>}
            </div>
            {/* Emblems */}
            <div>
              <p className="mb-1 text-xs font-medium text-faint">Emblems (10)</p>
              <div className="flex flex-wrap gap-1">
                {resolvedEmblems.map(({ emblem, grade }, i) => (
                  <Tooltip key={i} content={emblemTip(emblem, grade)}>
                    <span className="relative inline-block">
                      <img src={asset(emblemIconForGrade(emblem, grade))} alt={emblem.pokemonName} className="h-9 w-9 object-contain" />
                      <span className="absolute -bottom-0.5 -right-0.5 rounded bg-neutral-800 px-0.5 text-[8px] font-bold text-white">{GRADE_LETTER[grade]}</span>
                      <span className="absolute -left-0.5 -top-0.5 flex gap-0.5">
                        {emblem.colors.map((c) => (
                          <span key={c} className="h-1.5 w-1.5 rounded-full ring-1 ring-white" style={{ background: EMBLEM_COLOR_HEX[c] }} />
                        ))}
                      </span>
                    </span>
                  </Tooltip>
                ))}
              </div>
            </div>
          </div>
          {/* Net flat stats + color sets from the 10 emblems */}
          <EmblemSetSummary picks={build.emblems} precise={expert} />
        </div>
      )}
    </CollapsibleCard>
  );
}
