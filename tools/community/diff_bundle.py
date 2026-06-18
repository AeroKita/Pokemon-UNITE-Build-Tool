"""Semantic diff for GameDataBundle JSON — field-level changelog for data-refresh PRs.

Compares two patch bundles and renders a markdown summary that highlights new
entities (which need human curation) and meaningful stat/item changes.

Usage:  python3 diff_bundle.py OLD.json NEW.json
        (OLD may be missing → treated as initial baseline)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

# L15 stats surfaced for Pokémon (index 14 in baseStatsByLevel).
POKEMON_L15_STATS = ("hp", "attack", "defense", "spAttack", "spDefense")
POKEMON_L15_LABELS = {
    "hp": "HP",
    "attack": "Attack",
    "defense": "Defense",
    "spAttack": "Sp. Attack",
    "spDefense": "Sp. Defense",
}

CURATION_HINTS = {
    "Pokémon": "needs move descriptions + curated build label",
    "Held item": "review description / conditional effects",
    "Battle item": "review description / conditional effects",
    "Emblem": "(art auto-fetched)",
    "Set bonus": "",
}


def diff_bundles(old: dict | None, new: dict) -> dict:
    """Compare two GameDataBundles. Returns:
    {
      "version": (old_patchVersion_or_None, new_patchVersion),
      "added":   [ {"kind": "Pokémon", "label": "Ceruledge"}, ... ],
      "removed": [ {"kind": "Held item", "label": "X Attack"}, ... ],
      "changed": [ {"kind": "Pokémon", "label": "Lucario",
                    "deltas": ["Attack(L15) 429 → 435", ...]}, ... ],
    }
    When old is None, everything is treated as 'added' with a short-circuit summary.
    """
    new_version = new.get("patchVersion", "?")
    if old is None:
        return {
            "version": (None, new_version),
            "added": _all_entities(new),
            "removed": [],
            "changed": [],
            "counts": _entity_counts(new),
        }

    old_version = old.get("patchVersion", "?")
    added: list[dict] = []
    removed: list[dict] = []
    changed: list[dict] = []

    _diff_list(
        old.get("pokemon") or [],
        new.get("pokemon") or [],
        key="id",
        added_label=lambda e: e.get("displayName", e["id"]),
        kind="Pokémon",
        compare=_compare_pokemon,
        added=added,
        removed=removed,
        changed=changed,
    )
    _diff_list(
        old.get("heldItems") or [],
        new.get("heldItems") or [],
        key="id",
        added_label=lambda e: e.get("displayName", e["id"]),
        kind="Held item",
        compare=_compare_held_item,
        added=added,
        removed=removed,
        changed=changed,
    )
    _diff_list(
        old.get("emblems") or [],
        new.get("emblems") or [],
        key="id",
        added_label=lambda e: e.get("pokemonName", e["id"]),
        kind="Emblem",
        compare=_compare_emblem,
        added=added,
        removed=removed,
        changed=changed,
    )
    _diff_list(
        old.get("battleItems") or [],
        new.get("battleItems") or [],
        key="id",
        added_label=lambda e: e.get("displayName", e["id"]),
        kind="Battle item",
        compare=_compare_battle_item,
        added=added,
        removed=removed,
        changed=changed,
    )
    _diff_list(
        old.get("setBonuses") or [],
        new.get("setBonuses") or [],
        key="color",
        added_label=lambda e: e.get("color", "?"),
        kind="Set bonus",
        compare=_compare_set_bonus,
        added=added,
        removed=removed,
        changed=changed,
    )

    return {
        "version": (old_version, new_version),
        "added": added,
        "removed": removed,
        "changed": changed,
        "counts": _entity_counts(new),
    }


def render_markdown(diff: dict) -> str:
    """Render the diff dict to changelog markdown. Omits empty sections."""
    old_v, new_v = diff["version"]
    if old_v is None:
        c = diff["counts"]
        return (
            f"Initial data baseline — patch {new_v} "
            f"({c['pokemon']} pokemon, {c['heldItems']} held items, {c['emblems']} emblems)."
        )

    lines: list[str] = [f"## Data changes — patch {old_v} → {new_v}", ""]

    added = diff.get("added") or []
    removed = diff.get("removed") or []
    changed = diff.get("changed") or []

    if not added and not removed and not changed:
        lines.append("No game-data changes (metadata only).")
        return "\n".join(lines)

    if added:
        lines.append("### ⚠️ New — needs curation")
        for entry in added:
            hint = CURATION_HINTS.get(entry["kind"], "")
            suffix = f" — {hint}" if hint else ""
            lines.append(f"- **{entry['kind']}:** {entry['label']}{suffix}")
        lines.append("")

    if changed:
        lines.append("### Changed")
        for entry in changed:
            deltas = " · ".join(entry["deltas"])
            lines.append(f"- **{entry['label']}** — {deltas}")
        lines.append("")

    if removed:
        lines.append("### Removed")
        for entry in removed:
            lines.append(f"- **{entry['kind']}:** {entry['label']}")
        lines.append("")

    while lines and lines[-1] == "":
        lines.pop()
    return "\n".join(lines)


def _entity_counts(bundle: dict) -> dict[str, int]:
    return {
        "pokemon": len(bundle.get("pokemon") or []),
        "heldItems": len(bundle.get("heldItems") or []),
        "emblems": len(bundle.get("emblems") or []),
    }


def _all_entities(bundle: dict) -> list[dict]:
    entries: list[dict] = []
    for kind, array, label_fn in (
        ("Pokémon", bundle.get("pokemon") or [], lambda e: e.get("displayName", e["id"])),
        ("Held item", bundle.get("heldItems") or [], lambda e: e.get("displayName", e["id"])),
        ("Emblem", bundle.get("emblems") or [], lambda e: e.get("pokemonName", e["id"])),
        ("Battle item", bundle.get("battleItems") or [], lambda e: e.get("displayName", e["id"])),
        ("Set bonus", bundle.get("setBonuses") or [], lambda e: e.get("color", "?")),
    ):
        for entity in array:
            entries.append({"kind": kind, "label": label_fn(entity)})
    return entries


def _diff_list(
    old_items: list[dict],
    new_items: list[dict],
    *,
    key: str,
    added_label,
    kind: str,
    compare,
    added: list[dict],
    removed: list[dict],
    changed: list[dict],
) -> None:
    old_map = {item[key]: item for item in old_items}
    new_map = {item[key]: item for item in new_items}

    for k in sorted(set(new_map) - set(old_map)):
        added.append({"kind": kind, "label": added_label(new_map[k])})

    for k in sorted(set(old_map) - set(new_map)):
        removed.append({"kind": kind, "label": added_label(old_map[k])})

    for k in sorted(set(old_map) & set(new_map)):
        deltas = compare(old_map[k], new_map[k])
        if deltas:
            changed.append({"kind": kind, "label": added_label(new_map[k]), "deltas": deltas})


def _compare_pokemon(old: dict, new: dict) -> list[str]:
    deltas: list[str] = []

    old_l15 = (old.get("baseStatsByLevel") or [None] * 15)[14] or {}
    new_l15 = (new.get("baseStatsByLevel") or [None] * 15)[14] or {}
    for stat in POKEMON_L15_STATS:
        ov, nv = old_l15.get(stat), new_l15.get(stat)
        if ov != nv:
            label = POKEMON_L15_LABELS[stat]
            deltas.append(f"{label}(L15) {ov} → {nv}")

    if old.get("role") != new.get("role"):
        deltas.append(f"role {old.get('role')} → {new.get('role')}")
    if old.get("attackType") != new.get("attackType"):
        deltas.append(f"attackType {old.get('attackType')} → {new.get('attackType')}")

    if (old.get("passiveAbility") or {}).get("description") != (new.get("passiveAbility") or {}).get("description"):
        deltas.append("passive updated")

    old_moves = {m.get("name") for m in (old.get("moves") or []) if m.get("name")}
    new_moves = {m.get("name") for m in (new.get("moves") or []) if m.get("name")}
    for name in sorted(new_moves - old_moves):
        deltas.append(f"move added: {name}")
    for name in sorted(old_moves - new_moves):
        deltas.append(f"move removed: {name}")

    return deltas


def _compare_held_item(old: dict, new: dict) -> list[str]:
    deltas: list[str] = []
    old_g40 = (old.get("statsByGrade") or {}).get("40") or {}
    new_g40 = (new.get("statsByGrade") or {}).get("40") or {}
    deltas.extend(_diff_stat_block(old_g40, new_g40, lambda k: f"{k}@G40"))

    if old.get("effect") != new.get("effect"):
        deltas.append("effect changed")
    return deltas


def _compare_emblem(old: dict, new: dict) -> list[str]:
    deltas: list[str] = []
    old_gold = ((old.get("statsByGrade") or {}).get("gold")) or {}
    new_gold = ((new.get("statsByGrade") or {}).get("gold")) or {}
    deltas.extend(_diff_stat_block(old_gold, new_gold, lambda k: f"{k} (gold)"))

    if old.get("colors") != new.get("colors"):
        deltas.append(f"colors {old.get('colors')} → {new.get('colors')}")
    if old.get("goldOnly") != new.get("goldOnly"):
        deltas.append(f"goldOnly {old.get('goldOnly')} → {new.get('goldOnly')}")
    return deltas


def _compare_battle_item(old: dict, new: dict) -> list[str]:
    deltas: list[str] = []
    if old.get("description") != new.get("description"):
        deltas.append("description changed")
    if old.get("effects") != new.get("effects"):
        deltas.append("effects updated")
    return deltas


def _compare_set_bonus(old: dict, new: dict) -> list[str]:
    old_t = old.get("thresholds") or {}
    new_t = new.get("thresholds") or {}
    deltas: list[str] = []
    for k in sorted(set(old_t) | set(new_t)):
        ov, nv = old_t.get(k), new_t.get(k)
        if ov != nv:
            deltas.append(f"threshold {k}: {ov} → {nv}")
    return deltas


def _diff_stat_block(old: dict, new: dict, label_fn) -> list[str]:
    deltas: list[str] = []
    for k in sorted(set(old) | set(new)):
        ov, nv = old.get(k), new.get(k)
        if ov != nv:
            deltas.append(f"{label_fn(k)} {ov} → {nv}")
    return deltas


def _load_bundle(path: Path) -> dict | None:
    if not path.is_file() or path.stat().st_size == 0:
        return None
    return json.loads(path.read_text())


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 2:
        print("Usage: python3 diff_bundle.py OLD.json NEW.json", file=sys.stderr)
        return 1

    old_path, new_path = Path(args[0]), Path(args[1])
    old = _load_bundle(old_path)
    new = _load_bundle(new_path)
    if new is None:
        print(f"Missing or empty bundle: {new_path}", file=sys.stderr)
        return 1

    print(render_markdown(diff_bundles(old, new)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
