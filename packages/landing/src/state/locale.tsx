/**
 * Language context: zh / en / system (tracks navigator.language). On switch it first
 * synchronously calls setActiveStrings, then remounts the tree keyed on locale so every
 * `S.x` read reflects the new language; the preference persists to localStorage.
 * Same pattern as the Web App.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { LANG_KEY, readPref, subscribePref, writePref } from "./site-prefs";
import { setActiveStrings, zh } from "../lib/strings";
import { en } from "../lib/strings-en";

export type LangPref = "zh" | "en" | "system";
export type Locale = "zh" | "en";

const LANG_PREFS = ["zh", "en", "system"] as const;

interface LocaleContextValue {
  lang: LangPref;
  locale: Locale;
  setLang: (lang: LangPref) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/** Device language -> UI language: zh* -> zh, anything else -> en. */
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
  return readPref<LangPref>(LANG_KEY, LANG_PREFS) ?? "system";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangPref>(initialLang);
  const [, setSysTick] = useState(0);

  const locale = resolve(lang);
  // Switch the active dictionary during render (idempotent): children are keyed on
  // locale and render after this component, so they read the post-switch dictionary.
  setActiveStrings(locale === "en" ? en : zh);

  // Keep the document language in sync (static index.html ships lang="en").
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    if (lang !== "system") return;
    const onChange = () => setSysTick((t) => t + 1);
    window.addEventListener("languagechange", onChange);
    return () => window.removeEventListener("languagechange", onChange);
  }, [lang]);

  const setLang = useCallback((next: LangPref) => {
    writePref(LANG_KEY, next);
    setLangState(next);
  }, []);

  // The sibling site (landing <-> docs) writing the shared key in another tab.
  useEffect(() => subscribePref<LangPref>(LANG_KEY, LANG_PREFS, setLangState), []);

  return (
    <LocaleContext.Provider value={{ lang, locale, setLang }}>{children}</LocaleContext.Provider>
  );
}

/**
 * Language scope: a remount boundary keyed on locale. The remount briefly empties the
 * DOM, which collapses the page height and clamps the scroll position to 0 — so the
 * scroll offset is captured during the render that switches locale (old DOM still
 * mounted) and restored right after the new tree lays out.
 */
export function LocaleScope({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const prevLocale = useRef(locale);
  const savedScroll = useRef<number | null>(null);
  if (prevLocale.current !== locale) {
    prevLocale.current = locale;
    savedScroll.current = window.scrollY;
  }
  useLayoutEffect(() => {
    if (savedScroll.current !== null) {
      window.scrollTo({ top: savedScroll.current, behavior: "instant" });
      savedScroll.current = null;
    }
  }, [locale]);
  return (
    <div key={locale} className="contents">
      {children}
    </div>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside LocaleProvider");
  return ctx;
}
