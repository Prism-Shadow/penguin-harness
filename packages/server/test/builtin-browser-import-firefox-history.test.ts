/**
 * Firefox cookie import and history import from both families (builtin-browser/import):
 * Firefox's seconds-or-milliseconds `expiry`, its SameSite values and single-context cookies;
 * Chromium's 1601-epoch visit times and Firefox's microseconds; http(s) only, hidden pages
 * out, newest first, capped. Also the private copy every read goes through: it sees what the
 * write-ahead log holds, and leaves nothing behind in the temp directory.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listImportSources,
  readCookies,
  readHistory,
} from "../src/builtin-browser/import/index.js";
import { HISTORY_LIMIT } from "../src/builtin-browser/import/history.js";
import { unreadableStoreWarning } from "../src/builtin-browser/import/sqlite-copy.js";
import {
  DAY,
  FakeMachine,
  nowSeconds,
  writeChromiumCookies,
  writeChromiumHistory,
  writeFirefoxCookies,
  writeFirefoxPlaces,
  writeProfilesIni,
} from "./builtin-browser-import-fixtures.js";

const sqlite = process.getBuiltinModule("node:sqlite");

let machine: FakeMachine;
afterEach(() => machine.cleanup());

/** A Linux machine with one Firefox profile; returns the profile directory. */
function linuxFirefox(): string {
  machine = new FakeMachine("linux");
  const root = machine.path(".mozilla", "firefox");
  writeProfilesIni(root, [{ name: "default-release", path: "k3y.default-release" }]);
  return path.join(root, "k3y.default-release");
}

const firstSource = () => listImportSources(machine.env())[0]!;

describe("Firefox cookies", () => {
  it("reads expiry in seconds or milliseconds by magnitude and maps SameSite", async () => {
    const profile = linuxFirefox();
    const future = nowSeconds() + 10 * DAY;
    writeFirefoxCookies(path.join(profile, "cookies.sqlite"), [
      { host: ".github.com", name: "seconds", value: "a", expiry: future, sameSite: 1 },
      { host: "github.com", name: "millis", value: "b", expiry: future * 1000 + 999, sameSite: 2 },
      { host: ".github.com", name: "none", value: "c", expiry: future, sameSite: 0 },
      { host: ".github.com", name: "insecure-none", value: "d", expiry: future, secure: false },
    ]);
    const result = await readCookies(firstSource(), {}, machine.env());
    expect(result).toMatchObject({ found: 4, skipped: 0, warnings: [] });
    expect(result.cookies.map((c) => [c.name, c.expirationDate, c.sameSite, c.domain])).toEqual([
      ["seconds", future, "lax", ".github.com"],
      ["millis", future, "strict", undefined],
      ["none", future, "no_restriction", ".github.com"],
      ["insecure-none", future, "unspecified", ".github.com"],
    ]);
    expect(result.cookies[1]!.url).toBe("https://github.com/");
  });

  it("skips expired and single-context cookies, and applies the domain filter", async () => {
    const profile = linuxFirefox();
    const future = nowSeconds() + DAY;
    writeFirefoxCookies(path.join(profile, "cookies.sqlite"), [
      { host: ".amazon.com", name: "live", value: "a", expiry: future },
      { host: ".amazon.com", name: "expired-ms", value: "b", expiry: (nowSeconds() - DAY) * 1000 },
      {
        host: ".amazon.com",
        name: "container",
        value: "c",
        expiry: future,
        originAttributes: "^userContextId=1",
      },
      {
        host: ".amazon.com",
        name: "partitioned",
        value: "d",
        expiry: future,
        originAttributes: "^partitionKey=%28https%2Cx.com%29",
      },
      { host: ".ebay.com", name: "other-site", value: "e", expiry: future },
    ]);
    const result = await readCookies(firstSource(), { domains: ["amazon.com"] }, machine.env());
    expect(result).toMatchObject({ found: 4, skipped: 3 });
    expect(result.cookies.map((c) => c.name)).toEqual(["live"]);
  });
});

describe("history", () => {
  it("reads Chromium's urls: 1601-epoch times to epoch ms, http(s) only, hidden out, newest first", async () => {
    machine = new FakeMachine("darwin");
    const t = nowSeconds();
    writeChromiumHistory(
      machine.path("Library", "Application Support", "Google", "Chrome", "Default", "History"),
      [
        {
          url: "https://www.amazon.com/your-orders/orders",
          title: "Your Orders",
          visits: 7,
          visitedAt: t - 60,
        },
        { url: "http://example.com/", visitedAt: t - 3600 },
        { url: "https://www.amazon.com/gp/cart", title: "Cart", visitedAt: t },
        { url: "file:///etc/hosts", title: "hosts", visitedAt: t },
        { url: "chrome://settings/", title: "Settings", visitedAt: t },
        { url: "https://ads.example/frame", title: "frame", visitedAt: t, hidden: true },
      ],
    );
    const result = await readHistory(firstSource(), machine.env());
    expect(result.warnings).toEqual([]);
    expect(result.entries).toEqual([
      {
        url: "https://www.amazon.com/gp/cart",
        title: "Cart",
        visitCount: 1,
        lastVisitAt: t * 1000,
        source: "chrome",
      },
      {
        url: "https://www.amazon.com/your-orders/orders",
        title: "Your Orders",
        visitCount: 7,
        lastVisitAt: (t - 60) * 1000,
        source: "chrome",
      },
      {
        url: "http://example.com/",
        title: "",
        visitCount: 1,
        lastVisitAt: (t - 3600) * 1000,
        source: "chrome",
      },
    ]);
  });

  it("reads Firefox's places: microseconds to ms, untitled pages and unvisited bookmarks", async () => {
    const profile = linuxFirefox();
    const t = nowSeconds();
    writeFirefoxPlaces(path.join(profile, "places.sqlite"), [
      { url: "https://developer.mozilla.org/", title: null, visits: 3, visitedAt: t - 5 },
      { url: "https://bookmark.only/", title: "Bookmark", visitedAt: null },
      { url: "about:config", title: "config", visitedAt: t },
    ]);
    const result = await readHistory(firstSource(), machine.env());
    expect(result.entries).toEqual([
      {
        url: "https://developer.mozilla.org/",
        title: "",
        visitCount: 3,
        lastVisitAt: (t - 5) * 1000,
        source: "firefox",
      },
    ]);
  });

  it(`keeps the newest ${HISTORY_LIMIT}`, async () => {
    machine = new FakeMachine("linux");
    const t = nowSeconds();
    writeChromiumHistory(
      machine.path(".config", "google-chrome", "Default", "History"),
      Array.from({ length: HISTORY_LIMIT + 3 }, (_, i) => ({
        url: `https://site.example/${i}`,
        visitedAt: t - i,
      })),
    );
    const { entries } = await readHistory(firstSource(), machine.env());
    expect(entries).toHaveLength(HISTORY_LIMIT);
    expect(entries[0]!.url).toBe("https://site.example/0");
    expect(entries.at(-1)!.url).toBe(`https://site.example/${HISTORY_LIMIT - 1}`);
  });
});

describe("the private copy", () => {
  it("sees rows still in the write-ahead log, leaves the temp directory empty and the store unchanged", async () => {
    machine = new FakeMachine("linux");
    const file = machine.path(".config", "google-chrome", "Default", "Cookies");
    writeChromiumCookies(file, [{ host: ".a.com", name: "checkpointed", value: "1" }], {
      version: 24,
    });
    // A browser still running: its connection holds rows that only the -wal file has.
    const live = new sqlite.DatabaseSync(file);
    try {
      live.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
      live
        .prepare(
          `INSERT INTO cookies (creation_utc, host_key, name, value, path, expires_utc, is_secure,
             is_httponly, last_access_utc) VALUES (1, '.a.com', 'in-wal', '2', '/', 0, 1, 0, 1)`,
        )
        .run();
      expect(fs.existsSync(`${file}-wal`)).toBe(true);
      const before = fs.readFileSync(file);

      const result = await readCookies(firstSource(), {}, machine.env());
      expect(result.cookies.map((c) => c.name).sort()).toEqual(["checkpointed", "in-wal"]);
      expect(fs.readdirSync(machine.tmp)).toEqual([]);
      expect(fs.readFileSync(file).equals(before)).toBe(true);
    } finally {
      live.close();
    }
  });

  it("turns a store it cannot copy into a warning, a sharing violation into 'close the browser'", async () => {
    machine = new FakeMachine("linux");
    writeChromiumCookies(machine.path(".config", "google-chrome", "Default", "Cookies"), [
      { host: ".a.com", name: "n", value: "1" },
    ]);
    const env = { ...machine.env(), tmpdir: path.join(machine.root, "no-such-dir") };
    const result = await readCookies(listImportSources(env)[0]!, {}, env);
    expect(result).toEqual({
      cookies: [],
      found: 0,
      skipped: 0,
      warnings: ["The cookie store of Chrome could not be read."],
    });
    // What Windows reports while Chrome holds the file (ERROR_SHARING_VIOLATION).
    const busy = Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
    expect(unreadableStoreWarning(busy, "Chrome", "cookie store")).toBe(
      "Chrome is holding its cookie store open; close Chrome and import again.",
    );
  });
});
