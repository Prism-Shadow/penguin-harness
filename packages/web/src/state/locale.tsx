/**
 * Language context: zh / en / system (tracks navigator.language, listens for languagechange).
 * On switch, first synchronously calls setActiveStrings (assigned during render, idempotent),
 * then remounts the whole tree keyed on locale so every `S.x` read immediately reflects the
 * new language; the preference persists to localStorage. The shared UI package's accessibility
 * fallbacks (a close cross's name, a "Copied" announcement) are handed the same language here,
 * and the document root's `lang` attribute is stamped with it, so screen readers and translation
 * heuristics hear the language that is actually on screen.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { UiStringsProvider } from "@prismshadow/penguin-ui";
import { setActiveStrings, zh } from "../lib/strings";
import { en } from "../lib/strings-en";
import { uiStringsFor } from "../lib/ui-strings";

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

/**
 * The BCP-47 tag the document root carries for a UI locale — the language the dictionaries are
 * actually written in, which is what `<html lang>` must announce: the Simplified-Chinese
 * dictionary as `zh-CN`, the English one as plain `en`. "system" has no tag of its own; it
 * resolves through resolveSystemLocale into one of the two before it ever reaches the document.
 */
export function documentLangFor(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}

/**
 * The least of the DOM applyDocumentLang touches, so the node-environment unit suite can record
 * the write without a DOM — the same parametrized-document shape as lib/workbench-theme.ts.
 */
interface DocumentLike {
  documentElement: { setAttribute(name: string, value: string): void } | null;
}

/**
 * Stamps the effective UI locale on the document root. Idempotent, so the provider can call it
 * on every render; a document without a root simply gets nothing, like applyWorkbenchTheme.
 */
export function applyDocumentLang(doc: DocumentLike, locale: Locale): void {
  const root = doc.documentElement;
  if (root) root.setAttribute("lang", documentLangFor(locale));
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
  // The document root goes with it, in the same render pass and for the same reason: `lang` is
  // what screen readers and translation heuristics read, and it must never name a language the
  // tree is not about to render. Renders without a DOM (server-side rendering, the node test
  // environment) simply get nothing: there is no root there to stamp, and the served page keeps
  // the static template's tag until the client's first render takes over.
  if (typeof document !== "undefined") applyDocumentLang(document, locale);

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
