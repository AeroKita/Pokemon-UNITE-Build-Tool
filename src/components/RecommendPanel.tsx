import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../state/store";
import { pokemonById, heldItemById, battleItemById, emblemById, emblems as allEmblems, setBonuses } from "../data/gameData";
import { recommendBuild, solveOwnedEmblemSet } from "../engine/recommend";
import { moveIdsFromNames, resolveFinalMove } from "../engine/moves";
import { asset } from "../ui/asset";
import { EMBLEM_COLOR_HEX, GRADE_LETTER } from "../ui/colors";
import { emblemIconForGrade } from "../ui/emblemIcon";
import { EmblemSetSummary } from "./EmblemSetSummary";
import { CollapsibleCard } from "./CollapsibleCard";
import { Tooltip } from "./Tooltip";
import { MoveIcon } from "./MoveIcon";
import { itemTip, emblemTip, moveTip } from "./tips";
import type { EmblemBuildPick, Pokemon, PokemonBuild } from "../types";

type Tab = "recommended" | "creative" | "yours";

const TAB_LABEL: Record<Tab, string> = {
  recommended: "Recommended",
  creative: "Creative",
  yours: "Your Emblems",
};

// A unified shape for curated, creative, and inventory builds.
interface DisplayBuild {
  name: string;
  emblemName?: string;
  lane?: string;
  source: "curated" | "owned";
  heldItemIds: string[];
  battleItemId?: string;
  emblems: EmblemBuildPick[];
  moves?: string[];
}

/** Curated/creative builds from the data → display shape (only complete 10-emblem sets). */
function toDisplayBuilds(builds: PokemonBuild[] | undefined): DisplayBuild[] {
  return (builds ?? [])
    .filter((b) => b.emblems.length === 10)
    .map((b) => ({
      name: b.name,
      emblemName: b.emblemName,
      lane: b.lane,
      source: "curated" as const,
      heldItemIds: b.heldItemIds,
      battleItemId: b.battleItemId,
      emblems: b.emblems,
      moves: b.moves,
    }));
}

function buildsForTab(
  tab: Tab,
  curated: DisplayBuild[],
  creative: DisplayBuild[],
  yours: DisplayBuild[],
): DisplayBuild[] {
  return tab === "recommended" ? curated : tab === "creative" ? creative : yours;
}

function applyDisplayBuild(
  pokemon: Pokemon,
  build: DisplayBuild | null,
  dispatch: ReturnType<typeof useStore>["dispatch"],
): void {
  if (!build) return;
  dispatch({
    type: "applyBuild",
    heldItemIds: build.heldItemIds,
    battleItemId: build.battleItemId ?? null,
    emblems: build.emblems,
    ...moveIdsFromNames(pokemon, build.moves),
  });
}

export function RecommendPanel() {
  const { loadout, dispatch, owned, expert } = useStore();
  const pokemon = loadout.pokemonId ? pokemonById.get(loadout.pokemonId) : null;

  const curated = useMemo(() => toDisplayBuilds(pokemon?.builds), [pokemon]);
  const creative = useMemo(() => toDisplayBuilds(pokemon?.creativeBuilds), [pokemon]);

  const yours: DisplayBuild[] = useMemo(() => {
    if (!pokemon) return [];
    const rec = recommendBuild(pokemon, [...heldItemById.values()], setBonuses);
    const emblems = solveOwnedEmblemSet(pokemon, allEmblems, owned);
    return emblems.length
      ? [{
          name: "Your Emblems",
          emblemName: "From your inventory",
          source: "owned" as const,
          heldItemIds: rec.heldItemIds,
          battleItemId: rec.battleItemId ?? undefined,
          emblems,
        }]
      : [];
  }, [pokemon, owned]);

  const [tab, setTab] = useState<Tab>("recommended");
  const [idxByTab, setIdxByTab] = useState<Record<Tab, number>>({ recommended: 0, creative: 0, yours: 0 });

  // The Pokémon we've already auto-applied for. Initialised to the cold-load
  // restored build's Pokémon so we never overwrite it. Because this ref is only
  // updated when we actually apply (never reset to null), the guard also survives
  // React StrictMode's double-invoked mount effect — the old skip-once-then-null
  // ref did not, and re-applied the build over the restored loadout on reload.
  const lastAutoAppliedPokemonId = useRef(loadout.pokemonId);

  const applyFor = useCallback(
    (b: DisplayBuild | null) => {
      if (pokemon) applyDisplayBuild(pokemon, b, dispatch);
    },
    [pokemon, dispatch],
  );

  // Auto-apply the top build only when the user switches to a *different* Pokémon
  // (not on cold-load restore, and not on a StrictMode re-run of this effect).
  useEffect(() => {
    if (!pokemon || lastAutoAppliedPokemonId.current === pokemon.id) return;
    lastAutoAppliedPokemonId.current = pokemon.id;
    setIdxByTab({ recommended: 0, creative: 0, yours: 0 });
    setTab("recommended");
    applyFor(toDisplayBuilds(pokemon.builds)[0] ?? null);
  }, [pokemon, applyFor]);

  const selectTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    const list = buildsForTab(next, curated, creative, yours);
    const i = list.length ? Math.min(idxByTab[next], list.length - 1) : 0;
    applyFor(list[i] ?? null);
  };

  const go = (delta: number) => {
    const list = buildsForTab(tab, curated, creative, yours);
    if (list.length < 2) return;
    const next = (idxByTab[tab] + delta + list.length) % list.length;
    setIdxByTab((m) => ({ ...m, [tab]: next }));
    applyFor(list[next] ?? null);
  };

  if (!pokemon) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-5 text-muted shadow-sm">
        Select a Pokémon to get a recommended build.
      </div>
    );
  }

  const builds = buildsForTab(tab, curated, creative, yours);
  const idx = builds.length ? Math.min(idxByTab[tab], builds.length - 1) : 0;
  const build = builds[idx] ?? null;

  const resolvedEmblems = (build?.emblems ?? [])
    .map((p) => { const e = emblemById.get(p.emblemId); return e ? { emblem: e, grade: p.grade } : null; })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const trainer = build?.battleItemId ? battleItemById.get(build.battleItemId) : null;
  const ownedCount = build?.emblems.length ?? 0;

  const finalMoveDisplays = (() => {
    if (!build) return [];
    const ids =
      tab === "yours"
        ? { move1Id: loadout.move1Id, move2Id: loadout.move2Id }
        : moveIdsFromNames(pokemon, build.moves);
    return (["move1", "move2"] as const)
      .map((slot) => resolveFinalMove(pokemon, slot, slot === "move1" ? ids.move1Id : ids.move2Id))
      .filter((m): m is NonNullable<typeof m> => m != null);
  })();

  return (
    <CollapsibleCard title="Builds" persistKey="recommend" tone="indigo">
      {/* Source tabs — selecting a tab auto-applies that build variant */}
      <div className="mb-3 flex gap-1 rounded-xl bg-raise p-1">
        {(["recommended", "creative", "yours"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => selectTab(t)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition sm:text-sm ${
              tab === t ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Variant navigation — arrows auto-apply the selected build */}
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => go(-1)}
          disabled={builds.length < 2}
          aria-label="Previous build"
          className="rounded-lg border border-line px-2.5 py-1 text-sm text-ink hover:bg-raise disabled:opacity-30"
        >
          ‹
        </button>
        <p className="min-w-0 flex-1 truncate text-center text-xs text-muted">
          {build ? (
            <>
              <span className="font-semibold text-ink">{build.emblemName ?? build.name}</span>
              {build.lane ? ` · ${build.lane}` : ""}
              {builds.length > 1 ? ` · ${idx + 1}/${builds.length}` : ""}
            </>
          ) : (
            "—"
          )}
        </p>
        <button
          onClick={() => go(1)}
          disabled={builds.length < 2}
          aria-label="Next build"
          className="rounded-lg border border-line px-2.5 py-1 text-sm text-ink hover:bg-raise disabled:opacity-30"
        >
          ›
        </button>
      </div>

      {!build ? (
        <p className="text-sm text-faint">
          {tab === "recommended"
            ? `No Recommended builds for ${pokemon.displayName} yet.`
            : tab === "creative"
              ? `No Creative builds for ${pokemon.displayName} yet.`
              : "You haven't marked any emblems as owned yet. Mark some in the Emblem Inventory and your best set will appear here."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {tab === "yours" && ownedCount < 10 && (
            <p className="rounded-lg bg-raise px-3 py-2 text-xs text-muted">
              {ownedCount}/10 from your inventory — mark more emblems as owned to complete the set.
            </p>
          )}
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
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
            {finalMoveDisplays.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-faint">Final Moves</p>
                <div className="flex gap-2">
                  {finalMoveDisplays.map((mv) => (
                    <Tooltip key={mv.id} content={moveTip(mv)}>
                      <span className="flex w-16 flex-col items-center">
                        <MoveIcon src={mv.iconAsset} alt={mv.name} />
                        <span className="mt-0.5 text-center text-[10px] leading-tight text-muted">{mv.name}</span>
                      </span>
                    </Tooltip>
                  ))}
                </div>
              </div>
            )}
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
            <div>
              <p className="mb-1 text-xs font-medium text-faint">Emblems ({ownedCount})</p>
              <div className="flex flex-wrap gap-1">
                {resolvedEmblems.map(({ emblem, grade }, i) => (
                  <Tooltip key={i} content={emblemTip(emblem, grade)}>
                    <span className="relative inline-block">
                      <img src={asset(emblemIconForGrade(emblem, grade))} alt={emblem.pokemonName} className="h-16 w-16 object-contain" />
                      <span className="absolute -bottom-0.5 -right-0.5 rounded bg-neutral-800 px-0.5 text-[9px] font-bold text-white">{GRADE_LETTER[grade]}</span>
                      <span className="absolute -left-0.5 -top-0.5 flex gap-0.5">
                        {emblem.colors.map((c) => (
                          <span key={c} className="h-2 w-2 rounded-full ring-1 ring-white" style={{ background: EMBLEM_COLOR_HEX[c] }} />
                        ))}
                      </span>
                    </span>
                  </Tooltip>
                ))}
              </div>
            </div>
          </div>
          <EmblemSetSummary picks={build.emblems} precise={expert} />
        </div>
      )}
    </CollapsibleCard>
  );
}
