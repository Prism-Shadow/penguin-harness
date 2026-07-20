/**
 * Language context: zh / en / system (tracks navigator.language, listens for languagechange).
 * On switch, first synchronously calls setActiveStrings (assigned during render, idempotent),
 * then remounts the whole tree keyed on locale so every `S.x` read immediately reflects the
 * new language; the preference persists to localStorage.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { setActiveStrings, zh } from "../lib/strings";
import { en } from "../lib/strings-en";

export type LangPref = "zh" | "en" | "system";
export type Locale = "zh" | "en";

const STORAGE_KEY = "penguin.lang";

interface LocaleContextValue {
  lang: LangPref;
  locale: Locale;
  setLang: (lang: LangPref) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Device language → UI language (default when no stored preference exists; also applies on the
 * login page): a language tag starting with zh (zh-CN/zh-TW…) → zh; anything else or
 * unavailable → falls back to en. Exported as a pure function for unit tests (test/locale.test.ts).
 */
export function resolveSystemLocale(language: string | undefined): Locale {
  return language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function systemLocale(): Locale {
  return resolveSystemLocale(navigator.language);
}

function resolve(lang: LangPref): Locale {
  return lang === "system" ? systemLocale() : lang;
}

function initialLang(): LangPref {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "zh" || stored === "en" || stored === "system") return stored;
  return "system";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangPref>(initialLang);
  // Re-resolution signal for browser language changes while in system mode.
  const [, setSysTick] = useState(0);

  const locale = resolve(lang);
  // Switch the active dictionary during render (idempotent assignment): children are keyed on
  // locale and render after this component, so they always read the post-switch dictionary.
  setActiveStrings(locale === "en" ? en : zh);

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
