/**
 * The gallery context every route renders inside: the URL-backed view state, the resolved mode,
 * the chrome dictionary, and the token and accent matrices.
 *
 * The provider owns the document root: it applies the theme under test to <html> through the
 * package's own `applyThemeAttributes` (the same contract the app's boot script and theme provider
 * follow) — theme, mode, the accent choice and the root font size, which is what makes the size
 * tiers real: every rem in a composition, a framed embed or `/embed` follows
 * `<html style="font-size">`, while the chrome, sized in px, does not — sets `lang` so CJK text
 * shapes as Chinese, and marks reduced motion and the phone view. The gallery chrome never reads
 * those attributes' theme — only `.dark`, to pick its own light or dark palette.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { applyThemeAttributes } from "@prismshadow/penguin-ui/boot";
import { asAccentChoice, resolveAccent } from "./lib/accents";
import { replaceSearch, usePrefersDark, useSearch } from "./lib/location";
import { probeAccents, probeTokens } from "./lib/token-probe";
import type { AccentMatrix, TokenMatrix } from "./lib/token-probe";
import { formatGalleryQuery, parseGalleryState, PREF_KEYS, resolveMode } from "./lib/url-state";
import type { GalleryState, RememberedPrefs } from "./lib/url-state";
import { zh } from "./strings";
import type { GalleryStrings } from "./strings";
import { en } from "./strings-en";

const storageKey = (key: string) => `penguin-gallery.${key}`;

function readRemembered(): RememberedPrefs {
  const prefs: Record<string, string> = {};
  try {
    for (const key of PREF_KEYS) {
      const value = window.localStorage.getItem(storageKey(key));
      if (value) prefs[key] = value;
    }
  } catch {
    // Storage can be unavailable (a sandboxed frame); the URL alone still works.
  }
  return prefs as RememberedPrefs;
}

function remember(state: GalleryState): void {
  try {
    for (const key of PREF_KEYS) window.localStorage.setItem(storageKey(key), state[key]);
  } catch {
    // Convenience only.
  }
}

export interface GalleryContextValue {
  state: GalleryState;
  /** `state.mode` with `system` resolved. */
  mode: "light" | "dark";
  /** `state.accent` as the active theme applies it: the preset, or `neutral` when it lists none such. */
  accent: string;
  S: GalleryStrings;
  /** Every token in every theme × mode; null until the first probe has run. */
  tokens: TokenMatrix | null;
  /** Every theme's own accent and listed presets, resolved; null until the first probe has run. */
  accents: AccentMatrix | null;
  /** Rewrites the URL (and the remembered preferences) with a patched state. */
  update: (patch: Partial<GalleryState> | ((state: GalleryState) => GalleryState)) => void;
}

const GalleryContext = createContext<GalleryContextValue | null>(null);

export function useGallery(): GalleryContextValue {
  const value = useContext(GalleryContext);
  if (!value) throw new Error("useGallery() outside <GalleryProvider>");
  return value;
}

interface Probed {
  tokens: TokenMatrix;
  accents: AccentMatrix;
}

/** Re-probe after the page's CSS changes (Vite HMR swaps <style> tags); debounced. */
function useProbe(): Probed | null {
  const [probed, setProbed] = useState<Probed | null>(null);
  useEffect(() => {
    let timer = 0;
    const run = () => {
      timer = 0;
      setProbed({ tokens: probeTokens(), accents: probeAccents() });
    };
    run();
    const observer = new MutationObserver(() => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(run, 150);
    });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (timer) window.clearTimeout(timer);
    };
  }, []);
  return probed;
}

export function GalleryProvider({
  children,
  canonicalizeUrl = false,
  extraParams = [],
}: {
  children: ReactNode;
  /** Write the full canonical query into the URL on load (the main page); other routes keep theirs. */
  canonicalizeUrl?: boolean;
  /** Route-specific query params the canonical rewrite must keep (`demo`, `variant`, …). */
  extraParams?: readonly string[];
}) {
  const search = useSearch();
  const [remembered] = useState(readRemembered);
  const state = useMemo(() => parseGalleryState(search, remembered), [search, remembered]);
  const prefersDark = usePrefersDark();
  const mode = resolveMode(state.mode, prefersDark);
  const accent = resolveAccent(state.theme, state.accent);
  const probed = useProbe();

  const extras = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const kept: Record<string, string> = {};
    for (const key of extraParams) {
      const value = params.get(key);
      if (value !== null) kept[key] = value;
    }
    return kept;
  }, [extraParams]);

  const update = useCallback<GalleryContextValue["update"]>(
    (patch) => {
      const current = parseGalleryState(window.location.search, readRemembered());
      const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
      remember(next);
      replaceSearch(formatGalleryQuery(next, extras()));
    },
    [extras],
  );

  useEffect(() => {
    if (canonicalizeUrl) replaceSearch(formatGalleryQuery(state, extras()));
    // Only the first render's state is canonicalized; later changes go through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalizeUrl]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    // The chosen preset goes onto the root as it is, listed by the active theme or not — the
    // app's boot script does the same, and a theme's preset rules match only their own theme.
    applyThemeAttributes(root, {
      themeId: state.theme,
      dark: mode === "dark",
      accent: asAccentChoice(state.accent),
      fontScale: state.tier,
    });
    root.lang = state.lang === "zh" ? "zh-CN" : "en";
    root.dataset.motion = state.motion;
    root.dataset.view = state.view;
  }, [state.theme, mode, state.tier, state.accent, state.lang, state.motion, state.view]);

  const value = useMemo<GalleryContextValue>(
    () => ({
      state,
      mode,
      accent,
      S: state.lang === "zh" ? zh : en,
      tokens: probed?.tokens ?? null,
      accents: probed?.accents ?? null,
      update,
    }),
    [state, mode, accent, probed, update],
  );
  return <GalleryContext.Provider value={value}>{children}</GalleryContext.Provider>;
}
