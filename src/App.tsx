import { useState } from "react";
import { StoreProvider, useStore } from "./state/store";
import { pokemonById } from "./data/gameData";
import { ROLE_COLOR, ROLE_LABEL } from "./ui/theme";
import { asset } from "./ui/asset";
import { PokemonPicker } from "./components/PokemonPicker";
import { LoadoutEditor } from "./components/LoadoutEditor";
import { StatPanel } from "./components/StatPanel";
import { LoadoutBar } from "./components/LoadoutBar";
import { CompareView } from "./components/CompareView";
import { LevelGraph } from "./components/LevelGraph";
import { RecommendPanel } from "./components/RecommendPanel";
import { InventoryManager } from "./components/InventoryManager";

type Tab = "build" | "compare";
type Page = "app" | "inventory";

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 rounded-xl bg-white/15 p-1">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition ${
            value === o ? "bg-surface text-accent-ink shadow" : "text-white/90 hover:bg-white/10"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function Header({ tab, setTab, page, setPage }: { tab: Tab; setTab: (t: Tab) => void; page: Page; setPage: (p: Page) => void }) {
  const { loadout, mode, setMode, expert, theme, setTheme } = useStore();
  const p = loadout.pokemonId ? pokemonById.get(loadout.pokemonId) : null;
  const role = p ? ROLE_COLOR[p.role] : null;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-gradient-to-r from-[var(--color-header-a)] to-[var(--color-header-b)] text-white shadow-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        {p ? (
          <img src={asset(p.imageAsset)} alt={p.displayName} className="h-12 w-12 rounded-full bg-white/20 object-cover ring-2 ring-white/50" />
        ) : (
          <div className="h-12 w-12 rounded-full bg-white/20" />
        )}
        <div className="flex-1">
          <h1 className="text-lg font-bold leading-tight">Pokémon UNITE Build Optimizer</h1>
          <div className="flex items-center gap-2 text-xs text-indigo-100">
            {p ? (
              <>
                <span className="font-medium">{p.displayName}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${role!.bg} ${role!.text}`}>{ROLE_LABEL[p.role]}</span>
                <span className="capitalize">{p.attackType}</span>
              </>
            ) : (
              "Select a Pokémon to begin"
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Segmented value={theme} options={["light", "dark"]} onChange={setTheme} />
          <button
            onClick={() => setPage(page === "inventory" ? "app" : "inventory")}
            className="rounded-xl bg-white/15 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/25"
          >
            {page === "inventory" ? "← Builder" : "★ Emblems"}
          </button>
          {page === "app" && <Segmented value={mode} options={["beginner", "expert"]} onChange={setMode} />}
          {page === "app" && expert && <Segmented value={tab} options={["build", "compare"]} onChange={setTab} />}
        </div>
      </div>
    </header>
  );
}

function Workspace() {
  const [tab, setTab] = useState<Tab>("build");
  const [page, setPage] = useState<Page>("app");
  const { expert } = useStore();
  const activeTab: Tab = expert ? tab : "build";
  return (
    <div className="min-h-screen bg-bg text-ink">
      <Header tab={tab} setTab={setTab} page={page} setPage={setPage} />
      <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
        {page === "inventory" ? (
          <InventoryManager />
        ) : activeTab === "build" ? (
          <>
            <RecommendPanel />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
              <div className="flex flex-col gap-4">
                <PokemonPicker />
                <LoadoutEditor />
                <LoadoutBar />
              </div>
              <StatPanel />
            </div>
            {expert && <LevelGraph />}
          </>
        ) : (
          <CompareView />
        )}
      </main>
      <footer className="mx-auto max-w-6xl px-6 pb-8 pt-2 text-center text-xs text-faint">
        Data from UNITE-DB · attack-speed model from community calculator · patch 1.23.1.1
        {!expert && <> · switch to <span className="font-medium">Expert</span> for attack speed, graphs & compare</>}
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Workspace />
    </StoreProvider>
  );
}
