import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { StoreProvider, useStore } from "./state/store";
import { pokemonById } from "./data/gameData";
import { ROLE_COLOR, ROLE_LABEL } from "./ui/theme";
import { asset } from "./ui/asset";
import { AppBar } from "./components/shell/AppBar";
import { TabBar, TAB_ICONS, type Tab } from "./components/shell/TabBar";
import { BuildScreen } from "./components/screens/BuildScreen";
import { PokemonPickerSheet } from "./components/PokemonPicker";
import { CompareScreen } from "./components/screens/CompareScreen";
import { EmblemsScreen } from "./components/screens/EmblemsScreen";
import { ItemsScreen } from "./components/screens/ItemsScreen";
import { SettingsMenu } from "./components/SettingsMenu";
import { isTauri, autoUpdateEnabled, checkAppUpdate } from "./ui/runtime";

const TAB_KEY = "unite-build-optimizer.tab.v1";
const VALID_TABS: Tab[] = ["build", "compare", "emblems", "items"];

const ALL_TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "build", label: "Build", icon: TAB_ICONS.build },
  { id: "emblems", label: "Emblems", icon: TAB_ICONS.emblems },
  { id: "items", label: "Items", icon: TAB_ICONS.items },
  { id: "compare", label: "Compare", icon: TAB_ICONS.compare },
];

function usePersistentTab(): [Tab, (t: Tab) => void] {
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      const stored = localStorage.getItem(TAB_KEY);
      if (stored && VALID_TABS.includes(stored as Tab)) return stored as Tab;
    } catch {
      /* quota */
    }
    return "build";
  });

  const setTab = useCallback((t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* quota */
    }
  }, []);

  return [tab, setTab];
}

function Workspace() {
  const { loadout, mode, setMode, expert } = useStore();
  const [tab, setTab] = usePersistentTab();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pokePickerOpen, setPokePickerOpen] = useState(false);
  const [dataUpdate, setDataUpdate] = useState<string | null>(null);

  const tabs = expert ? ALL_TABS : ALL_TABS.filter((t) => t.id !== "compare");

  useEffect(() => {
    if (!expert && tab === "compare") setTab("build");
  }, [expert, tab, setTab]);

  useEffect(() => {
    const onData = (e: Event) => setDataUpdate((e as CustomEvent).detail?.patch ?? null);
    window.addEventListener("unite-data-updated", onData);
    if (isTauri && autoUpdateEnabled()) void checkAppUpdate(true);
    return () => window.removeEventListener("unite-data-updated", onData);
  }, []);

  const p = loadout.pokemonId ? pokemonById.get(loadout.pokemonId) : null;
  const role = p ? ROLE_COLOR[p.role] : null;

  const appBarProps = useMemo(() => {
    if (tab === "build") {
      return {
        leading: p ? (
          <img
            src={asset(p.imageAsset)}
            alt={p.displayName}
            className="h-10 w-10 shrink-0 rounded-full bg-black/10 object-cover ring-2 ring-[var(--color-appbar-border)]"
          />
        ) : (
          <div className="h-10 w-10 shrink-0 rounded-full bg-black/10" />
        ),
        title: p?.displayName ?? "Select Pokémon",
        subtitle: p ? (
          <span className="flex items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${role!.bg} ${role!.text}`}>
              {ROLE_LABEL[p.role]}
            </span>
            <span className="capitalize">{p.attackType}</span>
          </span>
        ) : undefined,
        onTitleTap: () => setPokePickerOpen(true),
      };
    }

    const titles: Record<Exclude<Tab, "build">, string> = {
      compare: "Compare",
      emblems: "Emblems",
      items: "Held Items",
    };

    return {
      leading: undefined,
      title: titles[tab as Exclude<Tab, "build">],
      subtitle: undefined,
      onTitleTap: undefined,
    };
  }, [tab, p, role]);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <AppBar
        {...appBarProps}
        onSettings={() => setSettingsOpen(true)}
        mode={mode}
        onModeChange={setMode}
      />
      <main className="mx-auto w-full max-w-2xl px-3 pb-[calc(64px+env(safe-area-inset-bottom))] pt-[calc(3.5rem+env(safe-area-inset-top)+0.5rem)]">
        {dataUpdate && (
          <div className="mb-2 bg-accent px-4 py-2 text-center text-sm text-white">
            New game data (patch {dataUpdate}) is ready.{" "}
            <button type="button" onClick={() => location.reload()} className="font-semibold underline">
              Reload to apply
            </button>
          </div>
        )}
        {tab === "build" && <BuildScreen onOpenPokePicker={() => setPokePickerOpen(true)} />}
        {tab === "compare" && expert && <CompareScreen />}
        {tab === "emblems" && <EmblemsScreen />}
        {tab === "items" && <ItemsScreen />}
      </main>
      <TabBar active={tab} onChange={setTab} tabs={tabs} />
      <SettingsMenu open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {pokePickerOpen && <PokemonPickerSheet onClose={() => setPokePickerOpen(false)} />}
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
