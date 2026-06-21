import type { FlatStatPrediction } from "../../engine/emblemSearch/predictStats";
import type { StatBlock } from "../../types";
import { flatStatEstimateUnavailableHint, fmtDelta } from "./shared";

/** Inline estimate under a priority slider — sign is color-coded for quick scanning. */
export function PriorityFlatEstimate({
  stat,
  pred,
  weight,
  poolTooSmall = false,
  poolCandidateCount = 0,
  useOwned = false,
}: {
  stat: keyof StatBlock;
  pred?: FlatStatPrediction;
  weight: number;
  poolTooSmall?: boolean;
  poolCandidateCount?: number;
  useOwned?: boolean;
}) {
  if (!pred) {
    if (poolTooSmall && weight > 0) {
      return (
        <span className="text-faint">
          {flatStatEstimateUnavailableHint(poolCandidateCount, useOwned)}
        </span>
      );
    }
    return (
      <span className="text-faint">
        {weight > 0 ? "Pool too small to estimate" : "No priority"}
      </span>
    );
  }
  const protectedOnly = weight <= 0 && pred.weight <= 0;
  const v = pred.predicted;
  const signClass = v > 0 ? "text-pos" : v < 0 ? "text-neg" : "text-muted";
  return (
    <>
      <span className="text-faint">Approx. </span>
      <span className={`font-mono font-semibold tabular-nums ${signClass}`}>
        {fmtDelta(stat, v)}
      </span>
      <span className="text-faint">
        {protectedOnly ? " from emblems (minimum only)" : " from emblems"}
      </span>
    </>
  );
}
