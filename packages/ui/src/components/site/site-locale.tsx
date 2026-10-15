/**
 * The public sites' language: zh / en / system (following navigator.language), stored under the
 * key the landing page, the docs and the gallery share.
 *
 * The host owns its dictionaries. `onLocale` is called during render, before any child renders,
 * so a host that keeps a live `S` binding swaps it there; `SiteLocaleScope` then remounts the
 * tree keyed on the locale, so every `S.x` read below it reflects the new language.
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
import type { SiteLangPref } from "./site-controls";
import { readSitePref, SITE_LANG_KEY, subscribeSitePref, writeSitePref } from "./site-prefs";

export type SiteLocale = "zh" | "en";

export const SITE_LANG_PREFS = ["zh", "en", "system"] as const satisfies readonly SiteLangPref[];

export interface SiteLocaleState {
  lang: SiteLangPref;
  locale: SiteLocale;
  setLang: (lang: SiteLangPref) => void;
}

const SiteLocaleContext = createContext<SiteLocaleState | null>(null);

/** Device language -> site language: zh* -> zh, anything else -> en. */
export function resolveSystemLocale(language: string | undefined): SiteLocale {
  return language?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function resolve(lang: SiteLangPref): SiteLocale {
  return lang === "system" ? resolveSystemLocale(navigator.language) : lang;
}

export function SiteLocaleProvider({
  onLocale,
  children,
}: {
  /** Swaps the host's dictionaries; called during render, so it must be idempotent. */
  onLocale: (locale: SiteLocale) => void;
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<SiteLangPref>(
    () => readSitePref(SITE_LANG_KEY, SITE_LANG_PREFS) ?? "system",
  );
  const [, setSysTick] = useState(0);

  const locale = resolve(lang);
  // Children are keyed on the locale and render after this component, so they read the
  // dictionary switched here.
  onLocale(locale);

  // Keep the document language in sync (the static index.html ships lang="en").
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    if (lang !== "system") return;
    const onChange = () => setSysTick((t) => t + 1);
    window.addEventListener("languagechange", onChange);
    return () => window.removeEventListener("languagechange", onChange);
  }, [lang]);

  const setLang = useCallback((next: SiteLangPref) => {
    writeSitePref(SITE_LANG_KEY, next);
    setLangState(next);
  }, []);

  // A sibling site writing the shared key in another tab.
  useEffect(() => subscribeSitePref(SITE_LANG_KEY, SITE_LANG_PREFS, setLangState), []);

  return (
    <SiteLocaleContext.Provider value={{ lang, locale, setLang }}>
      {children}
    </SiteLocaleContext.Provider>
  );
}

/**
 * A remount boundary keyed on the locale. The remount briefly empties the DOM, which collapses
 * the page height and clamps the scroll position to 0 — so the scroll offset is captured during
 * the render that switches locale (old DOM still mounted) and restored right after the new tree
 * lays out.
 */
export function SiteLocaleScope({ children }: { children: ReactNode }) {
  const { locale } = useSiteLocale();
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

export function useSiteLocale(): SiteLocaleState {
  const ctx = useContext(SiteLocaleContext);
  if (!ctx) throw new Error("useSiteLocale must be used inside SiteLocaleProvider");
  return ctx;
}
