import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { api, must, type Settings } from "../api/client";
import { direction, locale, translator, type Language, type Translate } from "../i18n";

type Context = {
  language: Language;
  theme: Settings["theme"];
  ai: Settings["ai"];
  locale: string;
  t: Translate;
  /** Save settings at once; resolves to the error when the service refuses, after undoing the change. */
  change: (values: Partial<Settings>) => Promise<unknown>;
};

const SettingsContext = createContext<Context | null>(null);
const DEFAULTS: Settings = { language: "en", theme: "system", ai: null };

/** Language, theme and AI choice, kept by the service so they survive a restart, applied to the whole page. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const { data = DEFAULTS } = useQuery({ queryKey: ["settings"], queryFn: () => must(api.GET("/settings")) });
  const { mutateAsync } = useMutation({
    mutationFn: (values: Partial<Settings>) => must(api.PATCH("/settings", { body: values })),
    onMutate: (values) => {
      const before = client.getQueryData<Settings>(["settings"]);
      client.setQueryData<Settings>(["settings"], { ...DEFAULTS, ...before, ...values });
      return before;
    },
    onError: (_error, _values, before) => client.setQueryData(["settings"], before),
    onSuccess: (saved) => client.setQueryData(["settings"], saved),
  });

  useEffect(() => {
    const root = document.documentElement;
    root.lang = data.language;
    root.dir = direction(data.language);
    root.dataset.theme = data.theme;
  }, [data.language, data.theme]);

  const value = useMemo<Context>(
    () => ({
      language: data.language,
      theme: data.theme,
      ai: data.ai,
      locale: locale(data.language),
      t: translator(data.language),
      change: (values) => mutateAsync(values).then(
        () => undefined,
        (error: unknown) => error,
      ),
    }),
    [data.language, data.theme, data.ai, mutateAsync],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Context {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings needs a SettingsProvider");
  return context;
}
