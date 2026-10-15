/**
 * Preferences shared by the landing page, the docs site and the gallery.
 *
 * The three are separate SPAs but ship to one origin (penguin.ooo, penguin.ooo/docs/ and
 * penguin.ooo/gallery/), so a single localStorage key is all it takes for a language or theme
 * choice to survive the hop between them. The landing page and the docs once wrote
 * `penguin-landing.*` and `penguin-docs.*`; those keys are still read as a fallback, so a visitor
 * who chose before the sites shared a key keeps that choice.
 *
 * Each site's index.html spells the theme key and its fallbacks in the inline script that applies
 * dark mode before first paint; keep those scripts in step with the keys here.
 */

export const SITE_THEME_KEY = "penguin-site.theme";
export const SITE_LANG_KEY = "penguin-site.lang";

/** Pre-unification keys, still read so an existing visitor keeps their choice. */
const LEGACY_KEYS: Record<string, readonly string[]> = {
  [SITE_THEME_KEY]: ["penguin-landing.theme", "penguin-docs.theme"],
  [SITE_LANG_KEY]: ["penguin-landing.lang", "penguin-docs.lang"],
};

/**
 * Reads a stored preference, falling back to the retired per-site keys. Everything is
 * wrapped: localStorage throws outright in a cookie-blocked or partitioned context, and
 * a preference is never worth taking the page down for.
 */
export function readSitePref<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    for (const k of [key, ...(LEGACY_KEYS[key] ?? [])]) {
      const stored = localStorage.getItem(k);
      if (stored && (allowed as readonly string[]).includes(stored)) return stored as T;
    }
  } catch {
    // Storage unavailable — fall through to the system default.
  }
  return null;
}

export function writeSitePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Non-persistent session: the choice still applies for this page.
  }
}

/**
 * Live sync for the both-tabs-open case. The storage event fires in every *other* tab on
 * the origin, so switching theme on the landing page updates an already-open docs tab
 * without a reload. Navigating between the sites is a full page load and is covered
 * by the read on mount instead.
 */
export function subscribeSitePref<T extends string>(
  key: string,
  allowed: readonly T[],
  onChange: (value: T) => void,
): () => void {
  const handler = (e: StorageEvent) => {
    if (e.key !== key || e.newValue === null) return;
    if ((allowed as readonly string[]).includes(e.newValue)) onChange(e.newValue as T);
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
