/**
 * Heavy marketing media lives in the `assets/` directory of the sibling
 * `penguin-harness-community` repo rather than in this one, so that assets only the landing
 * site ever renders stay out of the clone of everyone who builds the product. Served by
 * raw.githubusercontent with `access-control-allow-origin: *` and a 5-minute cache; a GitHub
 * outage degrades the site to missing media, which is the accepted trade for not carrying the
 * bytes here.
 *
 * Pure and import-free, so the page, the tests and the scripts that fetch or stand in for the
 * blog's pictures (scripts/blog-image-sizes.mjs, scripts/check-post-jumps.mjs, run by Node
 * straight from this file) all read the one place the media is hosted.
 */
const COMMUNITY_ASSETS =
  "https://github.com/Prism-Shadow/penguin-harness-community/raw/refs/heads/main/assets";

/**
 * Demo videos: several megabytes each — committing them here would multiply what every
 * contributor clones. raw.githubusercontent sends
 * `accept-ranges: bytes`, so seeking works. The `application/octet-stream` content type
 * does not block playback — `nosniff` is only enforced for scripts and styles, and
 * `<video>` sniffs the container itself (verified in Chromium).
 * Pair every embed with a poster and `preload="none"`: nothing is fetched until play.
 */
export const demoVideoUrl = (name: string): string => `${COMMUNITY_ASSETS}/videos/${name}.mp4`;

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
export const blogAssetUrl = (name: string): string => `${COMMUNITY_ASSETS}/blog-assets/${name}`;
