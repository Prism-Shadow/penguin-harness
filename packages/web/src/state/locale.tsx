/**
 * Language context: zh / en / system (tracks navigator.language, listens for languagechange).
 * On switch, first synchronously calls setActiveStrings (assigned during render, idempotent),
 * then remounts the whole tree keyed on locale so every `S.x` read immediately reflects the
 * new language; the preference follows the account, cached in this browser (locale-pref.ts) and
 * re-read when the account's copy arrives (lib/account-sync). The shared UI package's accessibility
 * fallbacks (a close cross's name, a "Copied" announcement) are handed the same language here.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { UiStringsProvider } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../lib/strings";
import { en } from "../lib/strings-en";
import { uiStringsFor } from "../lib/ui-strings";
import { subscribeAccountApplied, writeCached } from "../lib/account-sync/cache";
import { LANG_KEY, readLangPref } from "./locale-pref";
import type { LangPref } from "./locale-pref";

export type { LangPref };
export type Locale = "zh" | "en";

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

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangPref>(() => readLangPref());
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

  // The account's language replaced the cached one at sign-in.
  useEffect(() => subscribeAccountApplied(() => setLangState(readLangPref())), []);

  const setLang = useCallback((next: LangPref) => {
    writeCached(LANG_KEY, next);
    setLangState(next);
  }, []);

  return (
    <LocaleContext.Provider value={{ lang, locale, setLang }}>
      <UiStringsProvider strings={uiStringsFor(locale)}>{children}</UiStringsProvider>
    </LocaleContext.Provider>
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
