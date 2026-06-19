import { lazy, Suspense } from "react";
import { useStore } from "../../state/store";
import { RecommendPanel } from "../RecommendPanel";
import { LoadoutEditor } from "../LoadoutEditor";
import { MovesCard } from "../MovesCard";
import { StatPanel } from "../StatPanel";
import { LoadoutBar } from "../LoadoutBar";

const LevelGraph = lazy(() => import("../LevelGraph").then((m) => ({ default: m.LevelGraph })));

/** Build tab: recommendations, editor, stats, and persistence. */
export function BuildScreen() {
  const { expert } = useStore();

  return (
    <div className="flex flex-col gap-3">
      <RecommendPanel />
      <LoadoutEditor />
      <MovesCard />
      <StatPanel />
      {expert && (
        <Suspense fallback={null}>
          <LevelGraph />
        </Suspense>
      )}
      <LoadoutBar />
    </div>
  );
}
