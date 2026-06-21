/**
 * Compare new priority-weighted snaps vs shipped emblemOptimizerPresets.json.
 * Run: node --import tsx tools/meta-defaults/compare-snap-presets.ts
 */
import { loadBundle } from "../../src/data/loadBundle";
import rawPatch from "../../src/data/patch-current.json";
import shipped from "../../src/data/emblemOptimizerPresets.json";
import { buildPresetsFile } from "./generate-presets";

const bundle = loadBundle(rawPatch);
const next = buildPresetsFile(
  bundle.pokemon,
  bundle.emblems,
  bundle.setBonuses,
  bundle.patchVersion,
);

const changed: { id: string; before: unknown; after: unknown }[] = [];
for (const [id, oldPreset] of Object.entries(shipped.presets)) {
  const newPreset = next.presets[id];
  const oldColors = oldPreset.colorTargets;
  const newColors = newPreset?.colorTargets;
  if (JSON.stringify(oldColors) !== JSON.stringify(newColors)) {
    changed.push({ id, before: oldColors, after: newColors });
  }
}

console.log(`Color target changes vs shipped presets: ${changed.length}\n`);
for (const r of changed.sort((a, b) => a.id.localeCompare(b.id))) {
  console.log(`${r.id}:`);
  console.log(`  before ${JSON.stringify(r.before)}`);
  console.log(`  after  ${JSON.stringify(r.after)}`);
}

if (changed.length === 0) {
  console.log("No color target changes.");
}
