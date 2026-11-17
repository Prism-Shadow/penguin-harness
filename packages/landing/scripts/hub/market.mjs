/**
 * The plugin market's curation document (schema 1): which plugins the maintainers selected, in
 * display order; which of those may lead the selected carousel, in turn order; and the art of the
 * plugins that have any — a cover with its thumbnail and dominant colour, a raster icon, and
 * screenshots with their captions — keyed by npm package name. Picture paths are relative to the
 * document's own directory, the community repository's `assets/plugins/`; the pages resolve them
 * (src/lib/community-assets.ts).
 *
 * The rules are the server's (packages/server/src/plugin/market.ts, `parseMarketDocument`),
 * restated here because a build script cannot import the server's TypeScript: a document that
 * breaks one is not used at all. Where the document comes from is published.mjs.
 *
 * Besides curation and pictures it may carry `popularity`: each package's install count and its
 * installs in the last week, which the Plugins page ranks by. The numbers are placeholders until a
 * real source replaces them (the block names its `source`); the page does not say so, and it shows
 * no ranking when the block is absent. A package the document names that no plugin on the site
 * carries is skipped.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The document embedded beside the server, copied from the community master at release time. */
export const EMBEDDED_MARKET_DOC = join(
  HERE,
  "..",
  "..",
  "..",
  "server",
  "src",
  "plugin",
  "builtin-market.json",
);

const HERO_MAX = 5;
const SELECTED_MAX = 12;
const SCREENSHOTS_MAX = 6;

/** Lower-case, relative, a raster extension; the segment rule below adds no empty, `.` or `..`. */
const PICTURE_PATH = /^[a-z0-9._/-]+\.(?:webp|png|jpg)$/;
const TONE = /^#[0-9a-fA-F]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A count the popularity block gives: a whole number, not negative. */
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * A market document as the site reads it, or an error naming `source` and the rule it breaks:
 * schema 1; an `updated` date; `hero` and `selected` lists of distinct names within their caps,
 * every hero also selected; `plugins` whose pictures are paths by the rule above, whose tones are
 * `#rrggbb`, whose captions are strings, with at most six screenshots each. An optional
 * `popularity` block is kept when it reads and dropped when it does not, never failing the
 * document (readPopularity). Keys schema 1 does not define are dropped.
 */
export function parseMarketDocument(data, source) {
  const fail = (rule) => {
    throw new Error(`market document from ${source} ${rule}`);
  };
  const picture = (value, at) => {
    if (
      typeof value !== "string" ||
      !PICTURE_PATH.test(value) ||
      value.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      fail(`has ${at} that is not a picture path (lower-case, relative, .webp/.png/.jpg)`);
    }
    return value;
  };
  const text = (value, at) =>
    typeof value === "string" ? value : fail(`has ${at} that is not a string`);
  const names = (value, field, max) => {
    if (!Array.isArray(value)) fail(`has no \`${field}\` list`);
    if (value.length > max) fail(`names ${value.length} plugins in \`${field}\`, over ${max}`);
    const seen = new Set();
    for (const name of value) {
      if (typeof name !== "string" || name === "")
        fail(`has a \`${field}\` entry that is not a name`);
      if (seen.has(name)) fail(`names ${name} twice in \`${field}\``);
      seen.add(name);
    }
    return [...seen];
  };

  if (!isRecord(data)) fail("is not a JSON object");
  if (data.schema !== 1)
    fail(`has schema ${JSON.stringify(data.schema)}; this site reads schema 1`);
  if (typeof data.updated !== "string" || !DATE.test(data.updated)) {
    fail("has no `updated` date (YYYY-MM-DD)");
  }
  const selected = names(data.selected, "selected", SELECTED_MAX);
  const hero = names(data.hero, "hero", HERO_MAX);
  if (hero.length === 0) fail("names no plugin in `hero`");
  for (const name of hero) {
    if (!selected.includes(name)) fail(`leads with ${name}, which \`selected\` does not name`);
  }
  if (!isRecord(data.plugins)) fail("has no `plugins` object");

  const plugins = new Map();
  for (const [name, raw] of Object.entries(data.plugins)) {
    const at = `plugins[${JSON.stringify(name)}]`;
    if (name === "") fail("names a plugin with an empty name");
    if (!isRecord(raw)) fail(`has ${at} that is not an object`);
    const entry = {};
    if (raw.cover !== undefined) {
      if (!isRecord(raw.cover)) fail(`has ${at}.cover that is not an object`);
      const cover = { src: picture(raw.cover.src, `${at}.cover.src`) };
      if (raw.cover.thumb !== undefined)
        cover.thumb = picture(raw.cover.thumb, `${at}.cover.thumb`);
      if (raw.cover.tone !== undefined) {
        if (typeof raw.cover.tone !== "string" || !TONE.test(raw.cover.tone)) {
          fail(`has ${at}.cover.tone that is not #rrggbb`);
        }
        cover.tone = raw.cover.tone;
      }
      entry.cover = cover;
    }
    if (raw.icon !== undefined) entry.icon = picture(raw.icon, `${at}.icon`);
    if (raw.screenshots !== undefined) {
      if (!Array.isArray(raw.screenshots)) fail(`has ${at}.screenshots that is not a list`);
      if (raw.screenshots.length > SCREENSHOTS_MAX) {
        fail(`has ${raw.screenshots.length} screenshots in ${at}, over ${SCREENSHOTS_MAX}`);
      }
      const shots = raw.screenshots.map((rawShot, i) => {
        const shotAt = `${at}.screenshots[${i}]`;
        if (!isRecord(rawShot)) fail(`has ${shotAt} that is not an object`);
        const shot = { src: picture(rawShot.src, `${shotAt}.src`) };
        if (rawShot.thumb !== undefined) shot.thumb = picture(rawShot.thumb, `${shotAt}.thumb`);
        if (rawShot.caption !== undefined)
          shot.caption = text(rawShot.caption, `${shotAt}.caption`);
        if (rawShot.captionZh !== undefined) {
          shot.captionZh = text(rawShot.captionZh, `${shotAt}.captionZh`);
        }
        return shot;
      });
      if (shots.length > 0) entry.screenshots = shots;
    }
    plugins.set(name, entry);
  }
  return { hero, selected, plugins, popularity: readPopularity(data.popularity) };
}

/**
 * The document's `popularity` block as package name → `{ installs, weekly }`, or undefined when it
 * has none or one that does not read: `source` "placeholder" or "live", a `generatedAt` date, and
 * `items` by package name, each whole, non-negative counts with `weekly` at most `installs`.
 * Lenient where the rest is strict, as on the server: a block that breaks a rule is dropped whole
 * and the document still stands. The numbers published today are placeholders (`source:
 * "placeholder"`), to be replaced by a real install count with `source: "live"`.
 */
function readPopularity(block) {
  if (!isRecord(block) || (block.source !== "placeholder" && block.source !== "live")) {
    return undefined;
  }
  if (typeof block.generatedAt !== "string" || !DATE.test(block.generatedAt)) return undefined;
  if (!isRecord(block.items)) return undefined;
  const items = new Map();
  for (const [name, item] of Object.entries(block.items)) {
    if (name === "" || !isRecord(item)) return undefined;
    const { installs, weekly } = item;
    if (!isCount(installs) || !isCount(weekly) || weekly > installs) return undefined;
    items.set(name, { installs, weekly });
  }
  return items;
}

/**
 * The curation as the pages use it, over the plugins the site lists (`packageName` → `id`):
 * `market` names the selected plugins and the carousel's leads by id — the ids the pages route
 * by — in the document's order, keeping only those listed; `artOf` answers a plugin's
 * `{ cover?, icon?, screenshots? }` by id, and `popularityOf` its `{ installs, weekly }` or
 * undefined. Without a document nothing is selected, dressed or counted.
 */
export function marketFor(doc, plugins) {
  const idOf = new Map(plugins.map((plugin) => [plugin.packageName, plugin.id]));
  const ids = (list) => list.map((name) => idOf.get(name)).filter((id) => id !== undefined);
  const art = new Map();
  for (const [name, entry] of doc?.plugins ?? []) {
    const id = idOf.get(name);
    if (id !== undefined) art.set(id, entry);
  }
  const counts = new Map();
  for (const [name, item] of doc?.popularity ?? []) {
    const id = idOf.get(name);
    if (id !== undefined) counts.set(id, item);
  }
  return {
    market: { hero: ids(doc?.hero ?? []), selected: ids(doc?.selected ?? []) },
    artOf: (id) => art.get(id) ?? {},
    popularityOf: (id) => counts.get(id),
  };
}
