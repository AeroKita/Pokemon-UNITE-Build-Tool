import { EmblemOptimizer } from "../EmblemOptimizer";
import type { Tab } from "../shell/TabBar";

interface OptimizeScreenProps {
  onNavigate: (tab: Tab) => void;
}

/** Optimize tab — emblem build search driven by the global Basic/Advanced mode toggle. */
export function OptimizeScreen({ onNavigate }: OptimizeScreenProps) {
  return (
    <EmblemOptimizer
      onNavigate={(page) => {
        if (page === "emblems") onNavigate("emblems");
      }}
    />
  );
}
