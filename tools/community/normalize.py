"""Normalize UNITE-DB raw JSON into a GameDataBundle (src/data/patch-1.23.1.1.json).

Maps UNITE-DB's shapes onto schema/types.ts. Conventions applied here:
  - Percentages become decimals (crit 20 -> 0.20, attack_speed 40 -> 0.40).
  - Held-item flats are emitted for every grade 1–40 (the in-game cap is 40),
    via the formula recovered from UNITE-DB's params:
      value = increment * factor(level) / (skip + 1) + initial_diff,
    where factor(g) = g for g <= 30 and 30 + (g - 30)/2 for g > 30
    (so Curse Bangle Attack = 24 at G30, 28 at G40).
  - Emblem grades A/B/C map to gold/silver/bronze (A = best = gold).
  - Art is referenced from UNITE-DB's CloudFront CDN (case-sensitive names).

Provenance: the whole bundle is community-sourced from UNITE-DB; this is recorded
in the bundle's `dataSource` block (the APK bundles are encrypted — see
tools/extract/ENCRYPTION-FINDINGS.md).

Usage:  python3 normalize.py
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "_raw"
OUT = HERE.parent.parent / "src" / "data" / "patch-1.23.1.1.json"
CDN = "https://d275t8dp8rxb42.cloudfront.net"
ASSETS = "/assets"  # local mirror under public/assets (see fetch_art.py)
PATCH_VERSION = "1.23.1.1"

# ---- helpers ---------------------------------------------------------------

ROLE_MAP = {
    "All-Rounder": "AllRounder",
    "Attacker": "Attacker",
    "Speedster": "Speedster",
    "Defender": "Defender",
    "Supporter": "Supporter",
}
DIFFICULTY_MAP = {"Novice": 1, "Intermediate": 2, "Expert": 3}
COLOR_MAP = {
    "Brown": "brown", "Green": "green", "Blue": "blue", "Purple": "purple",
    "White": "white", "Red": "red", "Yellow": "yellow", "Black": "black",
    "Pink": "pink", "Navy": "navy", "Gray": "gray",
}
GRADE_MAP = {"A": "gold", "B": "silver", "C": "bronze"}

# Flat (non-percent) StatBlock fields.
FLAT_FIELDS = {"hp", "attack", "defense", "spAttack", "spDefense", "moveSpeed"}


def load(name: str):
    return json.loads((RAW / f"{name}.json").read_text())


def num(x, default=0.0) -> float:
    if x is None or x == "":
        return default
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


# UNITE-DB stat label -> (StatBlock field, is_percent). Labels appear across
# stats.json, held items, emblems and emblem sets (with abbreviations).
STAT_FIELD = {
    "hp": ("hp", False), "HP": ("hp", False),
    "attack": ("attack", False), "Attack": ("attack", False), "Atk": ("attack", False),
    "defense": ("defense", False), "Defense": ("defense", False),
    "sp_attack": ("spAttack", False), "Sp. Attack": ("spAttack", False),
    "sp_defense": ("spDefense", False), "Sp. Defense": ("spDefense", False),
    "crit": ("critRate", True), "Crit": ("critRate", True),
    "Critical-Hit Rate": ("critRate", True),
    "cdr": ("cdr", True), "CDR": ("cdr", True), "CD Reduction": ("cdr", True),
    "lifesteal": ("lifesteal", True),
    "attack_speed": ("attackSpeed", True), "Attack Speed": ("attackSpeed", True),
    "AS": ("attackSpeed", True),
    "speed": ("moveSpeed", False), "Speed": ("moveSpeed", False),
    "move_speed": ("moveSpeed", False), "Movement Speed": ("moveSpeed", False),
}


def map_stat(label: str, value: float):
    """Return (field, decimal_value) or None if the label has no StatBlock field."""
    entry = STAT_FIELD.get(label)
    if entry is None:
        return None
    field, is_percent = entry
    return field, (value / 100.0 if is_percent else value)


# ---- pokemon ---------------------------------------------------------------

DMG_TYPE = {"Atk": "physical", "SpAtk": "special", "Sp. Atk": "special", "True": "true"}
SCALING = {"Atk": "attack", "SpAtk": "spAttack", "Sp. Atk": "spAttack",
           "True": "none", "Max HP": "maxHp"}
SLOT_MAP = {"Basic": "basicAttack", "Move 1": "move1", "Move 2": "move2",
            "Unite": "uniteMove", "Unite Move": "uniteMove"}


def stat_block(level_row: dict) -> dict:
    """UNITE-DB stats.json level row -> full StatBlock (decimals for %)."""
    return {
        "hp": num(level_row.get("hp")),
        "attack": num(level_row.get("attack")),
        "defense": num(level_row.get("defense")),
        "spAttack": num(level_row.get("sp_attack")),
        "spDefense": num(level_row.get("sp_defense")),
        "critRate": num(level_row.get("crit")) / 100.0,
        "cdr": num(level_row.get("cdr")) / 100.0,
        "lifesteal": num(level_row.get("lifesteal")) / 100.0,
        "spLifesteal": 0.0,
        "attackSpeed": num(level_row.get("attack_speed")) / 100.0,
        "moveSpeed": num(level_row.get("move_speed")),
    }


def damage_instances(rsb: dict) -> list:
    """Extract the primary + add1..add5 damage instances from a skill rsb block."""
    out = []
    groups = [("ratio", "dmg_type", "slider", "base")]
    groups += [(f"add{i}_ratio", f"add{i}_dmg_type", f"add{i}_slider", f"add{i}_base")
               for i in range(1, 6)]
    for rk, dk, sk, bk in groups:
        if not rsb.get(rk):
            continue
        dt = rsb.get(dk, "")
        out.append({
            "ratio": num(rsb.get(rk)) / 100.0,
            "scalingStat": SCALING.get(dt, "none"),
            "slider": num(rsb.get(sk)),
            "base": num(rsb.get(bk)),
            "damageType": DMG_TYPE.get(dt, "true"),
        })
    return out


def plus(s: str) -> str:
    """Space -> '+' for CDN art names (skills/<Pokemon>/<Move>.png)."""
    return (s or "").replace(" ", "+")


def skill_icon(folder: str, move_name: str) -> str:
    return f"{ASSETS}/skills/{plus(folder)}/{plus(move_name)}.png"


def build_move(skill: dict, slot: str, folder: str) -> dict:
    rsb = skill.get("rsb") or {}
    mtype = skill.get("type")
    name = skill.get("name", "")
    move = {
        "id": slugify(name or slot),
        "name": name,
        "slot": slot,
        "description": skill.get("description", "") or "",
        "cooldownSeconds": num(skill.get("cd")),
        "damageInstances": damage_instances(rsb),
        "effects": [],
        "tags": [str(mtype).lower()] if mtype else [],
    }
    if mtype:
        move["moveType"] = mtype
    # Every slot has CDN art except the basic attack ("Attack" has no icon).
    if slot != "basicAttack":
        move["iconAsset"] = skill_icon(folder, name)
    return move


def build_upgrade_move(up: dict, slot: str, folder: str) -> dict:
    """An upgrade option for Move 1/Move 2 (the actual moves picked in a build)."""
    rsb = up.get("rsb") or {}
    mtype = up.get("type")
    name = up.get("name", "")
    move = {
        "id": slugify(name or slot),
        "name": name,
        "slot": slot,
        "description": up.get("description1", "") or "",
        "cooldownSeconds": num(up.get("cd1")),
        "damageInstances": damage_instances(rsb),
        "effects": [],
        "tags": [str(mtype).lower()] if mtype else [],
        "iconAsset": skill_icon(folder, name),
        "isUpgrade": True,
    }
    if mtype:
        move["moveType"] = mtype
    lvl = up.get("level1")
    if lvl not in (None, ""):
        try:
            move["upgradeLevel"] = int(float(lvl))
        except (TypeError, ValueError):
            pass
    return move


def slugify(s: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-")


def decode_emblem_link(link: str, pokedex_to_id: dict) -> list:
    """Decode a UNITE-DB boost-emblems link's `build=` param into emblem picks.

    Param looks like `250A,022A,...,142C` — each token is a 3-digit pokedex
    number + grade letter (A=gold, B=silver, C=bronze). Returns up to 10
    {emblemId, grade} picks, skipping any pokedex we don't have an emblem for.
    """
    if not link or "build=" not in link:
        return []
    raw = link.split("build=", 1)[1].split("&")[0]
    picks = []
    for tok in raw.split(","):
        tok = tok.strip()
        if len(tok) < 2:
            continue
        pokedex, letter = tok[:-1], tok[-1].upper()
        emblem_id = pokedex_to_id.get(pokedex)
        if emblem_id and letter in GRADE_MAP:
            picks.append({"emblemId": emblem_id, "grade": GRADE_MAP[letter]})
    return picks


def build_one_build(b: dict, pokedex_to_id: dict, valid_moves: set[str]) -> dict | None:
    """Normalize one UNITE-DB build entry. Skips placeholders (`soon`)."""
    if str(b.get("soon", "False")).lower() == "true":
        return None
    held = [slugify(h) for h in (b.get("held_items") or []) if h]
    emblem_links = b.get("emblem_link") or []
    emblems = decode_emblem_link(emblem_links[0], pokedex_to_id) if emblem_links else []
    emblem_names = b.get("emblem_name") or []
    out = {
        "name": b.get("name", "Build"),
        "heldItemIds": held,
        "emblems": emblems,
    }
    if b.get("lane"):
        out["lane"] = b["lane"]
    if emblem_names:
        out["emblemName"] = emblem_names[0]
    if b.get("held_items_optional"):
        out["heldItemOptional"] = slugify(b["held_items_optional"])
    if b.get("battle_item"):
        out["battleItemId"] = slugify(b["battle_item"])
    if b.get("battle_item_optional"):
        out["battleItemOptional"] = slugify(b["battle_item_optional"])
    # UNITE-DB's `upgrade` is sometimes malformed (empty dicts, or an emblem-set
    # name pasted in). Keep only entries that name a real move for this Pokémon.
    final_moves = [m for m in (b.get("upgrade") or []) if isinstance(m, str) and m in valid_moves]
    if final_moves:
        out["moves"] = final_moves
    return out


def _norm_move_name(name: str) -> str:
    n = re.sub(r"\s*\([^)]*\)\s*$", "", name or "")
    return n.lower().replace("'", "").strip()


def build_pokemon(pokemon_rows, stats_rows, pokedex_to_id: dict, descs: dict | None = None) -> list:
    stats_by_name = {p["name"]: p for p in stats_rows}
    if descs is None:
        descs = load_move_descriptions()
    out = []
    for p in pokemon_rows:
        name = p["name"]
        srow = stats_by_name.get(name)
        if not srow or len(srow.get("level", [])) < 15:
            print(f"  ! skipping {name}: missing 15-level stats")
            continue
        tags = p.get("tags") or {}
        skills = p.get("skills") or []
        passive = next((s for s in skills if s.get("ability") == "Passive"), None)
        moves = []
        for s in skills:
            slot = SLOT_MAP.get(s.get("ability", ""))
            if not slot:
                continue
            moves.append(build_move(s, slot, name))
            if slot in ("move1", "move2"):
                for up in (s.get("upgrades") or []):
                    if up.get("name"):
                        moves.append(build_upgrade_move(up, slot, name))
        mega = stats_by_name.get(f"Mega-{name}")
        move_names = {m["name"] for m in moves}
        builds = [nb for b in (p.get("builds") or [])
                  if (nb := build_one_build(b, pokedex_to_id, move_names))]
        exclude = p.get("exclude_stats")
        pid = slugify(name)
        over = descs.get(pid, {})
        if over:
            for m in moves:
                if not (m.get("description") or "").strip():
                    m["description"] = over.get(_norm_move_name(m["name"]), m.get("description", ""))
        passive_desc = (passive or {}).get("description", "") or ""
        if passive and not passive_desc.strip():
            passive_desc = ((passive.get("rsb") or {}).get("true_desc") or "").strip()
        out.append({
            "id": pid,
            "displayName": p.get("display_name", name),
            "role": ROLE_MAP.get(tags.get("role"), "AllRounder"),
            "attackType": "special" if p.get("damage_type") == "Special" else "physical",
            "difficulty": DIFFICULTY_MAP.get(tags.get("difficulty"), 2),
            "imageAsset": f"{ASSETS}/pokemon/portrait/{name}.png",
            "iconAsset": f"{ASSETS}/pokemon/thumbnail/{name}.png",
            "evolutions": [{"level": 1, "formName": p.get("display_name", name)}],
            "baseStatsByLevel": [stat_block(r) for r in srow["level"][:15]],
            "moves": moves,
            "passiveAbility": {
                "id": slugify(passive["name"]) if passive else f"{slugify(name)}-passive",
                "name": passive.get("name", "Passive") if passive else "Passive",
                "description": passive_desc,
                "effects": [],
                **({"iconAsset": skill_icon(name, passive["name"])} if passive and passive.get("name") else {}),
            },
            **({"builds": builds} if builds else {}),
            **({"excludeStats": exclude} if isinstance(exclude, list) and exclude else {}),
            **({"hasMegaEvolution": True,
                "megaStats": [stat_block(r) for r in mega["level"][:15]]} if mega else {}),
        })
    return out


# ---- curated builds overlay ------------------------------------------------

CURATED = HERE / "curated_builds.json"
MOVE_DESCRIPTIONS = HERE / "move_descriptions.json"
VALID_GRADES = {"bronze", "silver", "gold", "platinum"}


def load_move_descriptions() -> dict:
    """Serebii-sourced fallback descriptions, keyed by pokemon id -> normalized
    move name -> description. Empty if the file is absent (scraper not run)."""
    if not MOVE_DESCRIPTIONS.exists():
        print("  (no move_descriptions.json — skipping description backfill)")
        return {}
    return json.loads(MOVE_DESCRIPTIONS.read_text()).get("descriptions", {})


def _validate_curated_build(b, pid, kind, emblem_ids, held_ids, battle_ids, upgrade_moves):
    """Hard-fail on bad ids/grades in a curated build; warn on unknown moves."""
    where = f"{pid} {kind} build {b.get('name', '?')!r}"
    if not isinstance(b.get("name"), str) or not b["name"]:
        raise ValueError(f"{where}: missing required 'name'")
    held = b.get("heldItemIds")
    if not isinstance(held, list):
        raise ValueError(f"{where}: 'heldItemIds' must be a list")
    for hid in held:
        if hid not in held_ids:
            raise ValueError(f"{where}: unknown heldItemId {hid!r}")
    if (v := b.get("heldItemOptional")) is not None and v not in held_ids:
        raise ValueError(f"{where}: unknown heldItemOptional {v!r}")
    for key in ("battleItemId", "battleItemOptional"):
        if (v := b.get(key)) is not None and v not in battle_ids:
            raise ValueError(f"{where}: unknown {key} {v!r}")
    for e in b.get("emblems", []):
        if e.get("emblemId") not in emblem_ids:
            raise ValueError(f"{where}: unknown emblemId {e.get('emblemId')!r}")
        if e.get("grade") not in VALID_GRADES:
            raise ValueError(f"{where}: bad grade {e.get('grade')!r}")
    for mv in b.get("moves", []):
        if mv not in upgrade_moves:
            print(f"  ! {where}: {mv!r} is not an upgrade move for {pid} "
                  f"(kept, but it won't resolve in the UI)")


def apply_curated_builds(pokemon, emblems, held, battle) -> None:
    """Overlay hand-curated builds/creativeBuilds and title renames from
    curated_builds.json onto the normalized Pokémon (mutates in place).

    No-op if the file is absent. Per Pokémon id the overlay may set:
      - "builds": full PokemonBuild list -> REPLACES the Recommended builds.
      - "creativeBuilds": full list -> SET as the Creative tab.
      - "recommendedTitles": [str] -> override emblemName by index on the
        raw-derived Recommended builds (mutually exclusive with "builds").
    Underscore-prefixed keys (e.g. "_comment") are ignored.
    """
    if not CURATED.exists():
        print("  (no curated_builds.json — skipping curation overlay)")
        return
    overlay = json.loads(CURATED.read_text())
    remap = overlay.get("_emblemNameRemap", {})
    for p in pokemon:
        for b in p.get("builds", []):
            rule = remap.get(b.get("emblemName"))
            if rule is None:
                continue
            new = rule if isinstance(rule, str) else rule.get(p["role"])
            if new:
                b["emblemName"] = new
            elif not isinstance(rule, str):
                print(f"  ! {p['id']}: no _emblemNameRemap entry for role {p['role']!r} "
                      f"on label {b.get('emblemName')!r} — left unchanged")
    emblem_ids = {e["id"] for e in emblems}
    held_ids = {h["id"] for h in held}
    battle_ids = {b["id"] for b in battle}
    by_id = {p["id"]: p for p in pokemon}
    moves_by_id = {p["id"]: {m["name"] for m in p["moves"] if m.get("isUpgrade")}
                   for p in pokemon}
    n_rec = n_creative = n_titles = 0
    for pid, spec in overlay.items():
        if pid.startswith("_"):
            continue
        p = by_id.get(pid)
        if p is None:
            raise ValueError(f"curated_builds.json: unknown Pokémon id {pid!r}")
        if "builds" in spec and "recommendedTitles" in spec:
            raise ValueError(f"{pid}: use either 'builds' or 'recommendedTitles', not both")
        if "builds" in spec:
            for b in spec["builds"]:
                _validate_curated_build(b, pid, "recommended", emblem_ids, held_ids, battle_ids, moves_by_id[pid])
            p["builds"] = spec["builds"]
            n_rec += len(spec["builds"])
        if "creativeBuilds" in spec:
            for b in spec["creativeBuilds"]:
                _validate_curated_build(b, pid, "creative", emblem_ids, held_ids, battle_ids, moves_by_id[pid])
            p["creativeBuilds"] = spec["creativeBuilds"]
            n_creative += len(spec["creativeBuilds"])
        if "recommendedTitles" in spec:
            titles = spec["recommendedTitles"]
            existing = p.get("builds", [])
            if len(titles) != len(existing):
                print(f"  ! {pid}: {len(titles)} recommendedTitles but {len(existing)} "
                      f"Recommended builds — applying by index")
            for b, t in zip(existing, titles):
                b["emblemName"] = t
                n_titles += 1
    print(f"  curated overlay: +{n_rec} recommended, +{n_creative} creative, "
          f"{n_titles} titles renamed")


# ---- held items ------------------------------------------------------------

HELD_ITEM_MAX_GRADE = 40


def held_item_factor(level: int) -> float:
    """Grade -> scaling factor for a held-item stat.

    Levels 1-30 scale linearly (factor == level). The level 31-40 grades (added
    in-game when the held-item cap was raised to 40) continue at half rate, so
    factor(30) == 30 and factor(40) == 35 — matching UNITE-DB (e.g. Curse Bangle
    Attack: 0.8*30 = 24 at G30, 0.8*35 = 28 at G40).
    """
    if level <= 30:
        return float(level)
    return 30.0 + 0.5 * (level - 30)


def held_item_value_at(stat: dict, level: int) -> float:
    """Stat value at a grade:  increment * factor(level)/(skip+1) + initial_diff.

    NB: the `float` field is a display-precision hint, NOT a rounding rule for
    the canonical value — Muscle Band's true G40 is 17.5 Attack / 8.75% even
    though float=0/1. We keep full precision and only clean FP noise later.
    """
    incr = num(stat.get("increment"))
    skip = num(stat.get("skip"))
    diff = num(stat.get("initial_diff"))
    return incr * held_item_factor(level) / (skip + 1.0) + diff


def icon_name(item: dict) -> str:
    """UNITE-DB item icons live at <name with spaces -> '+'>.png, using the
    punctuation-free `name` field (e.g. 'Exp Share', not 'Exp. Share')."""
    return item["name"].replace(" ", "+")


def held_item_effect(h: dict) -> dict | None:
    """Structured grade 1/10/20 scaling straight from UNITE-DB's own fields
    (a label + the three breakpoint values), so the UI never parses prose.
    e.g. Muscle Band -> {label: "Remaining HP", tiers: ["1%", "2%", "3%"]}."""
    label = (h.get("description3") or "").strip()
    tiers = [h.get("level1"), h.get("level10"), h.get("level20")]
    if not label or any(t in (None, "") for t in tiers):
        return None
    return {"label": label, "tiers": [str(t).strip() for t in tiers]}


def build_held_items(rows) -> list:
    out = []
    for h in rows:
        name = h["display_name"]
        stats_by_grade: dict[str, dict] = {}
        for level in range(1, HELD_ITEM_MAX_GRADE + 1):
            flats: dict[str, float] = {}
            for s in h.get("stats", []):
                value = held_item_value_at(s, level)
                mapped = map_stat(s.get("label", ""), value)
                if mapped is None:
                    continue
                field, decimal_value = mapped
                flats[field] = round(flats.get(field, 0) + decimal_value, 6)
            if flats:
                stats_by_grade[str(level)] = flats
        item = {
            "id": slugify(h["name"]),
            "displayName": name,
            "iconAsset": f"{ASSETS}/items/held/{icon_name(h)}.png",
            "description": h.get("description1", "") or "",
            "statsByGrade": stats_by_grade,
            "conditionalEffects": [],
        }
        effect = held_item_effect(h)
        if effect:
            item["effect"] = effect
        out.append(item)
    return out


def build_battle_items(rows) -> list:
    return [{
        "id": slugify(b["name"]),
        "displayName": b["display_name"],
        "iconAsset": f"{ASSETS}/items/battle/{icon_name(b)}.png",
        "description": b.get("description", "") or "",
        "effects": [],
    } for b in rows]


# ---- emblems ---------------------------------------------------------------

def emblem_stat_block(stats_list) -> dict:
    out = {}
    for s in stats_list or []:
        for k, v in s.items():
            mapped = map_stat(k, num(v))
            if mapped is None:
                continue
            field, decimal_value = mapped
            out[field] = out.get(field, 0) + decimal_value
    return out


def build_emblems(rows) -> list:
    grouped: dict[str, dict] = {}
    for e in rows:
        key = e.get("pokedex", e["display_name"])
        pokedex = e.get("pokedex", "")
        g = grouped.setdefault(key, {
            "id": f"{pokedex}-{slugify(e['display_name'])}".strip("-"),
            "pokemonName": e["display_name"],
            "colors": [c for c in [COLOR_MAP.get(e.get("color1")), COLOR_MAP.get(e.get("color2"))] if c],
            "iconAsset": f"{ASSETS}/emblems/pokedex/{pokedex}A.png",
            "statsByGrade": {},
            "_sourceGrades": set(),
        })
        grade = GRADE_MAP.get(e.get("grade"))
        if grade:
            g["_sourceGrades"].add(grade)
            g["statsByGrade"][grade] = emblem_stat_block(e.get("stats"))
    out = []
    for g in grouped.values():
        sbg = g["statsByGrade"]
        for grade in ("bronze", "silver", "gold"):
            sbg.setdefault(grade, sbg.get("gold") or sbg.get("silver") or sbg.get("bronze") or {})
        # UNITE-DB only publishes A-grade rows for some newer Pokémon (no silver/bronze).
        g["goldOnly"] = g.pop("_sourceGrades") == {"gold"}
        out.append(g)
    return out


def build_set_bonuses(rows) -> list:
    out = []
    for s in rows:
        color = COLOR_MAP.get(s.get("color"))
        mapped = map_stat(s.get("stat", ""), 0)
        stat_field = mapped[0] if mapped else "hp"  # placeholder for color w/o StatBlock stat
        sign = -1.0 if s.get("math") == "sub" else 1.0
        out.append({
            "color": color,
            "stat": stat_field,
            "thresholds": {
                str(int(s["count1"])): sign * num(s.get("bonus1")) / 100.0,
                str(int(s["count2"])): sign * num(s.get("bonus2")) / 100.0,
                str(int(s["count3"])): sign * num(s.get("bonus3")) / 100.0,
            },
        })
    return out


# ---- main ------------------------------------------------------------------

def main() -> None:
    emblems = build_emblems(load("emblems"))
    # pokedex number (e.g. "250") -> emblem id (e.g. "250-ho-oh"), for decoding builds.
    pokedex_to_id = {e["id"].split("-", 1)[0]: e["id"] for e in emblems}
    pokemon = build_pokemon(load("pokemon"), load("stats"), pokedex_to_id)
    held = build_held_items(load("held_items"))
    battle = build_battle_items(load("battle_items"))
    set_bonuses = build_set_bonuses(load("emblem_sets"))
    apply_curated_builds(pokemon, emblems, held, battle)

    bundle = {
        "patchVersion": PATCH_VERSION,
        "lastUpdated": date.today().isoformat(),
        "dataSource": {
            "provider": "UNITE-DB",
            "url": "https://unite-db.com",
            "note": "Community-sourced (APK bundles encrypted; see tools/extract/ENCRYPTION-FINDINGS.md). "
                    "Held-item values span grades 1–40 (in-game max 40). Percentages stored as decimals.",
            "fetched": date.today().isoformat(),
        },
        "pokemon": pokemon,
        "heldItems": held,
        "battleItems": battle,
        "emblems": emblems,
        "setBonuses": set_bonuses,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")
    print(f"\nWrote {OUT}")
    print(f"  pokemon={len(pokemon)} heldItems={len(held)} battleItems={len(battle)} "
          f"emblems={len(emblems)} setBonuses={len(set_bonuses)}")


if __name__ == "__main__":
    main()
