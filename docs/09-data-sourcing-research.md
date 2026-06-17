# Data Sourcing Research — where UNITE data actually comes from

Research into how unite-db.com and uniteapi.dev obtain their Pokémon UNITE data,
and what that means for keeping FoxForge GG updated. (Findings as of June 2026.)

## TL;DR
- **No official API exists.** Nintendo/TiMi publish no "gamemaster" data file; every
  community tool either **datamines the APK** or **hand-curates** values.
- **unite-db.com** = datamined game *constants* (stats/items/emblems) + manually curated
  builds & patch notes. This is our source today.
- **uniteapi.dev** = *match/meta analytics* (win/pick rates, tiers) aggregated from live
  games — **not** datamined constants. Different category; not useful for our stat/item data.
- The canonical "extract from the game" route is **APK datamining** (kwsch/UntieUnite):
  decrypt → decompress → decode protobuf "databins". We already hit the wall here (rotated
  v1.23.x keys + re-encrypted metadata — see `tools/extract/ENCRYPTION-FINDINGS.md`).

## Sources, in detail

### uniteapi.dev — match/meta analytics (not constants)
The meta page (<https://uniteapi.dev/en/meta>) states "Data from <date> to <date>
(N games analyzed)" — win rates, pick rates, tier lists from **played matches**, not
extracted files. Relevant only if we later add a *meta/tier* overlay; it does not provide
base stats, item, or emblem values. Footer: "Not affiliated with Nintendo or TPC."

### unite-db.com — curated datamined constants + builds (our source)
Maintains the stats/items/emblems database + curated builds + patch notes. Community
consensus and UNITE-DB's own notes ("we spend many hours collecting this data") indicate
the values are **datamined from the APK and then hand-curated**. Delivered as static JSON
(Nuxt) — our `tools/community/fetch.py` already pulls `/pokemon.json`, `/held_items.json`,
`/emblems.json`, `/battle_items.json`, `/stats.json`, `/emblem_sets.json`; art from their
CloudFront CDN. An unofficial wrapper exists: <https://github.com/jaynewey/py-unite-db>.

### The upstream process — APK datamining (kwsch/UntieUnite)
<https://github.com/kwsch/UntieUnite> is the reference pipeline everyone depends on:
1. The game **downloads DLC content at runtime** to `assets/DlcRoot/<ver>/DLC_0` containing
   `ResMapPb` (resource map), **`Databins.zip` (protobuf tables = the real stat/item/emblem
   numbers)**, `LanguageMap`, and Lua.
2. UntieUnite **decrypts** (the XOR-on-metadata scheme — ported in `tools/extract/bundle_crypto.py`),
   **decompresses, and exports**; numeric tables are **protobuf databins** decoded with `.proto` defs.
3. `global-metadata.dat` (via Il2CppInspector/Il2CppDumper) supplies type/field names.

**Blocker (already documented):** the 2021-era keys don't decrypt v1.23.x bundles and
`global-metadata.dat` is re-encrypted. Reviving this needs recovering the *current* keys
(e.g. Il2CppInspector / Frida hooking a running or emulated client).

### Alternate community data repos (cross-check / fallback)
- <https://github.com/Pokebag/pokemon-unite-data>
- <https://github.com/hiramr97/unite-database>
- <https://github.com/pvpoke/pvpoke-unite>

## Plan for FoxForge GG updates (tiered)

**Tier 1 — Keep UNITE-DB as primary (recommended; already built).** Best-curated, includes
builds. Harden: pin endpoints, zod-validate on fetch (done), **alert on schema drift**, add a
**diff/changelog** in `normalize.py`, keep crediting UNITE-DB. `data.yml` automates the refresh.

**Tier 2 — Add a second community source as cross-check/fallback** (low effort, high
resilience). Pull one of the repos above, compare key values (e.g. Lucario Lv15 = HP 7249 /
Atk 429), flag mismatches. Removes single-source risk.

**Tier 3 — First-party APK datamining (independence; high effort, ongoing).** Revive
`tools/extract/` only to be source-independent: recover current AssetCrypto XOR keys +
`global-metadata` decryption from `libil2cpp.so` (Il2CppInspector / Frida), then decode the
protobuf databins with updated `.proto` defs. Must be redone whenever TiMi rotates keys —
treat as a stretch goal, not the update path.

**Tier 4 — Meta layer (optional, new capability).** Win/pick-rate / tier data (uniteapi.dev
style) comes from match aggregation we can't easily produce; we'd consume a community feed.
Separate feature, out of scope for game constants.

**Recommendation:** Tier 1 + Tier 2 for resilient, low-maintenance updates; keep Tier 3
documented as the "go fully independent" fallback. All of this is unofficial community
tooling — credit sources, rate-limit politely, personal/educational use.
