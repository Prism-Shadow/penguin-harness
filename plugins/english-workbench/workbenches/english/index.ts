/**
 * English Learning Workbench: the handler.
 *
 * Keeps the learner's record as one document in the workbench's own state and, only while the
 * learner has switched it on, reads a fixed list of public RSS feeds for the daily press page.
 * It makes no other network request, keeps no accounts and reads no files. Web-standard APIs
 * only (fetch, URL, TextEncoder).
 *
 *   GET  /data                    -> { data, savedAt }   the learning record (null at first)
 *   PUT  /data      { data }      -> { ok, savedAt }     replaces it (POST is accepted too)
 *   GET  /settings                -> { online, hosts }
 *   PUT  /settings  { online }    -> { online, hosts }   whether /press may fetch the feeds
 *   GET  /press[?refresh=1]       -> { online, fetchedAt, items, hosts }
 *   POST /press/import-text       -> { item }            splits pasted text into paragraphs
 *
 * A refusal answers `{ error, message }`: `error` is a stable code the page shows in its own
 * language, `message` an English sentence for logs and for a page that does not know the code.
 * A press item's `topic` is a key ("world", "business", "culture", "tech", "science") the page
 * translates.
 */
import type { WorkbenchPackage, WorkbenchResponse } from "@prismshadow/penguin-server/plugin";

/* ---------------------------------------------------------------- types */
type Topic = "world" | "business" | "culture" | "tech" | "science";
type PressItem = {
  id: string;
  title: string;
  url: string;
  date: string | null;
  ts: number;
  summary: string;
  source: string;
  topic: Topic;
  image?: string;
};
type Doc = {
  data: { payload: unknown; savedAt: number } | null;
  press: { fetchedAt: number; items: PressItem[] };
  settings: { online: boolean };
};

const PRESS_TTL = 1000 * 60 * 20;
const MAX_DATA_BYTES = 700 * 1024;
const MAX_FEED_CHARS = 3_000_000;
const MAX_PASTE_CHARS = 200_000;
const MAX_PASTE_PARAGRAPHS = 400;
/** Says who is asking: the feeds' owners see this name in their logs. */
const USER_AGENT = "PenguinHarness-EnglishWorkbench/1.0";

const encoder = new TextEncoder();

/* ---------------------------------------------------------------- feeds */
/** The only addresses this handler ever requests: [feed URL, source name, topic]. */
const FEEDS: Array<[string, string, Topic]> = [
  ["https://feeds.npr.org/1002/rss.xml", "NPR World", "world"],
  ["https://feeds.npr.org/1006/rss.xml", "NPR Business", "business"],
  ["https://feeds.npr.org/1019/rss.xml", "NPR Culture", "culture"],
  ["https://feeds.a.dj.com/rss/RSSWorldNews.xml", "WSJ World", "world"],
  ["https://www.latimes.com/world-nation/rss2.0.xml", "LA Times", "world"],
  ["https://www.wired.com/feed/rss", "WIRED", "tech"],
  ["https://www.smithsonianmag.com/rss/latest_articles/", "Smithsonian", "culture"],
  ["https://www.sciencedaily.com/rss/top/science.xml", "ScienceDaily", "science"],
  ["https://www.nature.com/nature.rss", "Nature", "science"],
];
/** The hosts the page names next to the switch, derived from FEEDS so the two cannot drift. */
const HOSTS = Array.from(new Set(FEEDS.map(([url]) => new URL(url).hostname)));

const RX = {
  title: /<title[^>]*>([\s\S]*?)<\/title>/i,
  linktag: /<link[^>]*>([\s\S]*?)<\/link>/i,
  href: /<link[^>]*href="([^"]+)"/i,
  pubDate: /<pubDate>([\s\S]*?)<\/pubDate>/i,
  updated: /<updated>([\s\S]*?)<\/updated>/i,
  published: /<published>([\s\S]*?)<\/published>/i,
  description: /<description>([\s\S]*?)<\/description>/i,
  summary: /<summary[^>]*>([\s\S]*?)<\/summary>/i,
  content: /<content:encoded>([\s\S]*?)<\/content:encoded>/i,
  enclosure: /<enclosure[^>]+url\s*=\s*["']([^"']+)["']/i,
  mediaAny: /<media:(?:thumbnail|content)[^>]+url\s*=\s*["']([^"']+)["']/i,
  imgTag: /<img[^>]+(?:data-src|data-original|src)\s*=\s*["']([^"']+)["']/i,
};

/** A refusal or failure with the code the page translates. */
class Refusal extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Images that are plainly not a cover (tracking pixels, logos, QR codes), and image hosts known
 * to refuse being loaded from another site: those items show the page's own illustration.
 */
function looksLikeCover(u: string): boolean {
  if (!/^https:\/\//i.test(u)) return false;
  if (/npr\.brightspotcdn\.com|feeds\.a\.dj\.com|wsj\.net|dowjones/i.test(u)) return false;
  return !/pixel|1x1|tracking|spacer|blank\.|logo|avatar|icon|qrcode|qr_?code|emoji|sprite|placeholder/i.test(
    u,
  );
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"');
}

/** A numeric entity out of Unicode's range would make fromCodePoint throw and lose the feed. */
function safeCodePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

function plain(s: string): string {
  return decodeEntities(
    String(s || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function pick(xml: string, re: RegExp): string {
  const m = re.exec(xml);
  return m?.[1] ?? "";
}

function idOf(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + "-" + s.length.toString(36);
}

async function getFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const text = await res.text();
  if (text.length > MAX_FEED_CHARS) throw new Error("feed too large");
  return text;
}

/** The cover a feed item itself carries: media:thumbnail / media:content / enclosure / first img. */
function feedImage(block: string): string {
  const cands = [pick(block, RX.mediaAny), pick(block, RX.enclosure), pick(block, RX.imgTag)];
  for (const raw of cands) {
    const u = decodeEntities(raw).trim();
    if (looksLikeCover(u)) return u;
  }
  return "";
}

async function fetchFeed(url: string, source: string, topic: Topic): Promise<PressItem[]> {
  const xml = await getFeed(url);
  const blocks = xml.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  const items: PressItem[] = [];
  for (const b of blocks.slice(0, 12)) {
    const title = plain(pick(b, RX.title)).slice(0, 300);
    let link = plain(pick(b, RX.linktag));
    if (!link) link = decodeEntities(pick(b, RX.href)).trim();
    if (!/^https?:\/\//i.test(link) || link.length > 2000) continue;
    const dateRaw = pick(b, RX.pubDate) || pick(b, RX.updated) || pick(b, RX.published);
    const ts = dateRaw ? Date.parse(dateRaw) || 0 : 0;
    const summary = plain(
      pick(b, RX.description) || pick(b, RX.summary) || pick(b, RX.content),
    ).slice(0, 320);
    if (title.length < 12) continue;
    items.push({
      id: idOf(link),
      title,
      url: link,
      date: ts ? new Date(ts).toISOString() : null,
      ts,
      summary,
      source,
      topic,
      image: feedImage(b),
    });
  }
  return items;
}

async function refreshPress(log: (t: string) => void): Promise<PressItem[]> {
  const all: PressItem[] = [];
  const seen = new Set<string>();
  let failed = 0;
  await Promise.all(
    FEEDS.map(async ([url, source, topic]) => {
      try {
        const items = await fetchFeed(url, source, topic);
        for (const it of items) {
          if (!seen.has(it.id)) {
            seen.add(it.id);
            all.push(it);
          }
        }
      } catch (e) {
        failed += 1;
        log("feed failed " + source + ": " + String((e as Error).message || e));
      }
    }),
  );
  if (failed === FEEDS.length)
    throw new Refusal("feeds-unreachable", "None of the feeds answered.");
  all.sort((a, b) => b.ts - a.ts);
  const top = all.slice(0, 120);
  log("press: " + top.length + " items, " + top.filter((it) => it.image).length + " with a cover");
  return top;
}

/** What a page may see of the cache: no cover addresses while the learner keeps it offline. */
function visible(items: PressItem[], online: boolean): PressItem[] {
  if (online) return items;
  return items.map((it) => {
    const copy = { ...it };
    delete copy.image;
    return copy;
  });
}

/* ---------------------------------------------------------------- handler */
export default {
  modules: {
    Workbench: {
      create({ use }) {
        const host = use.host;
        let queue: Promise<unknown> = Promise.resolve();
        let pressJob: Promise<PressItem[]> | null = null;

        /** The state as this version writes it; anything else an older copy left is dropped. */
        function readDoc(): Doc {
          const raw = (host.getState() ?? {}) as Partial<Doc>;
          const data =
            raw.data && typeof raw.data === "object" && typeof raw.data.savedAt === "number"
              ? raw.data
              : null;
          const press =
            raw.press && Array.isArray(raw.press.items)
              ? raw.press
              : { fetchedAt: 0, items: [] as PressItem[] };
          const online = !!(raw.settings && raw.settings.online === true);
          return { data, press, settings: { online } };
        }

        function mutate<T>(fn: (doc: Doc) => T | Promise<T>): Promise<T> {
          const run = queue.then(async () => {
            const doc = readDoc();
            const out = await fn(doc);
            await host.setState(doc);
            return out;
          });
          queue = run.then(
            () => undefined,
            () => undefined,
          );
          return run;
        }

        async function pressItems(
          force: boolean,
        ): Promise<{ fetchedAt: number; items: PressItem[] }> {
          const doc = readDoc();
          const fresh = doc.press.fetchedAt > 0 && Date.now() - doc.press.fetchedAt < PRESS_TTL;
          if (!force && fresh && doc.press.items.length) return doc.press;
          // One refresh at a time: a request that arrives during one waits for the same result.
          let job = pressJob;
          if (!job) {
            job = refreshPress((t) => host.log(t)).then(async (items) => {
              await mutate((d) => {
                d.press = { fetchedAt: Date.now(), items };
              });
              return items;
            });
            pressJob = job;
            job.then(
              () => {
                pressJob = null;
              },
              () => {
                pressJob = null;
              },
            );
          }
          const items = await job;
          return { fetchedAt: readDoc().press.fetchedAt || Date.now(), items };
        }

        return {
          api: {
            main: {
              async handle(req): Promise<WorkbenchResponse> {
                const path = req.path.replace(/\/+$/, "") || "/";
                const method = req.method.toUpperCase();
                const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
                  string,
                  unknown
                >;
                const json = (b: unknown, status?: number): WorkbenchResponse => ({
                  status,
                  body: b,
                });
                const refuse = (status: number, error: string, message: string) =>
                  json({ error, message }, status);

                /* ---- the learning record: one document, no accounts ---- */
                if (path === "/data") {
                  if (method === "GET") {
                    const doc = readDoc();
                    return json({
                      data: doc.data ? doc.data.payload : null,
                      savedAt: doc.data ? doc.data.savedAt : 0,
                    });
                  }
                  if (method === "PUT" || method === "POST") {
                    // A body without `data` is a mistake, not a request to wipe the record.
                    if (!("data" in body))
                      return refuse(400, "data-missing", "The request carries no data field.");
                    const data = body.data ?? null;
                    if (data !== null && (typeof data !== "object" || Array.isArray(data)))
                      return refuse(400, "data-invalid", "The record must be an object.");
                    const size = encoder.encode(JSON.stringify(data)).length;
                    if (size > MAX_DATA_BYTES)
                      return refuse(413, "data-too-large", "The record is larger than 700 KB.");
                    return await mutate((doc) => {
                      const savedAt = Date.now();
                      doc.data = { payload: data, savedAt };
                      return json({ ok: true, savedAt });
                    });
                  }
                }

                /* ---- settings: the press feed is off until the learner turns it on ---- */
                if (path === "/settings") {
                  if (method === "GET")
                    return json({ online: readDoc().settings.online, hosts: HOSTS });
                  if (method === "PUT" || method === "POST") {
                    if (typeof body.online !== "boolean")
                      return refuse(400, "online-invalid", "online must be true or false.");
                    const online = body.online as boolean;
                    await mutate((doc) => {
                      doc.settings.online = online;
                    });
                    return json({ online, hosts: HOSTS });
                  }
                }

                /* ---- daily press: the fixed feed list, only while online ---- */
                if (path === "/press" && method === "GET") {
                  const doc = readDoc();
                  const online = doc.settings.online;
                  if (!online) {
                    return json({
                      online,
                      hosts: HOSTS,
                      fetchedAt: doc.press.fetchedAt,
                      items: visible(doc.press.items, false),
                    });
                  }
                  try {
                    const press = await pressItems(req.query.refresh === "1");
                    return json({
                      online,
                      hosts: HOSTS,
                      fetchedAt: press.fetchedAt,
                      items: press.items,
                    });
                  } catch (e) {
                    const cached = readDoc().press;
                    return json(
                      {
                        error: e instanceof Refusal ? e.code : "press-failed",
                        message: "Fetching the feeds failed: " + String((e as Error).message || e),
                        online,
                        hosts: HOSTS,
                        items: cached.items,
                        fetchedAt: cached.fetchedAt,
                      },
                      502,
                    );
                  }
                }

                /* ---- import pasted text: no network ---- */
                if (path === "/press/import-text" && method === "POST") {
                  // The page sends defaults in its own language; these cover a caller that does not.
                  const title =
                    String(body.title || "")
                      .trim()
                      .slice(0, 200) || "Pasted article";
                  const source =
                    String(body.source || "")
                      .trim()
                      .slice(0, 80) || "Pasted";
                  const url = String(body.url || "").trim();
                  if (url && (!/^https?:\/\//i.test(url) || url.length > 2000))
                    return refuse(
                      400,
                      "url-invalid",
                      "The link must start with http:// or https://.",
                    );
                  const raw = String(body.text || "");
                  if (raw.length > MAX_PASTE_CHARS)
                    return refuse(413, "text-too-long", "The text is over 200,000 characters.");
                  const paragraphs = raw
                    .split(/\r?\n\s*\r?\n/)
                    .map((p) => p.replace(/\s+/g, " ").trim())
                    .filter((p) => p.length > 0)
                    .slice(0, MAX_PASTE_PARAGRAPHS);
                  if (paragraphs.join(" ").split(/\s+/).length < 40)
                    return refuse(400, "text-too-short", "The text has fewer than 40 words.");
                  return json({
                    item: {
                      id: idOf(title + Date.now()),
                      title,
                      url,
                      source,
                      paragraphs,
                      ts: Date.now(),
                      date: new Date().toISOString(),
                    },
                  });
                }

                return refuse(404, "not-found", "No such route: " + path);
              },
            },
          },
        };
      },
    },
  },
} satisfies WorkbenchPackage;
