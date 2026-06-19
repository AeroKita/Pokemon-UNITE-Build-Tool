import { bundle } from "../data/gameData";
import { cachedPatchVersion } from "../data/dataSource";
import { useStore, type ThemePref } from "../state/store";
import { APP_NAME, APP_OWNER, LEGAL_DISCLAIMER, copyrightLine } from "../ui/brand";
import { APP_VERSION } from "../ui/version";
import { BottomSheet } from "./shell/BottomSheet";

const THEME_PREFS: { id: ThemePref; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/**
 * App settings, opened from the header gear. Houses appearance (theme) + all
 * update controls (game data + app version info).
 * Adding a setting = drop another <Section> below — the sheet scrolls.
 */
export function SettingsMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { themePref, setThemePref } = useStore();
  const activePatch = cachedPatchVersion() ?? bundle.patchVersion;

  if (!open) return null;

  return (
    <BottomSheet title="Settings" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Section title="Appearance">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Theme</span>
            <div className="inline-flex gap-1 rounded-xl border border-line bg-raise p-1">
              {THEME_PREFS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setThemePref(id)}
                  className={`min-h-11 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    themePref === id
                      ? "bg-surface text-accent-ink shadow"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Updates">
          {/* Game data — all platforms */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Game data</span>
            <span className="font-mono text-xs text-faint">patch {activePatch}</span>
          </div>
          <p className="text-xs text-faint">
            Data: UNITE-DB · Serebii — fan project, not affiliated with Nintendo/TPC.
          </p>

          {/* App version — web/PWA only */}
          <div className="mt-3 border-t border-line-soft pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">App version</span>
              <span className="font-mono text-xs text-faint">v{APP_VERSION}</span>
            </div>
            <p className="mt-2 text-xs text-faint">
              The app auto-updates on reload. Install it from your browser ("Add to Home Screen" /
              "Install") for an offline-capable window.
            </p>
          </div>
        </Section>

        <Section title="About">
          <p className="text-sm font-medium">{APP_NAME}</p>
          <p className="mt-0.5 text-xs text-muted">Created by {APP_OWNER}</p>
        </Section>

        <Section title="Legal">
          <p className="text-xs text-faint">
            Data from UNITE-DB · attack-speed model from community calculator · patch {activePatch}
          </p>
          <p className="mx-auto mt-3 max-w-3xl text-xs leading-relaxed text-muted">
            {LEGAL_DISCLAIMER}
          </p>
          <p className="mt-2 text-xs text-faint">{copyrightLine()}</p>
        </Section>
      </div>
    </BottomSheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-bg/40 p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}
