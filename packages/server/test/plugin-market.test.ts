/**
 * The plugin market's curation (GET /api/plugins/market) and its pictures (GET …/market/asset).
 * The one fake is the fetch the document source and the picture cache are handed; the pictures are
 * kept in a real temp directory.
 *
 * The document:
 * - Given the published document off, or its source down, the document embedded in the build
 *   answers, named `embedded`.
 * - Given the published document answers, it replaces the embedded one: its lists as written, every
 *   picture named by this server's own route, keys schema 1 does not define dropped.
 * - Given its source has not answered within 1.5 s, the embedded one answers at once, and the
 *   published one answers the next read once it has arrived.
 * - Given the URL itself cannot be reached, the document is fetched through the deployment's
 *   mirror rules.
 * - Given a published document that breaks a rule of schema 1, or names another schema, it is not
 *   used at all: the embedded one stands.
 * - Given a document a previous App fetched, the next App answers with it while its source is down.
 * - PENGUIN_PLUGIN_MARKET unset or blank reads the community document, `off` reads none, a URL
 *   replaces it.
 * - Given a document with a popularity block (placeholder install counts), the block is answered
 *   as written; given one that does not read, the block is left out and the rest of the document
 *   still answers.
 *
 * The pictures:
 * - Given a path the embedded document names and a cover the build ships there, the shipped cover
 *   is served and nothing is fetched, with the published document off too; what the build does not
 *   ship (a screenshot) is fetched and kept as before, and with the document off it is 404.
 * - Given a path the document names, the picture is fetched from beside the published document and
 *   served typed by its bytes, with nosniff, same-origin CORP and a day's private cache.
 * - Given a path the document does not name, it is 404 and nothing is fetched.
 * - Given bytes that are not a WebP, PNG or JPEG picture of 2 MB or less, they are refused (404)
 *   and nothing is kept.
 * - Given two requests for one picture at once, it is fetched once.
 * - Given a kept picture and its source down, a later App serves it from disk.
 * - Given a kept picture older than a day, it is served at once and revalidated behind the answer
 *   by its ETag; an unchanged answer keeps it, and it is not asked for again that day.
 *
 * Through the App: the market needs a session; with the published document off, a signed-in user
 * reads the embedded document and the covers the build ships, and no other picture can be had
 * (the shipped covers are found beside the module, where a checkout keeps them); with the
 * published document on, a picture the App keeps lands
 * under the data root's `.cache/plugin-market/`, and the data root gains no name a Project id could
 * take (Projects live at its top level).
 */
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginMarketResponse } from "../src/api/types.js";
import { resolveServerConfig } from "../src/config.js";
import { pluginMarketRoutes } from "../src/http/routes/plugin-market.js";
import builtinMarket from "../../../library/plugin/src/builtin-market.json" with { type: "json" };
import {
  MARKET_DOCUMENT_URL,
  embeddedMarketDocument,
  marketSource,
  parseMarketDocument,
} from "../src/plugin/market.js";
import type { MarketSnapshot } from "../src/plugin/market.js";
import { MARKET_PICTURE_FRESH_MS, marketPictures } from "../src/plugin/market-pictures.js";
import type { MarketPictures } from "../src/plugin/market-pictures.js";
import type { PluginProxyRule } from "../src/plugin/registry.js";
import { fakeFetch, fetchFailed, jsonResponse, stubFetch } from "./fixtures/fetch.js";
import type { FetchCall, FetchFake } from "./fixtures/fetch.js";
import { createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const DOC_URL = "https://market.example/plugins/market.json";
const MIRROR: PluginProxyRule = {
  kind: "rewrite",
  match: "^https://market\\.example/(.*)$",
  rewrite: "https://mirror.example/$1",
};

/** The first bytes of each format, as much of one as its format is told by. */
const WEBP = new Uint8Array([...Buffer.from("RIFF\x0c\x00\x00\x00WEBPVP8 ", "latin1")]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const GIF = new Uint8Array([...Buffer.from("GIF89a\x01\x00", "latin1")]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

const DOC = {
  schema: 1,
  updated: "2026-11-17",
  hero: ["@example/alpha"],
  selected: ["@example/alpha", "@example/beta"],
  plugins: {
    "@example/alpha": {
      cover: { src: "alpha/cover.webp", thumb: "alpha/cover-640.webp", tone: "#745fac" },
      screenshots: [{ src: "alpha/shot-1.webp", caption: "One.", captionZh: "一。" }],
      rating: 5,
    },
    "@example/gamma": { icon: "gamma/icon.png" },
  },
  signals: { downloads: 3 },
};

/** A route of the listing, as a regex over the URL the listing names a picture by. */
const routeOf = (picturePath: string) =>
  new RegExp(
    `^/api/plugins/market/asset\\?path=${picturePath.replaceAll(".", "\\.")}&rev=[0-9a-f]{12}$`,
  );

const picture = (bytes: Uint8Array, headers: Record<string, string> = {}) =>
  new Response(bytes, { status: 200, headers });

/** Answers the document URL with `doc`, a picture URL by `pictures`, anything else 404. */
function site(
  doc: unknown,
  pictures: Record<string, () => Response | Promise<Response>> = {},
): (call: FetchCall) => Response | Promise<Response> {
  return (call) => {
    if (call.url === DOC_URL) return jsonResponse(doc);
    const answer = pictures[call.url];
    return answer === undefined ? new Response("missing", { status: 404 }) : answer();
  };
}

const down = () => {
  throw fetchFailed("ECONNREFUSED");
};

describe("the plugin market", () => {
  let dir: string;
  let clock: number;
  const now = () => clock;
  let cache: MarketPictures[];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "penguin-market-"));
    clock = Date.parse("2026-11-17T08:00:00Z");
    cache = [];
  });
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(cache.map((p) => p.settled()));
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * The two routes over a document source and a picture cache, both reading `remote`, and the
   * folder of shipped covers when `bundled` names one.
   */
  const market = (
    remote: FetchFake,
    {
      url = DOC_URL,
      proxy = [],
      seed = null,
      bundled = null,
    }: {
      url?: string | null;
      proxy?: PluginProxyRule[];
      seed?: MarketSnapshot | null;
      bundled?: string | null;
    } = {},
  ) => {
    const pictures = marketPictures({ dir, proxy: () => proxy, fetchImpl: remote.fetch, now });
    cache.push(pictures);
    const source = marketSource({ url, proxy: () => proxy, fetchImpl: remote.fetch, now, seed });
    return pluginMarketRoutes({ source, pictures, bundled: () => bundled });
  };
  const listing = async (routes: ReturnType<typeof market>) => {
    const res = await routes.request("/");
    expect(res.status).toBe(200);
    return (await res.json()) as PluginMarketResponse;
  };
  const asset = (routes: ReturnType<typeof market>, picturePath: string) =>
    routes.request(`/asset?path=${encodeURIComponent(picturePath)}`);
  const kept = async () => (await readdir(dir).catch(() => [])).length;

  describe("the document", () => {
    it("answers with the embedded document while the published one is off or its source is down", async () => {
      for (const routes of [market(fakeFetch(down), { url: null }), market(fakeFetch(down))]) {
        const body = await listing(routes);
        expect(body.source).toBe("embedded");
        expect(body.hero).toEqual(builtinMarket.hero);
        expect(body.selected).toEqual(builtinMarket.selected);
        expect(Object.keys(body.art).sort()).toEqual(Object.keys(builtinMarket.plugins).sort());
      }
    });

    it("answers with the published document once it has answered: its lists, pictures by this server's route, unknown keys dropped", async () => {
      const body = await listing(market(fakeFetch(site(DOC))));
      expect(body).toEqual({
        hero: ["@example/alpha"],
        selected: ["@example/alpha", "@example/beta"],
        art: {
          "@example/alpha": {
            cover: {
              url: expect.stringMatching(routeOf("alpha/cover.webp")),
              thumbUrl: expect.stringMatching(routeOf("alpha/cover-640.webp")),
              tone: "#745fac",
            },
            screenshots: [
              {
                url: expect.stringMatching(routeOf("alpha/shot-1.webp")),
                caption: "One.",
                captionZh: "一。",
              },
            ],
          },
          "@example/gamma": { icon: { url: expect.stringMatching(routeOf("gamma/icon.png")) } },
        },
        source: "published",
      } satisfies PluginMarketResponse);
    });

    it("answers with the embedded document while the first fetch is out past 1.5 s, and with the published one once it has arrived", async () => {
      vi.useFakeTimers();
      let answer!: (res: Response) => void;
      const remote = fakeFetch(() => new Promise<Response>((resolve) => (answer = resolve)));
      const routes = market(remote);
      const first = routes.request("/");
      await vi.advanceTimersByTimeAsync(1_500);
      expect(((await (await first).json()) as PluginMarketResponse).source).toBe("embedded");

      answer(jsonResponse(DOC));
      await vi.advanceTimersByTimeAsync(0);
      const second = await listing(routes);
      expect(second.source).toBe("published");
      expect(second.selected).toEqual(DOC.selected);
      expect(remote.calls).toHaveLength(1);
    });

    it("fetches the document through the deployment's mirror rules when its URL cannot be reached", async () => {
      const remote = fakeFetch((call) => {
        if (call.url === DOC_URL) throw fetchFailed("ETIMEDOUT");
        if (call.url === "https://mirror.example/plugins/market.json") return jsonResponse(DOC);
        return new Response("missing", { status: 404 });
      });
      const body = await listing(market(remote, { proxy: [MIRROR] }));
      expect(body.source).toBe("published");
      expect(remote.calls.map((c) => c.url)).toEqual([
        DOC_URL,
        "https://mirror.example/plugins/market.json",
      ]);
    });

    const broken: Array<[string, unknown]> = [
      ["schema 2", { ...DOC, schema: 2 }],
      ["no schema", { ...DOC, schema: undefined }],
      ["a list, not an object", [DOC]],
      ["no updated date", { ...DOC, updated: "yesterday" }],
      ["a hero that is not selected", { ...DOC, hero: ["@example/gamma"] }],
      ["no hero at all", { ...DOC, hero: [] }],
      [
        "six heroes",
        { ...DOC, hero: ["a", "b", "c", "d", "e", "f"], selected: ["a", "b", "c", "d", "e", "f"] },
      ],
      ["thirteen selected", { ...DOC, selected: [...DOC.selected, ..."abcdefghijk".split("")] }],
      ["a name twice", { ...DOC, selected: ["@example/alpha", "@example/alpha"] }],
      ["a name that is not a string", { ...DOC, selected: ["@example/alpha", 7] }],
      ["no plugins object", { ...DOC, plugins: [] }],
      [
        "a path that climbs out",
        { ...DOC, plugins: { "@x/y": { cover: { src: "../secret.webp" } } } },
      ],
      ["an absolute path", { ...DOC, plugins: { "@x/y": { cover: { src: "/x/cover.webp" } } } }],
      ["an upper-case path", { ...DOC, plugins: { "@x/y": { cover: { src: "x/Cover.webp" } } } }],
      ["an SVG picture", { ...DOC, plugins: { "@x/y": { icon: "x/icon.svg" } } }],
      ["a GIF screenshot", { ...DOC, plugins: { "@x/y": { screenshots: [{ src: "x/s.gif" }] } } }],
      ["a cover without src", { ...DOC, plugins: { "@x/y": { cover: { thumb: "x/c.webp" } } } }],
      [
        "a tone that is not #rrggbb",
        { ...DOC, plugins: { "@x/y": { cover: { src: "x/c.webp", tone: "red" } } } },
      ],
      [
        "a caption that is not text",
        { ...DOC, plugins: { "@x/y": { screenshots: [{ src: "x/s.webp", caption: 1 }] } } },
      ],
      [
        "seven screenshots",
        {
          ...DOC,
          plugins: {
            "@x/y": { screenshots: Array.from({ length: 7 }, () => ({ src: "x/s.webp" })) },
          },
        },
      ],
    ];
    it.each(broken)(
      "leaves the embedded document standing over a published one with %s",
      async (_case, doc) => {
        const body = await listing(market(fakeFetch(site(doc))));
        expect(body.source).toBe("embedded");
        expect(body.selected).toEqual(builtinMarket.selected);
      },
    );

    it("answers with the document a previous App fetched while its source is down", async () => {
      const seed = { at: clock, document: parseMarketDocument(DOC, "a previous App") };
      const remote = fakeFetch(down);
      const body = await listing(market(remote, { seed }));
      expect(body.source).toBe("published");
      expect(body.selected).toEqual(DOC.selected);
      expect(remote.calls).toHaveLength(0);
    });

    it("reads PENGUIN_PLUGIN_MARKET: unset or blank is the community document, off is none, a URL replaces it", () => {
      const at = (value: string | undefined) =>
        resolveServerConfig(value === undefined ? {} : { PENGUIN_PLUGIN_MARKET: value })
          .pluginMarketUrl;
      expect(at(undefined)).toBe(MARKET_DOCUMENT_URL);
      expect(at("  ")).toBe(MARKET_DOCUMENT_URL);
      expect(at("off")).toBeNull();
      expect(at("OFF")).toBeNull();
      expect(at(DOC_URL)).toBe(DOC_URL);
    });

    // Placeholder install counts, in the shape a real install-count API will publish as "live".
    const POPULARITY = {
      source: "placeholder",
      generatedAt: "2026-11-17",
      items: {
        "@example/alpha": { installs: 4180, weekly: 162 },
        "@example/beta": { installs: 230, weekly: 9 },
      },
    };

    it("answers a popularity block as the document writes it", async () => {
      const body = await listing(market(fakeFetch(site({ ...DOC, popularity: POPULARITY }))));
      expect(body.popularity).toEqual(POPULARITY);
    });

    const unreadable: Array<[string, unknown]> = [
      ["a source other than placeholder or live", { ...POPULARITY, source: "estimate" }],
      ["no generatedAt date", { ...POPULARITY, generatedAt: "today" }],
      ["items that are a list", { ...POPULARITY, items: [] }],
      [
        "a negative count",
        { ...POPULARITY, items: { "@example/alpha": { installs: -1, weekly: 0 } } },
      ],
      [
        "a fractional count",
        { ...POPULARITY, items: { "@example/alpha": { installs: 9.5, weekly: 1 } } },
      ],
      [
        "more installs this week than in all",
        { ...POPULARITY, items: { "@example/alpha": { installs: 5, weekly: 9 } } },
      ],
    ];
    it.each(unreadable)(
      "leaves out a popularity block with %s, and the rest of the published document still answers",
      async (_case, popularity) => {
        const body = await listing(market(fakeFetch(site({ ...DOC, popularity }))));
        expect(body.source).toBe("published");
        expect(body.selected).toEqual(DOC.selected);
        expect(body).not.toHaveProperty("popularity");
      },
    );
  });

  describe("the pictures", () => {
    /** A plugin of the embedded document with a cover and a screenshot: what a build ships and what it does not. */
    const shipped = (() => {
      const entry = Object.values(embeddedMarketDocument().plugins).find(
        (p) => p.cover !== undefined && (p.screenshots?.length ?? 0) > 0,
      )!;
      return { cover: entry.cover!.src, shot: entry.screenshots![0]!.src };
    })();
    /** A folder of shipped covers holding `bytes` at the embedded document's cover path. */
    const shippedCovers = async (bytes: Uint8Array) => {
      const folder = path.join(dir, "shipped");
      await mkdir(path.dirname(path.join(folder, shipped.cover)), { recursive: true });
      await writeFile(path.join(folder, shipped.cover), bytes);
      return folder;
    };

    it("serves a cover the build ships without fetching, with the published document off too; an unshipped screenshot is then 404", async () => {
      const remote = fakeFetch(down);
      const routes = market(remote, { url: null, bundled: await shippedCovers(WEBP) });
      const res = await asset(routes, shipped.cover);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/webp");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(WEBP);
      expect((await asset(routes, shipped.shot)).status).toBe(404);
      expect(remote.calls).toHaveLength(0);
    });

    it("fetches and keeps what the build does not ship, while a shipped cover still costs no fetch", async () => {
      const shotUrl = new URL(shipped.shot, DOC_URL).href;
      const remote = fakeFetch((call) => {
        if (call.url === shotUrl) return picture(PNG);
        throw fetchFailed("ECONNREFUSED");
      });
      const routes = market(remote, { bundled: await shippedCovers(WEBP) });
      expect((await asset(routes, shipped.shot)).headers.get("content-type")).toBe("image/png");
      expect((await asset(routes, shipped.cover)).status).toBe(200);
      expect(remote.calls.map((c) => c.url)).not.toContain(new URL(shipped.cover, DOC_URL).href);
      expect(remote.calls.map((c) => c.url)).toContain(shotUrl);
    });

    const COVER = "https://market.example/plugins/alpha/cover.webp";
    const THUMB = "https://market.example/plugins/alpha/cover-640.webp";

    it("serves a named picture fetched from beside the document, typed by its bytes, with nosniff, same-origin CORP and a day's private cache", async () => {
      const remote = fakeFetch(
        site(DOC, { [COVER]: () => picture(WEBP), [THUMB]: () => picture(PNG) }),
      );
      const routes = market(remote);
      const cover = await asset(routes, "alpha/cover.webp");
      expect(cover.status).toBe(200);
      expect(new Uint8Array(await cover.arrayBuffer())).toEqual(WEBP);
      expect(Object.fromEntries(cover.headers)).toMatchObject({
        "content-type": "image/webp",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
        "cache-control": "private, max-age=86400",
      });
      // A name is only a claim: the thumbnail is a PNG, whatever its extension says.
      const thumb = await asset(routes, "alpha/cover-640.webp");
      expect(thumb.headers.get("content-type")).toBe("image/png");
      expect(remote.calls.map((c) => c.url)).toEqual([DOC_URL, COVER, THUMB]);
    });

    it("fetches a picture through the mirror rules when its URL answers nothing", async () => {
      const remote = fakeFetch(
        site(DOC, { "https://mirror.example/plugins/alpha/cover.webp": () => picture(WEBP) }),
      );
      const res = await asset(market(remote, { proxy: [MIRROR] }), "alpha/cover.webp");
      expect(res.status).toBe(200);
      expect(remote.calls.map((c) => c.url)).toContain(COVER);
    });

    it.each(["other/cover.webp", "../market.json", "alpha/cover.webp?x=1"])(
      "answers %s, which the document does not name, with 404 and fetches nothing",
      async (unnamed) => {
        const remote = fakeFetch(site(DOC, { [COVER]: () => picture(WEBP) }));
        const res = await asset(market(remote), unnamed);
        expect(res.status).toBe(404);
        expect(remote.calls.map((c) => c.url)).toEqual([DOC_URL]);
      },
    );

    const refused: Array<[string, () => Response]> = [
      ["text", () => picture(new TextEncoder().encode("<html>not found</html>"))],
      ["an SVG", () => picture(SVG)],
      ["a GIF", () => picture(GIF)],
      ["a picture over 2 MB", () => picture(WEBP, { "content-length": String(3 * 1024 * 1024) })],
    ];
    it.each(refused)("refuses %s from the source and keeps nothing", async (_case, answer) => {
      const res = await asset(
        market(fakeFetch(site(DOC, { [COVER]: answer }))),
        "alpha/cover.webp",
      );
      expect(res.status).toBe(404);
      expect(await kept()).toBe(0);
    });

    it("fetches one picture once while two requests wait on it", async () => {
      let answer!: (res: Response) => void;
      const remote = fakeFetch(
        site(DOC, { [COVER]: () => new Promise<Response>((resolve) => (answer = resolve)) }),
      );
      const routes = market(remote);
      await listing(routes);
      const first = asset(routes, "alpha/cover.webp");
      const second = asset(routes, "alpha/cover.webp");
      await vi.waitFor(() => expect(remote.calls.map((c) => c.url)).toContain(COVER));
      answer(picture(WEBP));
      expect([(await first).status, (await second).status]).toEqual([200, 200]);
      expect(remote.calls.filter((c) => c.url === COVER)).toHaveLength(1);
    });

    it("serves a kept picture from disk in a later App while its source is down", async () => {
      const first = market(fakeFetch(site(DOC, { [COVER]: () => picture(WEBP) })));
      expect((await asset(first, "alpha/cover.webp")).status).toBe(200);

      clock += 2 * MARKET_PICTURE_FRESH_MS;
      const seed = { at: clock, document: parseMarketDocument(DOC, "a previous App") };
      const later = market(fakeFetch(down), { seed });
      const res = await asset(later, "alpha/cover.webp");
      expect(res.status).toBe(200);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(WEBP);
    });

    it("revalidates a picture kept for over a day by its ETag behind the answer, and keeps it when unchanged", async () => {
      const first = market(
        fakeFetch(site(DOC, { [COVER]: () => picture(WEBP, { etag: '"v1"' }) })),
      );
      expect((await asset(first, "alpha/cover.webp")).status).toBe(200);

      clock += MARKET_PICTURE_FRESH_MS + 1;
      const remote = fakeFetch(site(DOC, { [COVER]: () => new Response(null, { status: 304 }) }));
      const routes = market(remote);
      expect((await asset(routes, "alpha/cover.webp")).status).toBe(200);
      await cache.at(-1)!.settled();
      const revalidation = remote.calls.find((c) => c.url === COVER);
      expect(revalidation?.headers.get("if-none-match")).toBe('"v1"');

      // Checked just now: served from disk without asking again.
      const again = await asset(routes, "alpha/cover.webp");
      expect(new Uint8Array(await again.arrayBuffer())).toEqual(WEBP);
      expect(remote.calls.filter((c) => c.url === COVER)).toHaveLength(1);
    });
  });
});

describe("the plugin market through the App", () => {
  let t: TestApp;
  let cookie: string;
  beforeAll(async () => {
    t = await createTestApp();
    cookie = (await loginAdmin(t.app)).cookie;
  });
  afterAll(async () => {
    await t.cleanup();
  });

  it("needs a session", async () => {
    expect((await t.app.request("/api/plugins/market")).status).toBe(401);
  });

  it("with the published document off, answers the embedded document, the covers the build ships and no other picture", async () => {
    const res = await t.app.request("/api/plugins/market", { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PluginMarketResponse;
    expect(body.source).toBe("embedded");
    expect(body.selected).toEqual(embeddedMarketDocument().selected);
    const entry = Object.values(embeddedMarketDocument().plugins).find(
      (p) => p.cover !== undefined && (p.screenshots?.length ?? 0) > 0,
    )!;
    const get = (picturePath: string) =>
      t.app.request(`/api/plugins/market/asset?path=${picturePath}`, { headers: { cookie } });
    const cover = await get(entry.cover!.src);
    expect(cover.status).toBe(200);
    expect(cover.headers.get("content-type")).toBe("image/webp");
    expect((await get(entry.screenshots![0]!.src)).status).toBe(404);
  });
});

describe("the plugin market through the App, with the published document on", () => {
  const COVER = "https://market.example/plugins/alpha/cover.webp";
  let t: TestApp;
  let cookie: string;
  let remote: FetchFake;
  beforeAll(async () => {
    // In place before the App boots: the market takes the global fetch when it is set up.
    remote = stubFetch(site(DOC, { [COVER]: () => picture(WEBP) }));
    t = await createTestApp({ config: { pluginMarketUrl: DOC_URL } });
    cookie = (await loginAdmin(t.app)).cookie;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    await t.cleanup();
  });

  it("keeps a fetched picture under the data root's .cache/, and claims no name a Project could take", async () => {
    const before = new Set(await readdir(t.root));
    const res = await t.app.request("/api/plugins/market/asset?path=alpha/cover.webp", {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(remote.calls.map((c) => c.url)).toContain(COVER);
    expect(await readdir(path.join(t.root, ".cache", "plugin-market"))).toHaveLength(2);
    const added = (await readdir(t.root)).filter((name) => !before.has(name));
    expect(added).toContain(".cache");
    // Every Project id rule excludes ".": a dot-prefixed name is the one no Project can have.
    expect(added.filter((name) => !name.startsWith("."))).toEqual([]);
  });
});
