/**
 * Preferences shared by the landing page and the docs site.
 *
 * The two are separate SPAs but ship to one origin (penguin.ooo and penguin.ooo/docs/),
 * so a single localStorage key is all it takes for a language or theme choice to survive
 * the hop between them. They previously wrote `penguin-landing.*` and `penguin-docs.*`,
 * which is why picking dark mode on the landing page and clicking through to the docs
 * dropped you back into light.
 *
 * This module is duplicated verbatim in packages/landing (as theme.tsx and locale.tsx
 * already are — the two sites share no package). The KEYS below must stay identical on
 * both sides; if they drift, the sync silently stops working with nothing failing.
 */

export const THEME_KEY = "penguin-site.theme";
export const LANG_KEY = "penguin-site.lang";

/** Pre-unification keys, still read once so an existing visitor keeps their choice. */
const LEGACY_KEYS: Record<string, readonly string[]> = {
  [THEME_KEY]: ["penguin-landing.theme", "penguin-docs.theme"],
  [LANG_KEY]: ["penguin-landing.lang", "penguin-docs.lang"],
};

/**
 * Reads a stored preference, falling back to the retired per-site keys. Everything is
 * wrapped: localStorage throws outright in a cookie-blocked or partitioned context, and
 * a preference is never worth taking the page down for.
 */
export function readPref<T extends string>(key: string, allowed: readonly T[]): T | null {
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

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Non-persistent session: the choice still applies for this page.
  }
}

/**
 * Live sync for the both-tabs-open case. The storage event fires in every *other* tab on
 * the origin, so switching theme on the landing page updates an already-open docs tab
 * without a reload. Navigating between the two sites is a full page load and is covered
 * by the read on mount instead.
 */
export function subscribePref<T extends string>(
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
