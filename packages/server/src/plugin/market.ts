/**
 * The plugin market's curation: the "market document" (schema 1), which says which plugins the
 * maintainers selected, which of those may lead the market's carousel, and what the plugins that
 * have any art look like — a cover, a raster icon, screenshots — each picture named by a path
 * beside the document. Keyed by npm package name, never by bare plugin name: two scopes may share
 * one. A plugin the document does not name still lists, under the cover the page draws itself.
 *
 * Two sources, like the plugin index (registry.ts):
 *   - the copy embedded in this package (builtin-market.json), copied from the community
 *     repository's master at release preparation;
 *   - the published one (MARKET_DOCUMENT_URL; PENGUIN_PLUGIN_MARKET replaces it or turns it off),
 *     fetched through the deployment's mirror rules, kept for 30 minutes, served stale while a
 *     refresh runs, and replacing the embedded one once it has answered.
 *
 * Strict on what it reads (parseMarketDocument): a document that breaks a rule, or names a schema
 * other than 1, is not used at all and the embedded one stands. A future schema is published under
 * a new file name, so this server keeps reading the schema-1 document. Unknown keys are ignored.
 * Selection is an editorial choice, never a rank. The one block of numbers, `popularity`, is
 * optional and read leniently (readPopularity): PLACEHOLDER install counts today, to be replaced
 * by a real install-count API.
 */
import { createHash } from "node:crypto";
import { userAgent } from "@prismshadow/penguin-core";
import type { MarketPopularity, PluginArt, PluginMarketResponse } from "../api/types.js";
import builtinMarket from "./builtin-market.json" with { type: "json" };
import { pluginProxyMirrors } from "./registry.js";
import type { PluginProxyRule } from "./registry.js";

/** A picture the document names: its path, its small rendition, the colour it fades in over. */
export interface MarketDocumentImage {
  src: string;
  thumb?: string;
  /** The picture's dominant colour, `#rrggbb`. */
  tone?: string;
}

/** A screenshot the document names, with what it shows in both languages. */
export interface MarketDocumentShot {
  src: string;
  thumb?: string;
  caption?: string;
  captionZh?: string;
}

/** What the document says one plugin looks like. */
export interface MarketDocumentPlugin {
  cover?: MarketDocumentImage;
  /** A raster icon, drawn only for a plugin whose package is not on this server. */
  icon?: string;
  screenshots?: MarketDocumentShot[];
}

/** A market document as read: only the keys schema 1 defines. */
export interface MarketDocument {
  schema: 1;
  /** The date of the document's last edit (`YYYY-MM-DD`); part of every picture's cache key. */
  updated: string;
  /** Package names that may lead the carousel, in turn order; every one is also selected. */
  hero: string[];
  /** Package names of the selected plugins, in display order. */
  selected: string[];
  /** Install counts by package name, when the document carries a block that reads (readPopularity). */
  popularity?: MarketPopularity;
  plugins: Record<string, MarketDocumentPlugin>;
}

/** The most `hero` may name; it names at least one. */
export const MARKET_HERO_MAX = 5;
/** The most `selected` may name. */
export const MARKET_SELECTED_MAX = 12;
/** The most screenshots one plugin may have. */
export const MARKET_SCREENSHOTS_MAX = 6;

/**
 * A picture's path: relative to the document's own directory, lower-case `[a-z0-9._/-]`, a raster
 * extension the server serves (no SVG, no GIF). The segment rule below adds what a pattern says
 * badly: no leading `/`, no empty, `.` or `..` segment.
 */
const PICTURE_PATH = /^[a-z0-9._/-]+\.(?:webp|png|jpg)$/;
const TONE = /^#[0-9a-fA-F]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * The document's `popularity` block, or undefined when it has none or one that does not read:
 * `source` "placeholder" or "live", a `generatedAt` date, and `items` by package name, each
 * `{ installs, weekly }` of non-negative integers with weekly at most installs. Lenient where the
 * rest of the parser is strict: a block that breaks a rule is dropped whole, and the document,
 * its selection and its pictures still stand.
 *
 * PLACEHOLDER: the numbers the community repository publishes today are generated with a fixed
 * seed (`source: "placeholder"`), not counted. Replace them with a real install-count API later;
 * it publishes the same shape with `source: "live"`, and nothing here has to change.
 */
function readPopularity(value: unknown): MarketPopularity | undefined {
  if (!isRecord(value) || (value.source !== "placeholder" && value.source !== "live")) {
    return undefined;
  }
  if (typeof value.generatedAt !== "string" || !DATE.test(value.generatedAt)) return undefined;
  if (!isRecord(value.items)) return undefined;
  const items: [string, { installs: number; weekly: number }][] = [];
  for (const [name, item] of Object.entries(value.items)) {
    if (name === "" || !isRecord(item)) return undefined;
    const { installs, weekly } = item;
    if (!isCount(installs) || !isCount(weekly) || weekly > installs) return undefined;
    items.push([name, { installs, weekly }]);
  }
  return {
    source: value.source,
    generatedAt: value.generatedAt,
    items: Object.fromEntries(items),
  };
}

/**
 * Reads a market document, or throws naming the source and the rule it breaks: schema 1; an
 * `updated` date; `hero` and `selected` lists of distinct, non-empty names within their caps, with
 * every hero also selected; `plugins` an object whose entries' pictures are paths by the rule
 * above, whose tones are `#rrggbb`, whose captions are strings, with at most six screenshots each.
 * A name no server lists is not an error — the reader skips it. An optional `popularity` block is
 * kept when it reads and dropped when it does not, never failing the document (readPopularity).
 * Keys schema 1 does not define are dropped from the result, so neither the listing nor a parked
 * copy carries them.
 */
export function parseMarketDocument(data: unknown, source: string): MarketDocument {
  const fail = (rule: string): never => {
    throw new Error(`market document from ${source} ${rule}`);
  };
  const picture = (value: unknown, at: string): string => {
    if (
      typeof value !== "string" ||
      !PICTURE_PATH.test(value) ||
      value.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      return fail(`has ${at} that is not a picture path (lower-case, relative, .webp/.png/.jpg)`);
    }
    return value;
  };
  const text = (value: unknown, at: string): string =>
    typeof value === "string" ? value : fail(`has ${at} that is not a string`);
  const names = (value: unknown, field: string, max: number): string[] => {
    if (!Array.isArray(value)) return fail(`has no \`${field}\` list`);
    if (value.length > max)
      return fail(`names ${value.length} plugins in \`${field}\`, over ${max}`);
    const seen = new Set<string>();
    for (const name of value) {
      if (typeof name !== "string" || name === "") {
        fail(`has a \`${field}\` entry that is not a name`);
      }
      if (seen.has(name as string)) fail(`names ${String(name)} twice in \`${field}\``);
      seen.add(name as string);
    }
    return [...seen];
  };

  if (!isRecord(data)) return fail("is not a JSON object");
  if (data.schema !== 1) {
    return fail(`has schema ${JSON.stringify(data.schema)}; this server reads schema 1`);
  }
  if (typeof data.updated !== "string" || !DATE.test(data.updated)) {
    return fail("has no `updated` date (YYYY-MM-DD)");
  }
  const selected = names(data.selected, "selected", MARKET_SELECTED_MAX);
  const hero = names(data.hero, "hero", MARKET_HERO_MAX);
  if (hero.length === 0) fail("names no plugin in `hero`");
  for (const name of hero) {
    if (!selected.includes(name)) fail(`leads with ${name}, which \`selected\` does not name`);
  }
  if (!isRecord(data.plugins)) return fail("has no `plugins` object");

  const plugins = Object.entries(data.plugins).map(
    ([name, raw]): [string, MarketDocumentPlugin] => {
      const at = `plugins[${JSON.stringify(name)}]`;
      if (name === "") fail("names a plugin with an empty name");
      if (!isRecord(raw)) return fail(`has ${at} that is not an object`);
      const entry: MarketDocumentPlugin = {};
      if (raw.cover !== undefined) {
        if (!isRecord(raw.cover)) return fail(`has ${at}.cover that is not an object`);
        const cover: MarketDocumentImage = { src: picture(raw.cover.src, `${at}.cover.src`) };
        if (raw.cover.thumb !== undefined)
          cover.thumb = picture(raw.cover.thumb, `${at}.cover.thumb`);
        if (raw.cover.tone !== undefined) {
          if (typeof raw.cover.tone !== "string" || !TONE.test(raw.cover.tone)) {
            return fail(`has ${at}.cover.tone that is not #rrggbb`);
          }
          cover.tone = raw.cover.tone;
        }
        entry.cover = cover;
      }
      if (raw.icon !== undefined) entry.icon = picture(raw.icon, `${at}.icon`);
      if (raw.screenshots !== undefined) {
        if (!Array.isArray(raw.screenshots))
          return fail(`has ${at}.screenshots that is not a list`);
        if (raw.screenshots.length > MARKET_SCREENSHOTS_MAX) {
          return fail(
            `has ${raw.screenshots.length} screenshots in ${at}, over ${MARKET_SCREENSHOTS_MAX}`,
          );
        }
        entry.screenshots = raw.screenshots.map((rawShot: unknown, i): MarketDocumentShot => {
          const shotAt = `${at}.screenshots[${i}]`;
          if (!isRecord(rawShot)) return fail(`has ${shotAt} that is not an object`);
          const shot: MarketDocumentShot = { src: picture(rawShot.src, `${shotAt}.src`) };
          if (rawShot.thumb !== undefined) shot.thumb = picture(rawShot.thumb, `${shotAt}.thumb`);
          if (rawShot.caption !== undefined)
            shot.caption = text(rawShot.caption, `${shotAt}.caption`);
          if (rawShot.captionZh !== undefined) {
            shot.captionZh = text(rawShot.captionZh, `${shotAt}.captionZh`);
          }
          return shot;
        });
      }
      return [name, entry];
    },
  );
  const popularity = readPopularity(data.popularity);
  // fromEntries defines each name as an own key, `__proto__` included, rather than assigning it.
  return {
    schema: 1,
    updated: data.updated,
    hero,
    selected,
    ...(popularity !== undefined ? { popularity } : {}),
    plugins: Object.fromEntries(plugins),
  };
}

let embedded: MarketDocument | null = null;

/**
 * The document shipped with this build. Read once, on first use, rather than at import: a broken
 * copy fails the market's own routes, not the server's boot.
 */
export function embeddedMarketDocument(): MarketDocument {
  return (embedded ??= parseMarketDocument(builtinMarket, "builtin"));
}

/**
 * Where the published market document lives: the community repository's master, the same host the
 * landing site's media comes from. Its pictures sit in the same directory, under the paths the
 * document names.
 */
export const MARKET_DOCUMENT_URL =
  "https://github.com/Prism-Shadow/penguin-harness-community/raw/refs/heads/main/assets/plugins/market.json";

/**
 * PENGUIN_PLUGIN_MARKET -> the published document's URL, or null when it is off. Unset or blank =
 * the community repository's; `off` (any case) = the embedded document alone and no outbound
 * request, for an air-gapped deployment, the shape PENGUIN_PLUGIN_INDEX=off has; any other value
 * replaces the URL, and the pictures are then read beside it.
 */
export function resolvePluginMarketUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (value === undefined || value === "") return MARKET_DOCUMENT_URL;
  return value.toLowerCase() === "off" ? null : value;
}

/**
 * A response body read up to `max` bytes, or null when it is larger: a declared length over the cap
 * is refused before a byte is read, an undeclared one as soon as the bytes pass it.
 */
export async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (res.body === null) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** How long a published document is reused before a read refreshes it (served stale meanwhile). */
export const MARKET_CACHE_TTL_MS = 30 * 60_000;
/** How long a failed fetch stands before a read tries again; inside it the embedded one answers at once. */
export const MARKET_RETRY_MS = 60_000;
/** How long a read with no published document in hand waits for its first fetch. */
export const MARKET_FIRST_WAIT_MS = 1_500;
/** One address's fetch of the document, before the next address is tried. */
const DOCUMENT_TIMEOUT_MS = 15_000;
/** The most a document may weigh; a schema-1 document for every plugin there is is a few dozen KB. */
const DOCUMENT_MAX_BYTES = 1024 * 1024;

/** The published document as fetched, and when: what a successor App starts from. */
export interface MarketSnapshot {
  at: number;
  document: MarketDocument;
}

/** The document the market answers with, and which one it is. */
export interface MarketRead {
  document: MarketDocument;
  source: "embedded" | "published";
}

export interface MarketSource {
  /**
   * The published document's URL — what the paths of either document are resolved against, since
   * the embedded one is a copy of it — or null when the published document is off.
   */
  readonly url: string | null;
  /** The document to answer with now (see marketSource for when that is the embedded one). */
  read(): Promise<MarketRead>;
  /** The published document in hand, if any, for a successor App to start from. */
  snapshot(): MarketSnapshot | null;
}

export interface MarketSourceOptions {
  /** The published document, or null for the embedded one alone (resolvePluginMarketUrl). */
  url: string | null;
  /** The deployment's mirror rules, read per fetch: each address is tried after the URL itself. */
  proxy?: () => readonly PluginProxyRule[];
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** The published document a previous App fetched: served while fresh, and standing in when a refresh fails. */
  seed?: MarketSnapshot | null;
  /** Hears why a published document was refused or could not be fetched. */
  onFailure?: (message: string) => void;
  ttlMs?: number;
  retryMs?: number;
  firstWaitMs?: number;
}

/**
 * The market's two sources behind one read. With the published document off, the embedded one
 * answers. Otherwise a published document in hand answers — refreshed behind the answer once its
 * TTL has passed, and standing when that refresh fails; with none in hand, a read waits at most
 * `firstWaitMs` for the fetch and answers with the embedded document if it has not arrived (it is
 * used by the next read once it has). A fetch that failed is not tried again for `retryMs`.
 * Concurrent reads share one fetch.
 */
export function marketSource({
  url,
  proxy = () => [],
  fetchImpl = fetch,
  now = Date.now,
  seed = null,
  onFailure = () => undefined,
  ttlMs = MARKET_CACHE_TTL_MS,
  retryMs = MARKET_RETRY_MS,
  firstWaitMs = MARKET_FIRST_WAIT_MS,
}: MarketSourceOptions): MarketSource {
  let good: MarketSnapshot | null = url === null ? null : seed;
  let failedAt: number | null = null;
  let inFlight: Promise<MarketDocument> | null = null;

  // One address after another, the URL first: the first whose answer reads as a document wins. An
  // address that answers something else — an error status, a body over the cap, a document the
  // parser refuses — hands the fetch to the next, as one that cannot be reached does.
  const fetchDocument = async (from: string): Promise<MarketDocument> => {
    let lastError: unknown = null;
    for (const address of [from, ...pluginProxyMirrors(from, proxy())]) {
      try {
        const res = await fetchImpl(address, {
          headers: { "user-agent": userAgent(), accept: "application/json" },
          signal: AbortSignal.timeout(DOCUMENT_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`market document from ${address} answered HTTP ${res.status}`);
        const bytes = await readCapped(res, DOCUMENT_MAX_BYTES);
        if (bytes === null) {
          throw new Error(`market document from ${address} is over ${DOCUMENT_MAX_BYTES} bytes`);
        }
        let data: unknown;
        try {
          data = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw new Error(`market document from ${address} is not valid JSON`);
        }
        return parseMarketDocument(data, address);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };

  const refresh = (from: string): Promise<MarketDocument> =>
    (inFlight ??= fetchDocument(from)
      .then(
        (document) => {
          good = { at: now(), document };
          failedAt = null;
          return document;
        },
        (err: unknown) => {
          failedAt = now();
          onFailure(err instanceof Error ? err.message : String(err));
          throw err;
        },
      )
      .finally(() => {
        inFlight = null;
      }));

  const embeddedRead = (): MarketRead => ({
    document: embeddedMarketDocument(),
    source: "embedded",
  });

  return {
    url,
    snapshot: () => good,
    read: async () => {
      if (url === null) return embeddedRead();
      const at = now();
      const resting = failedAt !== null && at - failedAt < retryMs;
      if (good !== null) {
        if (at - good.at >= ttlMs && !resting) refresh(url).catch(() => undefined);
        return { document: good.document, source: "published" };
      }
      if (resting) return embeddedRead();
      const fetched = await settleWithin(refresh(url), firstWaitMs);
      return fetched === null ? embeddedRead() : { document: fetched, source: "published" };
    },
  };
}

/** What `work` resolves to if it does so within `ms`, else null; a rejection is null too. */
async function settleWithin<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work.catch(() => null), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The route a picture is served at: its path, and a revision that changes with the document's
 * date, so a browser that kept the old picture asks again once the document has been edited.
 */
export function marketAssetRoute(document: MarketDocument, path: string): string {
  const rev = createHash("sha256")
    .update(document.updated + path)
    .digest("hex")
    .slice(0, 12);
  return `/api/plugins/market/asset?path=${encodeURIComponent(path).replaceAll("%2F", "/")}&rev=${rev}`;
}

/** Every picture path the document names: what the picture route answers for, and nothing else. */
export function marketPicturePaths(document: MarketDocument): Set<string> {
  const paths = new Set<string>();
  for (const entry of Object.values(document.plugins)) {
    if (entry.cover !== undefined) {
      paths.add(entry.cover.src);
      if (entry.cover.thumb !== undefined) paths.add(entry.cover.thumb);
    }
    if (entry.icon !== undefined) paths.add(entry.icon);
    for (const shot of entry.screenshots ?? []) {
      paths.add(shot.src);
      if (shot.thumb !== undefined) paths.add(shot.thumb);
    }
  }
  return paths;
}

/** The listing: the document's lists as they are, every picture named by its route on this server. */
export function marketResponse({ document, source }: MarketRead): PluginMarketResponse {
  const route = (path: string) => marketAssetRoute(document, path);
  const art = Object.entries(document.plugins).map(([name, entry]): [string, PluginArt] => {
    const out: PluginArt = {};
    if (entry.cover !== undefined) {
      out.cover = {
        url: route(entry.cover.src),
        ...(entry.cover.thumb !== undefined ? { thumbUrl: route(entry.cover.thumb) } : {}),
        ...(entry.cover.tone !== undefined ? { tone: entry.cover.tone } : {}),
      };
    }
    if (entry.icon !== undefined) out.icon = { url: route(entry.icon) };
    if (entry.screenshots !== undefined && entry.screenshots.length > 0) {
      out.screenshots = entry.screenshots.map((shot) => ({
        url: route(shot.src),
        ...(shot.thumb !== undefined ? { thumbUrl: route(shot.thumb) } : {}),
        ...(shot.caption !== undefined ? { caption: shot.caption } : {}),
        ...(shot.captionZh !== undefined ? { captionZh: shot.captionZh } : {}),
      }));
    }
    return [name, out];
  });
  return {
    hero: [...document.hero],
    selected: [...document.selected],
    art: Object.fromEntries(art),
    source,
    // Placeholder numbers today, passed through as the document has them (readPopularity).
    ...(document.popularity !== undefined ? { popularity: document.popularity } : {}),
  };
}
