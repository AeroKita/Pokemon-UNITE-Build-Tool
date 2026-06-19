import { useRef, useState } from "react";
import { useStore } from "../state/store";
import { pokemonById } from "../data/gameData";
import {
  MAX_SAVED_LOADOUTS,
  loadoutToFileJSON,
  parseLoadoutFile,
  loadoutFileName,
} from "../state/loadout";
import { asset } from "../ui/asset";
import { CollapsibleCard } from "./CollapsibleCard";

export function LoadoutBar() {
  const { loadout, saved, save, remove, loadSaved, saveError, dispatch, shareUrl } = useStore();
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const exportFile = () => {
    const pokemon = loadout.pokemonId ? pokemonById.get(loadout.pokemonId) : null;
    const blob = new Blob([loadoutToFileJSON(loadout)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = loadoutFileName(loadout, pokemon?.displayName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file) return;
    try {
      const parsed = parseLoadoutFile(await file.text());
      if (!parsed) {
        setImportMsg("Not a valid loadout file.");
        return;
      }
      dispatch({ type: "load", loadout: parsed });
      setImportMsg("Loadout imported ✓");
      setTimeout(() => setImportMsg(null), 2000);
    } catch {
      setImportMsg("Couldn't read that file.");
    }
  };

  const handleSave = () => {
    const pokemon = loadout.pokemonId ? pokemonById.get(loadout.pokemonId) : null;
    save(name.trim() || `${pokemon?.displayName ?? "Build"} ${saved.length + 1}`);
    setName("");
  };

  return (
    <CollapsibleCard title="Save & Load" persistKey="loadouts" defaultOpen={false}>
      <div className="mb-3 flex items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Loadout name…"
          className="min-h-11 flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={handleSave}
          disabled={!loadout.pokemonId || saved.length >= MAX_SAVED_LOADOUTS}
          className="min-h-11 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-40"
        >
          Save
        </button>
      </div>
      {saveError && <p className="mb-2 text-xs text-neg">{saveError}</p>}
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          onClick={share}
          disabled={!loadout.pokemonId}
          className="min-h-11 flex-1 rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-ink hover:bg-raise disabled:opacity-40"
        >
          {copied ? "Link copied ✓" : "Share build"}
        </button>
        <button
          onClick={() => dispatch({ type: "reset" })}
          className="min-h-11 rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-muted hover:bg-neg/10 hover:text-neg"
        >
          Clear
        </button>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <button
          onClick={exportFile}
          disabled={!loadout.pokemonId}
          title="Download this loadout as a .json file to share"
          className="min-h-11 flex-1 rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-ink hover:bg-raise disabled:opacity-40"
        >
          ↓ Export
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Load a loadout from a .json file"
          className="min-h-11 flex-1 rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-ink hover:bg-raise"
        >
          ↑ Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={importFile}
          className="hidden"
        />
      </div>
      {importMsg && <p className="mb-2 text-xs text-muted">{importMsg}</p>}
      <div className="mb-1 flex items-center justify-between text-xs text-faint">
        <span>Saved loadouts</span>
        <span>
          {saved.length}/{MAX_SAVED_LOADOUTS}
        </span>
      </div>
      {saved.length === 0 ? (
        <p className="text-sm text-faint">No saved loadouts yet.</p>
      ) : (
        <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {saved.map((s) => {
            const p = s.pokemonId ? pokemonById.get(s.pokemonId) : null;
            return (
              <li
                key={s.id}
                className="flex min-h-11 items-center gap-2 rounded-lg border border-line-soft px-3 py-1"
              >
                {p && <img src={asset(p.iconAsset)} alt="" className="h-7 w-7 object-contain" />}
                <span className="flex-1 truncate text-sm text-ink">{s.name}</span>
                <button
                  onClick={() => loadSaved(s)}
                  className="min-h-11 min-w-11 rounded-lg px-2 text-sm font-medium text-accent-ink hover:bg-accent-weak"
                >
                  Load
                </button>
                <button
                  onClick={() => remove(s.id)}
                  className="min-h-11 min-w-11 rounded-lg px-2 text-sm text-neg hover:bg-neg/10"
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </CollapsibleCard>
  );
}
