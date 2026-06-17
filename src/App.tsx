import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./state/store";
import { pokemonById } from "./data/gameData";
import { ROLE_COLOR, ROLE_LABEL } from "./ui/theme";
import { asset } from "./ui/asset";
import { PokemonPicker } from "./components/PokemonPicker";
import { LoadoutEditor } from "./components/LoadoutEditor";
import { MovesCard } from "./components/MovesCard";
import { StatPanel } from "./components/StatPanel";
import { LoadoutBar } from "./components/LoadoutBar";
import { CompareView } from "./components/CompareView";
import { LevelGraph } from "./components/LevelGraph";
import { RecommendPanel } from "./components/RecommendPanel";
import { InventoryManager } from "./components/InventoryManager";
import { HeldItemsInventory } from "./components/HeldItemsInventory";
import { SettingsMenu } from "./components/SettingsMenu";
import { isTauri, autoUpdateEnabled, checkAppUpdate } from "./ui/runtime";
import { APP_NAME, APP_TAGLINE, LEGAL_DISCLAIMER, copyrightLine } from "./ui/brand";

type Tab = "build" | "compare";
type Page = "app" | "emblems" | "heldItems";

function Segmented<T extends string>({
  value, options, onChange, disabled = false, title,
}: { value: T; options: T[]; onChange: (v: T) => void; disabled?: boolean; title?: string }) {
  return (
    <div title={title} className={`flex gap-1 rounded-xl bg-white/15 p-1 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}>
      {options.map((o) => (
        <button
          key={o}
          disabled={disabled}
          onClick={() => onChange(o)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition ${
            value === o ? "bg-surface text-accent-ink shadow" : "text-white/90 hover:bg-white/10"
          } ${disabled ? "pointer-events-none" : ""}`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function GearIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function Header({ tab, setTab, page, setPage }: { tab: Tab; setTab: (t: Tab) => void; page: Page; setPage: (p: Page) => void }) {
  const { loadout, mode, setMode, expert } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const p = loadout.pokemonId ? pokemonById.get(loadout.pokemonId) : null;
  const role = p ? ROLE_COLOR[p.role] : null;
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-gradient-to-r from-[var(--color-header-a)] to-[var(--color-header-b)] text-white shadow-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          {p ? (
            <img src={asset(p.imageAsset)} alt={p.displayName} className="h-12 w-12 rounded-full bg-white/20 object-cover ring-2 ring-white/50" />
          ) : (
            <div className="h-12 w-12 rounded-full bg-white/20" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold leading-tight">{APP_NAME}</h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-indigo-100">
              {p ? (
                <>
                  <span className="font-medium">{p.displayName}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${role!.bg} ${role!.text}`}>{ROLE_LABEL[p.role]}</span>
                  <span className="capitalize">{p.attackType}</span>
                </>
              ) : (
                APP_TAGLINE
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => setPage("emblems")}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium text-white hover:bg-white/25 ${page === "emblems" ? "bg-white/25" : "bg-white/15"}`}
            >
              ★ Emblems
            </button>
            <button
              onClick={() => setPage("heldItems")}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium text-white hover:bg-white/25 ${page === "heldItems" ? "bg-white/25" : "bg-white/15"}`}
            >
              Held Items
            </button>
            {page !== "app" && (
              <button
                onClick={() => setPage("app")}
                className="rounded-xl bg-white/15 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/25"
              >
                ← Builder
              </button>
            )}
            {page === "app" && <Segmented value={mode} options={["beginner", "expert"]} onChange={setMode} />}
            {page === "app" && (
              <Segmented
                value={expert ? tab : "build"}
                options={["build", "compare"]}
                onChange={setTab}
                disabled={!expert}
                title={expert ? undefined : "Switch to Expert mode to compare builds"}
              />
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Settings"
              title="Settings"
              className="rounded-xl bg-white/15 p-2 text-white hover:bg-white/25"
            >
              <GearIcon />
            </button>
          </div>
        </div>
      </header>
      <SettingsMenu open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

function Workspace() {
  const [tab, setTab] = useState<Tab>("build");
  const [page, setPage] = useState<Page>("app");
  const [dataUpdate, setDataUpdate] = useState<string | null>(null);
  const { expert } = useStore();
  const activeTab: Tab = expert ? tab : "build";

  useEffect(() => {
    const onData = (e: Event) => setDataUpdate((e as CustomEvent).detail?.patch ?? null);
    window.addEventListener("unite-data-updated", onData);
    if (isTauri && autoUpdateEnabled()) void checkAppUpdate(true); // silent auto-update on launch
    return () => window.removeEventListener("unite-data-updated", onData);
  }, []);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <Header tab={tab} setTab={setTab} page={page} setPage={setPage} />
      {dataUpdate && (
        <div className="bg-accent px-4 py-2 text-center text-sm text-white">
          New game data (patch {dataUpdate}) is ready.{" "}
          <button onClick={() => location.reload()} className="font-semibold underline">Reload to apply</button>
        </div>
      )}
      <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 sm:p-6">
        {page === "emblems" ? (
          <InventoryManager />
        ) : page === "heldItems" ? (
          <HeldItemsInventory />
        ) : activeTab === "build" ? (
          <>
            <RecommendPanel />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
              <div className="flex flex-col gap-4">
                <PokemonPicker />
                <LoadoutEditor />
                <MovesCard />
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
        <p>
          Data from UNITE-DB · attack-speed model from community calculator · patch 1.23.1.1
          {!expert && <> · switch to <span className="font-medium">Expert</span> for attack speed, graphs & compare</>}
        </p>
        <p className="mx-auto mt-3 max-w-3xl leading-relaxed">{LEGAL_DISCLAIMER}</p>
        <p className="mt-2">{copyrightLine()}</p>
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
