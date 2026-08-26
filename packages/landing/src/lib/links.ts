/** External links and language-independent constants used across the landing page. */

export const REPO_URL = "https://github.com/Prism-Shadow/penguin-harness";
export const REPO_API_URL = "https://api.github.com/repos/Prism-Shadow/penguin-harness";
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
 * Offline install commands, per OS tab of the install switcher. Each Release attaches one
 * installer bundle per target (see scripts/package-release-bundles.sh) and the same file
 * serves online and offline installation; the commands show the most common architecture —
 * the localized hint strings name the alternative archive. Language-neutral, like the
 * one-liners above.
 */
export const OFFLINE_INSTALL_CMDS: Record<"linux" | "macos" | "windows", string> = {
  linux: `mkdir penguin-install
tar -xzf penguin-linux-x64.tar.gz -C penguin-install
./penguin-install/install.sh`,
  macos: `mkdir penguin-install
tar -xzf penguin-darwin-arm64.tar.gz -C penguin-install
./penguin-install/install.sh`,
  windows: `Expand-Archive penguin-win32-x64.zip -DestinationPath penguin-install
cd penguin-install
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

/**
 * Desktop app downloads. The installers carry version-less names (see
 * packages/desktop/electron-builder.yml), which is what makes static links possible on a
 * Pages-hosted site: GitHub's `releases/latest/download/<name>` always serves the newest
 * release, no client-side resolution needed. The OSS mirror stores immutable per-tag
 * directories instead, so mirror links DO need the current tag — the download page reads
 * it from the bucket's `latest.json` pointer (the same file install.sh resolves) and
 * falls back to the GitHub links when that fetch fails (e.g. CORS not configured, or the
 * mirror unreachable).
 */
export const OSS_ORIGIN = "https://penguin-harness-releases.oss-cn-beijing.aliyuncs.com";
export const OSS_LATEST_JSON_URL = `${OSS_ORIGIN}/latest.json`;
export const GITHUB_LATEST_DOWNLOAD = `${REPO_URL}/releases/latest/download`;

export interface DesktopInstaller {
  /** Stable asset file name, identical on GitHub Releases and the OSS mirror. */
  file: string;
  /** Language-neutral variant tag rendered on the button (arch / package format). */
  variant: string;
}

/** Named separately: the first-launch FAQ's chmod command quotes this exact file name. */
const LINUX_APPIMAGE: DesktopInstaller = {
  file: "penguin-desktop-linux-x86_64.AppImage",
  variant: "AppImage",
};

/** Installers per platform card, in display order. */
export const DESKTOP_INSTALLERS: Record<"mac" | "windows" | "linux", DesktopInstaller[]> = {
  mac: [
    { file: "penguin-desktop-darwin-arm64.dmg", variant: "Apple Silicon" },
    { file: "penguin-desktop-darwin-x64.dmg", variant: "Intel" },
  ],
  windows: [{ file: "penguin-desktop-win32-x64.exe", variant: "x64" }],
  linux: [LINUX_APPIMAGE, { file: "penguin-desktop-linux-amd64.deb", variant: "deb" }],
};

/** Checksum list covering every desktop installer of a release. */
export const DESKTOP_SHA256SUMS = "SHA256SUMS.desktop";

/**
 * First-launch fixes for the unsigned desktop builds (the download page FAQ).
 * Language-neutral, like the install commands above. The macOS one deletes the
 * quarantine flag that makes Gatekeeper report the app as "damaged"; the Linux
 * one restores the execute bit browsers strip from a downloaded AppImage.
 */
export const MAC_UNQUARANTINE_CMD =
  "sudo xattr -rd com.apple.quarantine /Applications/PenguinHarness.app";
export const LINUX_APPIMAGE_CHMOD_CMD = `chmod +x ${LINUX_APPIMAGE.file}`;
