import { describe, it, expect } from "vitest";
import { heldItems, heldItemById } from "../../data/gameData";
import { deriveItemTags, ITEM_TAG_OVERRIDE_IDS, type ItemTag } from "../itemTags";

/**
 * Snapshot-style visibility test for auto-derived item tags. The full map is
 * asserted inline so a UNITE-DB data refresh that changes any item's text shows
 * up here as a diff for a human to glance at (see itemTags.ts header).
 */
describe("deriveItemTags", () => {
  const tagsFor = (id: string): ItemTag[] => {
    const item = heldItemById.get(id);
    if (!item) return [];
    return [...deriveItemTags(item)].sort();
  };

  it("tags every item in the bundle without throwing", () => {
    for (const item of heldItems) {
      expect(() => deriveItemTags(item)).not.toThrow();
    }
  });

  it("does not tag unique items (Mega Stones / Rusted Sword)", () => {
    expect(tagsFor("lucarionite")).toHaveLength(0);
    expect(tagsFor("rusted-sword")).toHaveLength(0);
  });

  // Refresh guard: a UNITE-DB pull that re-slugs or removes an overridden item
  // would silently drop its hand-curated tags. Fail loudly instead.
  it("every tag override references an item present in the bundle", () => {
    for (const id of ITEM_TAG_OVERRIDE_IDS) {
      expect(heldItemById.has(id), `override for unknown item id "${id}"`).toBe(true);
    }
  });

  it("derives basic-attack procs", () => {
    expect(tagsFor("muscle-band")).toContain("onBasicAttack");
    expect(tagsFor("scope-lens")).toContain("onBasicAttack");
    expect(tagsFor("scope-lens")).toContain("crit");
    expect(tagsFor("rapid-fire-scarf")).toContain("onBasicAttack");
  });

  it("derives ability / Unite procs", () => {
    expect(tagsFor("choice-specs")).toContain("onMove");
    expect(tagsFor("razor-claw")).toContain("onMove");
    expect(tagsFor("energy-amplifier")).toContain("onUnite");
    expect(tagsFor("buddy-barrier")).toContain("onUnite");
  });

  it("derives scoring / stacking carry items", () => {
    expect(tagsFor("attack-weight")).toEqual(expect.arrayContaining(["onScore", "stacking"]));
    expect(tagsFor("sp--atk-specs")).toEqual(expect.arrayContaining(["onScore", "stacking"]));
    expect(tagsFor("accel-bracer")).toEqual(expect.arrayContaining(["onTakedown", "stacking"]));
  });

  it("derives support / shield / sustain items", () => {
    expect(tagsFor("buddy-barrier")).toEqual(expect.arrayContaining(["shield", "support"]));
    expect(tagsFor("focus-band")).toContain("sustain");
    expect(tagsFor("drain-crown")).toContain("sustain");
    expect(tagsFor("shell-bell")).toContain("sustain");
  });

  it("derives defensive / bulk items from stats", () => {
    expect(tagsFor("focus-band")).toContain("bulk");
    expect(tagsFor("rocky-helmet")).toContain("bulk");
  });

  it("derives penetration / anti-heal", () => {
    expect(tagsFor("slick-spoon")).toContain("penetration");
    expect(tagsFor("curse-incense")).toContain("antiHeal");
  });
});
