/** Locale context with persisted preferences and a remount boundary. */
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
import { setActiveStrings } from "../lib/strings";
import { en } from "../lib/strings-en";

const DICTIONARIES = { en };
export type Locale = keyof typeof DICTIONARIES;
export type LangPref = Locale | "system";

const LANG_PREFS = ["en", "system"] as const;

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
  return readPref<LangPref>(LANG_KEY, LANG_PREFS) ?? "system";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<LangPref>(initialLang);
  const [, setSysTick] = useState(0);

  const locale = resolve(lang);
  // Switch the active dictionary during render (idempotent): children are keyed on
  // locale and render after this component, so they read the post-switch dictionary.
  setActiveStrings(DICTIONARIES[locale]);

  // Keep the document language in sync (static index.html ships lang="en").
  useEffect(() => {
    document.documentElement.lang = locale;
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
