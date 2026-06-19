import { lazy, Suspense } from "react";
import { useStore } from "../../state/store";
import { BuildSummaryBar } from "../BuildSummaryBar";
import { RecommendPanel } from "../RecommendPanel";
import { LoadoutEditor } from "../LoadoutEditor";
import { MovesCard } from "../MovesCard";
import { StatPanel } from "../StatPanel";
import { LoadoutBar } from "../LoadoutBar";

const LevelGraph = lazy(() => import("../LevelGraph").then((m) => ({ default: m.LevelGraph })));

interface BuildScreenProps {
  onOpenPokePicker: () => void;
}

/** Build tab: glance hero, recommendations, editor, stats, and persistence. */
export function BuildScreen({ onOpenPokePicker }: BuildScreenProps) {
  const { expert } = useStore();

  return (
    <div className="flex flex-col gap-3">
      <BuildSummaryBar onOpenPokePicker={onOpenPokePicker} />
      <RecommendPanel />
      <LoadoutEditor />
      <MovesCard />
      <StatPanel />
      <LoadoutBar />
      {expert && (
        <Suspense fallback={null}>
          <LevelGraph />
        </Suspense>
      )}
    </div>
  );
}
