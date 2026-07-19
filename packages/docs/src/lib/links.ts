/** External links and language-independent constants used across the docs site. */

export const REPO_URL = "https://github.com/Prism-Shadow/penguin-harness";
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

/**
 * The main site sits one level above the docs (both ship in one GitHub Pages
 * artifact: landing at "/<repo>/", docs at "/<repo>/docs/"). In local dev the docs
 * base is "/" so this resolves to the docs root itself — the landing page runs on
 * its own dev server there.
 */
export const SITE_URL = import.meta.env.BASE_URL.replace(/docs\/$/, "");
