/**
 * The history store: visits from tab events, the import merge (visit counts add up, the later
 * visit wins), the 5000-entry cap by visit time, search ranking, and the file round trip.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HISTORY_CAP, HistoryStore } from "../../src/builtin-browser/history.js";
import type { BuiltinBrowserHistoryEntry } from "../../src/api/types.js";
import { tab } from "./fake-shell.js";

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bb-history-"));
  file = path.join(dir, "builtin-browser", "history.json");
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const entry = (
  url: string,
  patch: Partial<BuiltinBrowserHistoryEntry> = {},
): BuiltinBrowserHistoryEntry => ({
  url,
  title: "",
  visitCount: 1,
  lastVisitAt: 1,
  source: "chrome",
  ...patch,
});

describe("HistoryStore visits", () => {
  it("counts a visit per URL change and takes the title that arrives after it", () => {
    let now = 100;
    const store = new HistoryStore(file, { now: () => now });
    const loading = tab(1, { url: "https://a.test/", title: "https://a.test/", loading: true });
    store.observe(undefined, loading);
    const titled = { ...loading, title: "Shop A", loading: false };
    store.observe(loading, titled);
    now = 200;
    // Same URL, same title: not a visit.
    store.observe(titled, { ...titled, loading: true });
    const next = tab(1, { url: "https://a.test/orders", title: "Orders" });
    store.observe(titled, next);
    store.observe(next, { ...next, url: "chrome://settings" });
    expect(store.search("", 10)).toEqual([
      {
        url: "https://a.test/orders",
        title: "Orders",
        visitCount: 1,
        lastVisitAt: 200,
        source: "builtin",
      },
      {
        url: "https://a.test/",
        title: "Shop A",
        visitCount: 1,
        lastVisitAt: 100,
        source: "builtin",
      },
    ]);
    store.observe(undefined, tab(2, { url: "https://a.test/", title: "Shop A" }));
    expect(store.search("shop", 10)[0]).toMatchObject({ url: "https://a.test/", visitCount: 2 });
  });
});

describe("HistoryStore import merge", () => {
  it("adds the imported visits to a known page and keeps the later visit time", () => {
    let now = 5_000;
    const store = new HistoryStore(file, { now: () => now });
    store.visit("https://a.test/", "A");
    const taken = store.merge([
      entry("https://a.test/", { visitCount: 4, lastVisitAt: 9_000, title: "Imported A" }),
      entry("https://b.test/", { visitCount: 2, lastVisitAt: 1_000, title: "B" }),
      entry("file:///etc/hosts", { visitCount: 9 }),
    ]);
    expect(taken).toBe(2);
    expect(store.search("a.test", 5)).toEqual([
      { url: "https://a.test/", title: "A", visitCount: 5, lastVisitAt: 9_000, source: "builtin" },
    ]);
    expect(store.search("b.test", 5)).toEqual([
      { url: "https://b.test/", title: "B", visitCount: 2, lastVisitAt: 1_000, source: "chrome" },
    ]);
  });

  it("keeps the most recently visited 5000", async () => {
    const store = new HistoryStore(file, { writeDelayMs: 0 });
    const imported = Array.from({ length: HISTORY_CAP + 10 }, (_, i) =>
      entry(`https://site.test/${i}`, { lastVisitAt: i }),
    );
    store.merge(imported);
    const all = store.search("", HISTORY_CAP + 100);
    expect(all).toHaveLength(HISTORY_CAP);
    expect(all.some((e) => e.url === "https://site.test/9")).toBe(false);
    expect(all.some((e) => e.url === "https://site.test/10")).toBe(true);
    await store.flush();
    const saved = JSON.parse(await fs.readFile(file, "utf8")) as { entries: unknown[] };
    expect(saved.entries).toHaveLength(HISTORY_CAP);
  });
});

describe("HistoryStore search", () => {
  it("matches URL or title case-insensitively, most visited first, then most recent", () => {
    const store = new HistoryStore(file);
    store.merge([
      entry("https://www.amazon.com/", { title: "Amazon.com", visitCount: 3, lastVisitAt: 10 }),
      entry("https://www.amazon.com/your-orders", {
        title: "Your Orders",
        visitCount: 3,
        lastVisitAt: 20,
      }),
      entry("https://example.test/", { title: "An AMAZON review", visitCount: 1, lastVisitAt: 30 }),
      entry("https://other.test/", { title: "Other", visitCount: 9, lastVisitAt: 40 }),
    ]);
    expect(store.search("Amazon", 10).map((e) => e.url)).toEqual([
      "https://www.amazon.com/your-orders",
      "https://www.amazon.com/",
      "https://example.test/",
    ]);
    expect(store.search("amazon", 1)).toHaveLength(1);
    expect(store.search("nothing-like-this", 10)).toEqual([]);
  });
});

describe("HistoryStore file", () => {
  it("writes atomically after the delay, reads it back, and clears", async () => {
    const store = new HistoryStore(file, { now: () => 42, writeDelayMs: 10 });
    store.visit("https://a.test/", "A");
    await new Promise((resolve) => setTimeout(resolve, 60));
    await store.flush();
    const reread = new HistoryStore(file);
    expect(reread.search("", 5)).toEqual([
      { url: "https://a.test/", title: "A", visitCount: 1, lastVisitAt: 42, source: "builtin" },
    ]);
    reread.clear();
    await reread.dispose();
    expect(new HistoryStore(file).search("", 5)).toEqual([]);
    // No temp file is left beside it.
    expect(await fs.readdir(path.dirname(file))).toEqual(["history.json"]);
  });

  it("keeps both stores' visits when two share the file across a hot swap", async () => {
    const previous = new HistoryStore(file, { now: () => 100 });
    previous.visit("https://a.test/", "A");
    // The next App's store reads the file before the previous one has written its visit.
    const next = new HistoryStore(file, { now: () => 200 });
    next.visit("https://b.test/", "B");
    await previous.dispose();
    await next.flush();
    const urls = new HistoryStore(file).search("", 5).map((e) => e.url);
    expect(urls.sort()).toEqual(["https://a.test/", "https://b.test/"]);
  });

  it("counts a visit both stores saw once, and a clear stays clear", async () => {
    const one = new HistoryStore(file, { now: () => 100 });
    const two = new HistoryStore(file, { now: () => 100 });
    one.visit("https://a.test/", "A");
    two.visit("https://a.test/", "A");
    await one.flush();
    await two.flush();
    expect(new HistoryStore(file).search("", 5)).toEqual([
      { url: "https://a.test/", title: "A", visitCount: 1, lastVisitAt: 100, source: "builtin" },
    ]);
    const three = new HistoryStore(file, { now: () => 300 });
    three.clear();
    await three.flush();
    expect(new HistoryStore(file).search("", 5)).toEqual([]);
  });

  it("starts empty over a file it cannot read", async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ not json");
    const lines: string[] = [];
    const store = new HistoryStore(file, { log: (line) => lines.push(line) });
    expect(store.search("", 5)).toEqual([]);
    expect(lines).toHaveLength(1);
  });
});
