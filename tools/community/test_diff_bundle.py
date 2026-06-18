"""Unit tests for diff_bundle.py — semantic game-data changelog."""

from __future__ import annotations

import unittest

from diff_bundle import diff_bundles, render_markdown

# Minimal stat block helpers for fixtures.
STAT_L15 = {
    "hp": 5000,
    "attack": 429,
    "defense": 390,
    "spAttack": 300,
    "spDefense": 280,
    "critRate": 0,
    "cdr": 0,
    "lifesteal": 0,
    "spLifesteal": 0,
    "attackSpeed": 100,
    "moveSpeed": 3650,
}

STAT_L1 = {**STAT_L15, "attack": 100, "defense": 80}


def _levels(base_l15: dict, *, l1: dict | None = None) -> list[dict]:
    """15-level baseStatsByLevel array; only index 0 and 14 matter for most tests."""
    l1_stats = l1 or STAT_L1
    levels = [dict(l1_stats)] + [dict(l1_stats) for _ in range(13)] + [dict(base_l15)]
    return levels


def _minimal_bundle(**overrides) -> dict:
    bundle = {
        "patchVersion": "1.0.0.0",
        "lastUpdated": "2026-01-01",
        "pokemon": [],
        "heldItems": [],
        "emblems": [],
        "setBonuses": [],
        "battleItems": [],
    }
    bundle.update(overrides)
    return bundle


def _pokemon(**overrides) -> dict:
    base = {
        "id": "lucario",
        "displayName": "Lucario",
        "role": "AllRounder",
        "attackType": "physical",
        "difficulty": 2,
        "imageAsset": "pokemon/lucario.png",
        "iconAsset": "pokemon/lucario-icon.png",
        "evolutions": [],
        "baseStatsByLevel": _levels(STAT_L15),
        "moves": [{"id": "m1", "name": "Power-Up Punch", "slot": "move1", "description": "", "cooldownSeconds": 6, "damageInstances": [], "effects": [], "tags": []}],
        "passiveAbility": {"id": "p1", "name": "Steadfast", "description": "old passive", "effects": []},
    }
    base.update(overrides)
    return base


def _held_item(**overrides) -> dict:
    base = {
        "id": "float_stone",
        "displayName": "Float Stone",
        "iconAsset": "items/float_stone.png",
        "description": "desc",
        "statsByGrade": {"40": {"moveSpeed": 175}},
        "conditionalEffects": [],
    }
    base.update(overrides)
    return base


class TestDiffBundles(unittest.TestCase):
    def test_added_pokemon(self):
        old = _minimal_bundle()
        new = _minimal_bundle(pokemon=[_pokemon(id="ceruledge", displayName="Ceruledge")])
        diff = diff_bundles(old, new)
        self.assertEqual(len(diff["added"]), 1)
        self.assertEqual(diff["added"][0]["kind"], "Pokémon")
        self.assertEqual(diff["added"][0]["label"], "Ceruledge")

    def test_removed_entity(self):
        old = _minimal_bundle(
            battleItems=[{"id": "x_attack", "displayName": "X Attack", "iconAsset": "x.png", "description": "d", "effects": []}]
        )
        new = _minimal_bundle()
        diff = diff_bundles(old, new)
        self.assertEqual(len(diff["removed"]), 1)
        self.assertEqual(diff["removed"][0]["kind"], "Battle item")
        self.assertEqual(diff["removed"][0]["label"], "X Attack")

    def test_changed_pokemon_l15_stat(self):
        old_stats = dict(STAT_L15)
        new_stats = dict(STAT_L15)
        new_stats["attack"] = 435
        new_stats["defense"] = 395
        old = _minimal_bundle(pokemon=[_pokemon(baseStatsByLevel=_levels(old_stats))])
        new = _minimal_bundle(pokemon=[_pokemon(baseStatsByLevel=_levels(new_stats))])
        diff = diff_bundles(old, new)
        self.assertEqual(len(diff["changed"]), 1)
        deltas = diff["changed"][0]["deltas"]
        self.assertIn("Attack(L15) 429 → 435", deltas)
        self.assertIn("Defense(L15) 390 → 395", deltas)
        self.assertEqual(len([d for d in deltas if "(L15)" in d]), 2)

    def test_unchanged_l15_stats_produce_no_delta(self):
        old = _minimal_bundle(pokemon=[_pokemon()])
        new = _minimal_bundle(pokemon=[_pokemon()])
        diff = diff_bundles(old, new)
        self.assertEqual(diff["changed"], [])

    def test_changed_held_item_g40(self):
        old = _minimal_bundle(heldItems=[_held_item()])
        new = _minimal_bundle(heldItems=[_held_item(statsByGrade={"40": {"moveSpeed": 180}})])
        diff = diff_bundles(old, new)
        self.assertEqual(len(diff["changed"]), 1)
        self.assertIn("moveSpeed@G40 175 → 180", diff["changed"][0]["deltas"])

    def test_moves_added_removed(self):
        move_a = {"id": "m1", "name": "Power-Up Punch", "slot": "move1", "description": "", "cooldownSeconds": 6, "damageInstances": [], "effects": [], "tags": []}
        move_b = {"id": "m2", "name": "Bone Rush", "slot": "move2", "description": "", "cooldownSeconds": 8, "damageInstances": [], "effects": [], "tags": []}
        old = _minimal_bundle(pokemon=[_pokemon(moves=[move_a])])
        new = _minimal_bundle(pokemon=[_pokemon(moves=[move_a, move_b])])
        diff = diff_bundles(old, new)
        self.assertIn("move added: Bone Rush", diff["changed"][0]["deltas"])

        diff2 = diff_bundles(new, old)
        self.assertIn("move removed: Bone Rush", diff2["changed"][0]["deltas"])

    def test_excluded_builds_change(self):
        build = {"name": "Build A", "heldItemIds": [], "emblems": []}
        old = _minimal_bundle(pokemon=[_pokemon(builds=[build])])
        new = _minimal_bundle(pokemon=[_pokemon(builds=[{**build, "name": "Build B"}])])
        diff = diff_bundles(old, new)
        self.assertEqual(diff["changed"], [])

    def test_excluded_non_l15_stat_change(self):
        l1 = dict(STAT_L1)
        l1_changed = dict(STAT_L1)
        l1_changed["attack"] = 999
        old = _minimal_bundle(pokemon=[_pokemon(baseStatsByLevel=_levels(STAT_L15, l1=l1))])
        new = _minimal_bundle(pokemon=[_pokemon(baseStatsByLevel=_levels(STAT_L15, l1=l1_changed))])
        diff = diff_bundles(old, new)
        self.assertEqual(diff["changed"], [])

    def test_old_is_none_baseline(self):
        new = _minimal_bundle(
            patchVersion="2.0.0.0",
            pokemon=[_pokemon()],
            heldItems=[_held_item()],
            emblems=[{"id": "e1", "pokemonName": "Pikachu", "colors": ["yellow"], "iconAsset": "e.png", "statsByGrade": {"bronze": {}, "silver": {}, "gold": {}}}],
        )
        diff = diff_bundles(None, new)
        self.assertIsNone(diff["version"][0])
        self.assertEqual(diff["version"][1], "2.0.0.0")
        md = render_markdown(diff)
        self.assertIn("Initial data baseline — patch 2.0.0.0 (1 pokemon, 1 held items, 1 emblems)", md)


class TestRenderMarkdown(unittest.TestCase):
    def test_omits_empty_sections(self):
        diff = {
            "version": ("1.0.0.0", "1.0.0.1"),
            "added": [],
            "removed": [],
            "changed": [{"kind": "Pokémon", "label": "Lucario", "deltas": ["Attack(L15) 429 → 435"]}],
        }
        md = render_markdown(diff)
        self.assertIn("## Data changes — patch 1.0.0.0 → 1.0.0.1", md)
        self.assertIn("### Changed", md)
        self.assertNotIn("### ⚠️ New", md)
        self.assertNotIn("### Removed", md)
        self.assertIn("**Lucario** — Attack(L15) 429 → 435", md)

    def test_added_curation_text(self):
        diff = {
            "version": ("1.0.0.0", "1.0.0.1"),
            "added": [{"kind": "Pokémon", "label": "Ceruledge"}],
            "removed": [],
            "changed": [],
        }
        md = render_markdown(diff)
        self.assertIn("### ⚠️ New — needs curation", md)
        self.assertIn("**Pokémon:** Ceruledge — needs move descriptions + curated build label", md)

    def test_metadata_only(self):
        diff = {
            "version": ("1.0.0.0", "1.0.0.1"),
            "added": [],
            "removed": [],
            "changed": [],
        }
        md = render_markdown(diff)
        self.assertIn("No game-data changes (metadata only).", md)


if __name__ == "__main__":
    unittest.main()
