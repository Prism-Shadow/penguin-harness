/**
 * The site navbar's language and theme, bound to the gallery's view: the same hooks the landing
 * page's toggles read (`useLocale`, `useTheme`), so the toggles here are its markup unchanged.
 *
 * The gallery's `mode` and `lang` are the site's light/dark and language: a toggle writes the
 * site's shared key, which the landing page and the docs read, and rewrites the view's URL, so
 * the page and its frames switch with it. The site's language may be `system`; the view carries
 * the language it resolves to, and the menu checks `system` while that is what applies.
 */
import { useCallback, useEffect } from "react";
import { MODE_PREFS, resolveSiteLang, SITE_LANG_PREFS } from "../lib/url-state";
import type { Lang, ModePref, SiteLangPref } from "../lib/url-state";
import { useGallery } from "../state";
import { LANG_KEY, readPref, subscribePref, THEME_KEY, writePref } from "./site-prefs";

export type ThemeMode = ModePref;
export type LangPref = SiteLangPref;

export function useTheme(): { mode: ThemeMode; setMode: (mode: ThemeMode) => void } {
  const { state, update } = useGallery();
  const setMode = useCallback(
    (mode: ThemeMode) => {
      writePref(THEME_KEY, mode);
      update({ mode });
    },
    [update],
  );
  return { mode: state.mode, setMode };
}

export function useLocale(): {
  lang: LangPref;
  locale: Lang;
  setLang: (lang: LangPref) => void;
} {
  const { state, update } = useGallery();
  const stored = readPref<LangPref>(LANG_KEY, SITE_LANG_PREFS);
  const lang =
    stored !== null && resolveSiteLang(stored, navigator.language) === state.lang
      ? stored
      : state.lang;
  const setLang = useCallback(
    (next: LangPref) => {
      writePref(LANG_KEY, next);
      update({ lang: resolveSiteLang(next, navigator.language) });
    },
    [update],
  );
  return { lang, locale: state.lang, setLang };
}

/** Follows a sibling site writing the shared keys in another tab, as their own pages do. */
export function useSitePrefsSync(): void {
  const { update } = useGallery();
  useEffect(
    () => subscribePref<ThemeMode>(THEME_KEY, MODE_PREFS, (mode) => update({ mode })),
    [update],
  );
  useEffect(
    () =>
      subscribePref<LangPref>(LANG_KEY, SITE_LANG_PREFS, (pref) =>
        update({ lang: resolveSiteLang(pref, navigator.language) }),
      ),
    [update],
  );
}
