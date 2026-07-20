/** External links and language-independent constants used across the landing page. */

export const REPO_URL = "https://github.com/Prism-Shadow/penguin-harness";
export const RELEASES_URL = `${REPO_URL}/releases`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

/**
 * Docs site: a sibling SPA deployed under the landing page's own base ("/<repo>/docs/",
 * see scripts/build-site.mjs). A plain href — it is a separate app, not a router route.
 * In local dev this resolves to "/docs/", which only exists in the assembled build.
 */
export const DOCS_URL = `${import.meta.env.BASE_URL}docs/`;

/**
 * One-line installer (Linux / macOS, x64 / arm64, bundled Node runtime).
 * penguin.ooo/install.sh is this site's own public/install.sh — a thin forwarder
 * to the latest GitHub release installer (Pages cannot serve real redirects).
 */
export const INSTALL_CMD = "curl -fsSL https://penguin.ooo/install.sh | sh";

/** API key consoles (same URLs the in-app Models page links to). */
export const DEEPSEEK_KEYS_URL = "https://platform.deepseek.com/api_keys";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/workspaces/default/keys";
