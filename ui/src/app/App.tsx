import { useState } from "react";
import { About } from "../about/About";
import { History } from "../history/History";
import { Home } from "../home/Home";
import type { Key } from "../i18n";
import { SettingsPage } from "../settings/SettingsPage";
import { Logo } from "./Logo";
import { useSettings } from "./settings";

type Tab = "home" | "history" | "settings" | "about";
const TABS: Tab[] = ["home", "history", "settings", "about"];

export function App() {
  const { t, language, change } = useSettings();
  const [tab, setTab] = useState<Tab>("home");
  const [projectId, setProjectId] = useState<string | null>(null);

  const open = (id: string) => {
    setProjectId(id);
    setTab("home");
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-8 border-b border-line px-7">
        <span className="flex items-center gap-2 text-[19px] font-semibold">
          <Logo size={22} />
          {t("app.name")}
        </span>
        <nav aria-label={t("tabs.label")} className="flex h-full gap-6">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              aria-current={tab === name ? "page" : undefined}
              onClick={() => setTab(name)}
              className={`h-full border-b-2 ${tab === name ? "border-ink font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
            >
              {t(`tab.${name}` as Key)}
            </button>
          ))}
        </nav>
        <button
          type="button"
          lang={language === "en" ? "ar" : "en"}
          onClick={() => change({ language: language === "en" ? "ar" : "en" })}
          className="ms-auto text-ink-2 hover:text-ink"
        >
          {t("language.other")}
        </button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {tab === "home" && (
          <Home
            projectId={projectId}
            onOpen={open}
            onClose={() => setProjectId(null)}
            onOpenSettings={() => setTab("settings")}
          />
        )}
        {tab === "history" && <History onOpen={open} />}
        {tab === "settings" && <SettingsPage />}
        {tab === "about" && <About />}
      </main>
    </div>
  );
}
