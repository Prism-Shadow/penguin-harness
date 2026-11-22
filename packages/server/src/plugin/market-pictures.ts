/**
 * The plugin market's pictures, fetched by this server and kept on its disk, so a page never loads
 * a picture from another host: the Web App draws covers and screenshots from this server's own
 * route (http/routes/plugin-market.ts), a deployment's mirror rules apply (they exist only here),
 * and a picture fetched once is there offline.
 *
 * A picture is fetched from its URL, then from the addresses the mirror rules rewrite it into, one
 * at a time, 15 s each, at most 2 MB, at most four fetches at once across every picture and one per
 * picture in flight. Its type is read from its bytes (core's sniffIconFormat): WebP, PNG and JPEG
 * are kept, anything else is refused and not kept, whatever the address called it.
 *
 * What is kept lives under `<data root>/.cache/plugin-market/` (marketPictureDir), one pair of
 * files per picture URL:
 * the bytes and a small record of the URL, its ETag and when it was last checked. A copy younger
 * than a day is served as it is; an older one is served at once while it is revalidated by its
 * ETag behind the answer, and stays when the source is down. The directory is a cache and nothing
 * else: nothing exports or backs it up, and deleting it costs a fetch per picture.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, sniffIconFormat, userAgent } from "@prismshadow/penguin-core";
import { readCapped } from "./market.js";
import { pluginProxyMirrors } from "./registry.js";
import type { PluginProxyRule } from "./registry.js";

/** The formats a market picture may be: rasters a browser draws, never SVG or GIF. */
export type MarketPictureFormat = "webp" | "png" | "jpeg";

/** One picture as served: its bytes and the format they are. */
export interface MarketPicture {
  bytes: Uint8Array;
  format: MarketPictureFormat;
}

/** The most one picture may weigh; the published sizes are a tenth of it. */
export const MARKET_PICTURE_MAX_BYTES = 2 * 1024 * 1024;
/** One address's fetch of a picture, before the next address is tried. */
const PICTURE_TIMEOUT_MS = 15_000;
/** The most picture fetches out at once, across every picture. */
const PICTURE_FETCHES_AT_ONCE = 4;
/** How long a kept picture is served before it is revalidated. */
export const MARKET_PICTURE_FRESH_MS = 24 * 60 * 60_000;
/** How long a picture that could not be fetched, with nothing kept, answers "none" at once. */
const PICTURE_RETRY_MS = 60_000;

const SERVED: ReadonlySet<string> = new Set<MarketPictureFormat>(["webp", "png", "jpeg"]);

/**
 * Where the pictures are kept under a data root: `.cache/plugin-market/`. The data root's top level
 * is also where Projects live, one directory per id, and no list reserves the other names there:
 * `plugins/`, `logs/` or a plain `cache/` would take a name a Project could have, and land inside
 * a Project that already has it. A dot-prefixed name is the one shape no Project id can take (every
 * id rule excludes `.`), and the scanners that read the top level as Projects skip it.
 */
export function marketPictureDir(root: string): string {
  return path.join(root, ".cache", "plugin-market");
}

export interface MarketPictures {
  /** The picture at `url` (its canonical address), or null when there is none to serve. */
  get(url: string): Promise<MarketPicture | null>;
  /** Resolves once every revalidation started behind an answer has ended. */
  settled(): Promise<void>;
}

export interface MarketPicturesOptions {
  /** Where pictures are kept (marketPictureDir). */
  dir: string;
  /** The deployment's mirror rules, read per fetch. */
  proxy?: () => readonly PluginProxyRule[];
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Hears a picture refused, or a copy that could not be written. */
  log?: (line: string) => void;
}

/** The record kept beside a picture's bytes. */
interface KeptRecord {
  url: string;
  etag: string | null;
  checkedAt: number;
}

interface Kept {
  picture: MarketPicture;
  etag: string | null;
  checkedAt: number;
}

type Fetched =
  | { kind: "picture"; picture: MarketPicture; etag: string | null }
  | { kind: "unchanged"; etag: string | null }
  | { kind: "none" };

/** The bytes as a picture the market serves, or null: over the cap, or not WebP, PNG or JPEG. */
export function asPicture(bytes: Uint8Array): MarketPicture | null {
  if (bytes.byteLength > MARKET_PICTURE_MAX_BYTES) return null;
  const format = sniffIconFormat(bytes);
  return format !== null && SERVED.has(format)
    ? { bytes, format: format as MarketPictureFormat }
    : null;
}

export function marketPictures({
  dir,
  proxy = () => [],
  fetchImpl = fetch,
  now = Date.now,
  log = () => undefined,
}: MarketPicturesOptions): MarketPictures {
  const inFlight = new Map<string, Promise<MarketPicture | null>>();
  const revalidating = new Map<string, Promise<void>>();
  const failedAt = new Map<string, number>();

  // The fetch slots: a release hands its slot straight to the next waiter, so the count never
  // passes the cap between a release and the waiter's turn.
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = (): Promise<void> => {
    if (active < PICTURE_FETCHES_AT_ONCE) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next !== undefined) next();
    else active -= 1;
  };

  const files = (url: string) => {
    const key = createHash("sha256").update(url).digest("hex");
    return { bytes: path.join(dir, `${key}.img`), record: path.join(dir, `${key}.json`) };
  };

  // What is on disk for the URL, read back through the same check a fetch goes through: a file
  // changed by hand into something that is not a picture is not served.
  const readKept = async (url: string): Promise<Kept | null> => {
    const at = files(url);
    try {
      const record = JSON.parse(await fs.readFile(at.record, "utf8")) as Partial<KeptRecord>;
      const picture = asPicture(new Uint8Array(await fs.readFile(at.bytes)));
      if (picture === null || record.url !== url) return null;
      return {
        picture,
        etag: typeof record.etag === "string" ? record.etag : null,
        checkedAt: typeof record.checkedAt === "number" ? record.checkedAt : 0,
      };
    } catch {
      return null;
    }
  };

  // The bytes first, then the record that vouches for them. A copy that cannot be written is
  // only a copy: the picture fetched is still served.
  const keep = async (url: string, record: KeptRecord, picture: MarketPicture | null) => {
    const at = files(url);
    try {
      await fs.mkdir(dir, { recursive: true });
      if (picture !== null) await atomicWriteFile(at.bytes, picture.bytes);
      await atomicWriteFile(at.record, JSON.stringify(record));
    } catch (err) {
      log(`[plugin-market] ${url}: not kept: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const fetchPicture = async (url: string, etag: string | null): Promise<Fetched> => {
    for (const address of [url, ...pluginProxyMirrors(url, proxy())]) {
      await acquire();
      try {
        const res = await fetchImpl(address, {
          headers: {
            "user-agent": userAgent(),
            ...(etag !== null ? { "if-none-match": etag } : {}),
          },
          signal: AbortSignal.timeout(PICTURE_TIMEOUT_MS),
        });
        if (res.status === 304 && etag !== null) {
          await res.body?.cancel().catch(() => undefined);
          return { kind: "unchanged", etag: res.headers.get("etag") ?? etag };
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => undefined);
          continue;
        }
        const bytes = await readCapped(res, MARKET_PICTURE_MAX_BYTES);
        const picture = bytes === null ? null : asPicture(bytes);
        if (picture === null) {
          log(
            `[plugin-market] ${address}: refused: not a WebP, PNG or JPEG picture of 2 MB or less`,
          );
          continue;
        }
        return { kind: "picture", picture, etag: res.headers.get("etag") };
      } catch {
        // Not reached, timed out or cut off: the next address.
      } finally {
        release();
      }
    }
    return { kind: "none" };
  };

  // Behind an answer already given from disk: the outcome only moves what is kept. A source that
  // is down leaves the copy standing and is asked again a day later, not on every read.
  const revalidate = (url: string, kept: Kept) => {
    if (revalidating.has(url)) return;
    const work = (async () => {
      const got = await fetchPicture(url, kept.etag);
      const checkedAt = now();
      if (got.kind === "picture") await keep(url, { url, etag: got.etag, checkedAt }, got.picture);
      else {
        const etag = got.kind === "unchanged" ? got.etag : kept.etag;
        await keep(url, { url, etag, checkedAt }, null);
      }
    })().finally(() => revalidating.delete(url));
    revalidating.set(url, work);
  };

  const load = async (url: string): Promise<MarketPicture | null> => {
    const kept = await readKept(url);
    if (kept !== null) {
      if (now() - kept.checkedAt >= MARKET_PICTURE_FRESH_MS) revalidate(url, kept);
      return kept.picture;
    }
    const failed = failedAt.get(url);
    if (failed !== undefined && now() - failed < PICTURE_RETRY_MS) return null;
    const got = await fetchPicture(url, null);
    if (got.kind !== "picture") {
      failedAt.set(url, now());
      return null;
    }
    failedAt.delete(url);
    await keep(url, { url, etag: got.etag, checkedAt: now() }, got.picture);
    return got.picture;
  };

  return {
    get: (url) => {
      let work = inFlight.get(url);
      if (work === undefined) {
        work = load(url).finally(() => inFlight.delete(url));
        inFlight.set(url, work);
      }
      return work;
    },
    settled: async () => {
      while (revalidating.size > 0) await Promise.all([...revalidating.values()]);
    },
  };
}
