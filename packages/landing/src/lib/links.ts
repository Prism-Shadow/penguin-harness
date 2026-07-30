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
 * One-line installer for Windows (PowerShell 5.1+, x64, bundled Node runtime).
 * penguin.ooo/install.ps1 is public/install.ps1 — the same thin-forwarder design.
 */
export const INSTALL_CMD_WINDOWS = "irm https://penguin.ooo/install.ps1 | iex";

/**
 * Offline-bundle install commands, per OS tab of the install switcher. Each Release
 * attaches five self-contained bundles (see scripts/package-offline-bundles.sh); the
 * commands show the most common architecture — the localized hint strings name the
 * alternative archive. Language-neutral, like the one-liners above.
 */
export const OFFLINE_INSTALL_CMDS: Record<"linux" | "macos" | "windows", string> = {
  linux: `mkdir penguin-offline
tar -xzf penguin-linux-x64-offline.tar.gz -C penguin-offline
./penguin-offline/install.sh`,
  macos: `mkdir penguin-offline
tar -xzf penguin-darwin-arm64-offline.tar.gz -C penguin-offline
./penguin-offline/install.sh`,
  windows: `Expand-Archive penguin-win32-x64-offline.zip -DestinationPath penguin-offline
cd penguin-offline
.\\install.cmd`,
};

/**
 * Heavy marketing media lives in the sibling `penguin-harness-community` repo rather than
 * in this one, so that assets only the landing site ever renders stay out of the clone of
 * everyone who builds the product. Served by raw.githubusercontent with
 * `access-control-allow-origin: *` and a 5-minute cache; a GitHub outage degrades the site
 * to missing media, which is the accepted trade for not carrying the bytes here.
 */
const COMMUNITY_RAW =
  "https://github.com/Prism-Shadow/penguin-harness-community/raw/refs/heads/main";

/**
 * Demo videos: ~9 MB each, against a whole repo history of ~17 MB — committing them here
 * would triple what every contributor clones. raw.githubusercontent sends
 * `accept-ranges: bytes`, so seeking works. The `application/octet-stream` content type
 * does not block playback — `nosniff` is only enforced for scripts and styles, and
 * `<video>` sniffs the container itself (verified in Chromium).
 * Pair every embed with a poster and `preload="none"`: nothing is fetched until play.
 */
export const demoVideoUrl = (name: string): string => `${COMMUNITY_RAW}/videos/${name}.mp4`;

/**
 * Blog images: a few hundred KB per post, forever, since a published post's screenshots
 * are never deleted — the one asset class whose growth is unbounded in the number of posts
 * written. Hosting them in the community repo keeps that growth out of this history.
 *
 * The post Markdown deliberately does *not* spell these URLs out. Bodies keep writing the
 * portable `/blog-assets/<name>` path (both `![alt](…)` and the raw `<img src="…">` tags
 * some posts use), and the renderer resolves it here at render time — see the `img`
 * adapter in src/pages/blog-post.tsx. One source of truth for where the images are hosted,
 * Markdown that stays readable and diffable, and moving the host again is a one-line
 * change instead of a sweep over every post.
 */
export const blogAssetUrl = (name: string): string => `${COMMUNITY_RAW}/blog-assets/${name}`;

/** API key consoles (same URLs the in-app Models page links to). */
export const DEEPSEEK_KEYS_URL = "https://platform.deepseek.com/api_keys";
export const OPENROUTER_KEYS_URL = "https://openrouter.ai/workspaces/default/keys";
