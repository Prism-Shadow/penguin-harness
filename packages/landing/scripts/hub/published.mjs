/**
 * The two documents the Plugins pages read from the network: the plugin market's curation
 * document (the community repository's master, market.mjs) and the published plugin index (the
 * one the server reads, index-rows.mjs).
 *
 * Like the benchmark clone (source.mjs), a build fetches them afresh into this package's
 * node_modules cache (`fetchPublished`, one GET each), and every read after it — the pages'
 * module, the route shells, the sitemap — reads those copies (`readPublished`), so they agree. The
 * dev server reuses a copy for a day. PENGUIN_MARKET_DOC and PENGUIN_PLUGIN_INDEX_DOC name a local
 * file to read instead, with no network (an offline build, a machine that cannot reach GitHub).
 *
 * A fetch that fails, or answers a document that breaks its rules, is a warning and not a failed
 * build: the market falls back to the copy embedded beside the server, the index to the bundled
 * plugins alone. A local file that breaks its rules fails the build, naming the file — it was
 * named on purpose. So does a broken embedded copy, which is this repository's own.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parsePluginIndex } from "./index-rows.mjs";
import { EMBEDDED_MARKET_DOC, parseMarketDocument } from "./market.mjs";
import { CACHE_DIR } from "./source.mjs";

/** The community repository's master market document; its pictures sit beside it. */
export const MARKET_DOCUMENT_URL =
  "https://github.com/Prism-Shadow/penguin-harness-community/raw/refs/heads/main/assets/plugins/market.json";

/** The published plugin index: the server's NIGHTLY_INDEX_URL (packages/server/src/plugin/registry.ts). */
export const PLUGIN_INDEX_URL =
  "https://github.com/Prism-Shadow/penguin-extensions/releases/download/nightly/index.json";

/** Where the fetched copies are kept. */
export const PUBLISHED_DIR = join(CACHE_DIR, "published");

/** How long one GET may take before the build goes on without it. */
const FETCH_TIMEOUT_MS = 15_000;
/** How long the dev server reuses a copy before fetching the document again. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const SOURCES = [
  {
    file: "market.json",
    url: MARKET_DOCUMENT_URL,
    env: "PENGUIN_MARKET_DOC",
    what: "the published market document",
    fallback: "the copy embedded beside the server",
    parse: parseMarketDocument,
  },
  {
    file: "plugin-index.json",
    url: PLUGIN_INDEX_URL,
    env: "PENGUIN_PLUGIN_INDEX_DOC",
    what: "the published plugin index",
    fallback: "the bundled plugins alone",
    parse: parsePluginIndex,
  },
];

const message = (error) => (error instanceof Error ? error.message : String(error));

/**
 * Fetch both documents into `cacheDir`, each unless its env variable names a local file. With
 * `refresh` (a build) the copy from an earlier run is dropped first, so a failed fetch falls back
 * rather than serving an older document; without it (the dev server) a copy under a day old is
 * reused, and an older one still serves when the fetch fails.
 */
export async function fetchPublished({
  refresh = false,
  env = process.env,
  cacheDir = PUBLISHED_DIR,
  fetchImpl = fetch,
} = {}) {
  await Promise.all(
    SOURCES.filter((source) => !env[source.env]).map(
      async ({ file, url, what, fallback, parse }) => {
        const copy = join(cacheDir, file);
        if (!refresh && existsSync(copy) && Date.now() - statSync(copy).mtimeMs < MAX_AGE_MS)
          return;
        if (refresh) rmSync(copy, { force: true });
        try {
          const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.text();
          parse(JSON.parse(body), url);
          mkdirSync(cacheDir, { recursive: true });
          writeFileSync(copy, body);
        } catch (error) {
          const instead = existsSync(copy) ? "the copy from an earlier run" : fallback;
          console.warn(
            `[penguin:hub] could not read ${what} (${url}): ${message(error)}; using ${instead}.`,
          );
        }
      },
    ),
  );
}

/** A JSON file, or an error naming it. */
function readJson(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`${file}: missing`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${file}: not valid JSON`);
  }
}

/**
 * The document one source stands for: the local file its env variable names (a broken one throws),
 * else the fetched copy (a broken one warns and is passed over), else undefined.
 */
function readSource({ file, url, env: name, what, fallback, parse }, env, cacheDir) {
  const local = env[name];
  if (local) {
    const path = resolve(local);
    return parse(readJson(path), path);
  }
  const copy = join(cacheDir, file);
  if (!existsSync(copy)) return undefined;
  try {
    return parse(readJson(copy), url);
  } catch (error) {
    console.warn(`[penguin:hub] ${message(error)}; using ${fallback} instead of ${what}.`);
    return undefined;
  }
}

/**
 * What the hub reads besides the plugin packages: `market`, the curation document (the published
 * one, else the embedded copy at `embeddedMarket`), and `index`, the published index's rows (none
 * when it could not be read).
 */
export function readPublished({
  env = process.env,
  cacheDir = PUBLISHED_DIR,
  embeddedMarket = EMBEDDED_MARKET_DOC,
} = {}) {
  const [marketSource, indexSource] = SOURCES;
  return {
    market:
      readSource(marketSource, env, cacheDir) ??
      parseMarketDocument(readJson(embeddedMarket), embeddedMarket),
    index: readSource(indexSource, env, cacheDir) ?? [],
  };
}
