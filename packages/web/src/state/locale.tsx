/** Locale context with persisted preferences and a remount boundary. */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { setActiveStrings } from "../lib/strings";
import { en } from "../lib/strings-en";

const DICTIONARIES = { en };
export type Locale = keyof typeof DICTIONARIES;
export type LangPref = Locale | "system";

const STORAGE_KEY = "penguin.lang";

interface LocaleContextValue {
  lang: LangPref;
  locale: Locale;
  setLang: (lang: LangPref) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/** Unsupported device languages use the default English dictionary. */
export function resolveSystemLocale(language: string | undefined): Locale {
  const candidate = language?.toLowerCase().split("-")[0] ?? "en";
  return Object.hasOwn(DICTIONARIES, candidate) ? (candidate as Locale) : "en";
}

function systemLocale(): Locale {
  return resolveSystemLocale(navigator.language);
}

function resolve(lang: LangPref): Locale {
  return lang === "system" ? systemLocale() : lang;
}

function initialLang(): LangPref {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "system") return stored;
  return "system";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangPref>(initialLang);
  // Re-resolution signal for browser language changes while in system mode.
  const [, setSysTick] = useState(0);

  const locale = resolve(lang);
  // Switch the active dictionary during render (idempotent assignment): children are keyed on
  // locale and render after this component, so they always read the post-switch dictionary.
  setActiveStrings(DICTIONARIES[locale]);

  useEffect(() => {
    if (lang !== "system") return;
    const onChange = () => setSysTick((t) => t + 1);
    window.addEventListener("languagechange", onChange);
    return () => window.removeEventListener("languagechange", onChange);
  }, [lang]);

  const setLang = useCallback((next: LangPref) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLangState(next);
  }, []);

  return (
    <LocaleContext.Provider value={{ lang, locale, setLang }}>{children}</LocaleContext.Provider>
  );
}

/**
 * Language scope: a remount boundary keyed on locale. Placed **inside** AuthProvider —
 * switching language only rebuilds the UI tree, not the auth state (otherwise user=undefined
 * would cause a full-screen flash).
 */
export function LocaleScope({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  return (
    <div key={locale} className="contents">
      {children}
    </div>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within a LocaleProvider");
  return ctx;
}
