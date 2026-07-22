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

/**
 * Demo videos live in the sibling `penguin-harness-community` repo rather than in this
 * one: they are ~9 MB each, and this repo's whole history is ~17 MB, so committing them
 * here would triple what every contributor clones for assets only the marketing site
 * shows. Served by raw.githubusercontent with `accept-ranges: bytes` (seeking works),
 * `access-control-allow-origin: *` and a 5-minute cache. The `application/octet-stream`
 * content type does not block playback — `nosniff` is only enforced for scripts and
 * styles, and `<video>` sniffs the container itself (verified in Chromium).
 * Pair every embed with a poster and `preload="none"`: nothing is fetched until play.
 */
const COMMUNITY_RAW =
  "https://github.com/Prism-Shadow/penguin-harness-community/raw/refs/heads/main";
export const demoVideoUrl = (name: string): string => `${COMMUNITY_RAW}/videos/${name}.mp4`;

/** API key consoles (same URLs the in-app Models page links to). */
export const DEEPSEEK_KEYS_URL = "https://platform.deepseek.com/api_keys";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/workspaces/default/keys";
