/**
 * Where the site navbar's links lead. The gallery is published inside the public site, at
 * `<site>/gallery/` (scripts/build-site.mjs), so the landing page's pages and the docs are its
 * siblings one level up, plain anchors as they are from the docs. Run on its own (`pnpm
 * dev:gallery`, or a build of the gallery alone) it has no site around it, and the links lead to
 * the public one. With the landing page's dev server passing `/gallery/` through to the gallery's
 * (`BASE_PATH=/gallery/ pnpm dev:gallery`), they stay on the local site.
 */
import { siteRootOf } from "../lib/location";

export const REPO_URL = "https://github.com/Prism-Shadow/penguin-harness";
export const REPO_API_URL = "https://api.github.com/repos/Prism-Shadow/penguin-harness";

/** The public site, for a gallery that is not inside one. */
export const PUBLIC_SITE_URL = "https://penguin.ooo/";

/** The site the gallery's base sits in, with its trailing slash. */
export function siteUrlOf(base: string): string {
  return siteRootOf(base) ?? PUBLIC_SITE_URL;
}

export const SITE_URL = siteUrlOf(import.meta.env.BASE_URL);

/** The docs site: a sibling SPA under the same site, at `<site>/docs/`. */
export const DOCS_URL = `${SITE_URL}docs/`;
