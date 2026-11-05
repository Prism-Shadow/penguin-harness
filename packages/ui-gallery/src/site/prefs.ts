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
import {
  readSitePref,
  SITE_LANG_KEY,
  SITE_THEME_KEY,
  subscribeSitePref,
  writeSitePref,
} from "@prismshadow/penguin-ui/site";
import { MODE_PREFS, resolveSiteLang, SITE_LANG_PREFS } from "../lib/url-state";
import type { Lang, ModePref, SiteLangPref } from "../lib/url-state";
import { useGallery } from "../state";

export type ThemeMode = ModePref;
export type LangPref = SiteLangPref;

export function useTheme(): { mode: ThemeMode; setMode: (mode: ThemeMode) => void } {
  const { state, update } = useGallery();
  const setMode = useCallback(
    (mode: ThemeMode) => {
      writeSitePref(SITE_THEME_KEY, mode);
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
  const stored = readSitePref<LangPref>(SITE_LANG_KEY, SITE_LANG_PREFS);
  const lang =
    stored !== null && resolveSiteLang(stored, navigator.language) === state.lang
      ? stored
      : state.lang;
  const setLang = useCallback(
    (next: LangPref) => {
      writeSitePref(SITE_LANG_KEY, next);
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
    () => subscribeSitePref<ThemeMode>(SITE_THEME_KEY, MODE_PREFS, (mode) => update({ mode })),
    [update],
  );
  useEffect(
    () =>
      subscribeSitePref<LangPref>(SITE_LANG_KEY, SITE_LANG_PREFS, (pref) =>
        update({ lang: resolveSiteLang(pref, navigator.language) }),
      ),
    [update],
  );
}
