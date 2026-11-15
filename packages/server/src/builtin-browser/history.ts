/**
 * The built-in browser's history: every web page a tab visits, plus what an import brought in
 * from a system browser. It feeds the address bar's suggestions and `penguin browser history`.
 *
 * One JSON file, `<root>/builtin-browser/history.json`, read on first use and written
 * atomically a moment after the last change (a page load produces a burst of tab events).
 * At most 5000 entries are kept, the most recently visited ones.
 *
 * Two stores can share the file for a moment: across a hot swap, the previous App's store makes
 * its last write while the next App's has already read the file. So a write merges what is on
 * disk rather than overwriting it, and neither loses the other's visits (see `mergeDisk`).
 */
import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "@prismshadow/penguin-core";
import type { BuiltinBrowserHistoryEntry, BuiltinBrowserTab } from "../api/types.js";

/** The most entries the file keeps. */
export const HISTORY_CAP = 5_000;
const WRITE_DELAY_MS = 1_000;

export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export function historyFile(root: string): string {
  return path.join(root, "builtin-browser", "history.json");
}

function parseEntry(value: unknown): BuiltinBrowserHistoryEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (typeof e.url !== "string" || !isWebUrl(e.url)) return null;
  return {
    url: e.url,
    title: typeof e.title === "string" ? e.title : "",
    visitCount: typeof e.visitCount === "number" && e.visitCount > 0 ? Math.floor(e.visitCount) : 1,
    lastVisitAt: typeof e.lastVisitAt === "number" ? e.lastVisitAt : 0,
    source: typeof e.source === "string" && e.source !== "" ? e.source : "builtin",
  };
}

export interface HistoryStoreOptions {
  now?: () => number;
  log?: (line: string) => void;
  writeDelayMs?: number;
}

export class HistoryStore {
  private entries: Map<string, BuiltinBrowserHistoryEntry> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  /** When this store was last cleared: pages on disk visited before then are not taken back. */
  private clearedAt = Number.NEGATIVE_INFINITY;
  private writing: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly writeDelayMs: number;

  constructor(
    private readonly file: string,
    opts: HistoryStoreOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? (() => {});
    this.writeDelayMs = opts.writeDelayMs ?? WRITE_DELAY_MS;
  }

  /**
   * Folds one `tab` event in: a new URL is a visit, and a new title for the same URL is that
   * visit's title arriving (a page names itself after it has loaded). A tab reports its URL as
   * its title until the page has one; that is not a title.
   */
  observe(previous: BuiltinBrowserTab | undefined, tab: BuiltinBrowserTab): void {
    if (!isWebUrl(tab.url)) return;
    const title = tab.title === tab.url ? "" : tab.title;
    if (previous === undefined || previous.url !== tab.url) this.visit(tab.url, title);
    else if (previous.title !== tab.title && title !== "") this.retitle(tab.url, title);
  }

  /** Records a visit to `url`. */
  visit(url: string, title: string): void {
    const entries = this.load();
    const existing = entries.get(url);
    entries.set(url, {
      url,
      title: title !== "" ? title : (existing?.title ?? ""),
      visitCount: (existing?.visitCount ?? 0) + 1,
      lastVisitAt: this.now(),
      source: existing?.source ?? "builtin",
    });
    this.changed();
  }

  /** The title of the page at `url`, once it has one. */
  retitle(url: string, title: string): void {
    const entry = this.load().get(url);
    if (entry === undefined || entry.title === title) return;
    entry.title = title;
    this.changed();
  }

  /**
   * Merges an import: a page already known adds the imported visits to its count and keeps the
   * later of the two visit times; a new one is added as imported. Returns how many imported
   * entries were taken (web pages only).
   */
  merge(imported: readonly BuiltinBrowserHistoryEntry[]): number {
    const entries = this.load();
    let taken = 0;
    for (const raw of imported) {
      const entry = parseEntry(raw);
      if (entry === null) continue;
      taken += 1;
      const existing = entries.get(entry.url);
      if (existing === undefined) {
        entries.set(entry.url, entry);
        continue;
      }
      existing.visitCount += entry.visitCount;
      existing.lastVisitAt = Math.max(existing.lastVisitAt, entry.lastVisitAt);
      if (existing.title === "") existing.title = entry.title;
    }
    if (taken > 0) this.changed();
    return taken;
  }

  /**
   * Case-insensitive substring search over URL and title, most visited first, then most recent.
   * An empty query lists the whole history in that order.
   */
  search(query: string, limit: number): BuiltinBrowserHistoryEntry[] {
    const q = query.trim().toLowerCase();
    return [...this.load().values()]
      .filter(
        (e) => q === "" || e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q),
      )
      .sort((a, b) => b.visitCount - a.visitCount || b.lastVisitAt - a.lastVisitAt)
      .slice(0, Math.max(0, limit))
      .map((e) => ({ ...e }));
  }

  clear(): void {
    this.entries = new Map();
    this.clearedAt = this.now();
    this.changed();
  }

  /** Writes now whatever is waiting for the delayed write. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty || this.entries === null) return this.writing;
    this.dirty = false;
    this.writing = this.writing
      .then(async () => {
        const kept = this.capped([...this.mergeDisk().values()]);
        const body = `${JSON.stringify({ version: 1, entries: kept })}\n`;
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
        await atomicWriteFile(this.file, body);
      })
      .catch((err: unknown) => {
        this.log(`builtin browser: the history could not be saved: ${String(err)}`);
      });
    return this.writing;
  }

  /** Stops the delayed write and writes what is pending. */
  dispose(): Promise<void> {
    return this.flush();
  }

  private changed(): void {
    this.dirty = true;
    const entries = this.load();
    if (entries.size > HISTORY_CAP) {
      this.entries = new Map(this.capped([...entries.values()]).map((e) => [e.url, e]));
    }
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.writeDelayMs);
    this.timer.unref?.();
  }

  /** The newest `HISTORY_CAP` entries by visit time. */
  private capped(entries: BuiltinBrowserHistoryEntry[]): BuiltinBrowserHistoryEntry[] {
    if (entries.length <= HISTORY_CAP) return entries;
    return [...entries].sort((a, b) => b.lastVisitAt - a.lastVisitAt).slice(0, HISTORY_CAP);
  }

  private load(): Map<string, BuiltinBrowserHistoryEntry> {
    if (this.entries !== null) return this.entries;
    const entries = new Map<string, BuiltinBrowserHistoryEntry>();
    for (const entry of this.readFile(true)) entries.set(entry.url, entry);
    this.entries = entries;
    return entries;
  }

  /**
   * Folds the file as it is now into memory, before a write: a page either side knows is kept,
   * with the larger visit count and the later visit (a visit both stores saw counts once), and
   * the title of the later visit. What this store cleared stays cleared: a page on disk last
   * visited before the clear is not taken back.
   */
  private mergeDisk(): Map<string, BuiltinBrowserHistoryEntry> {
    const entries = this.load();
    for (const disk of this.readFile(false)) {
      if (disk.lastVisitAt <= this.clearedAt) continue;
      const mine = entries.get(disk.url);
      if (mine === undefined) {
        entries.set(disk.url, disk);
        continue;
      }
      if (disk.lastVisitAt > mine.lastVisitAt && disk.title !== "") mine.title = disk.title;
      mine.visitCount = Math.max(mine.visitCount, disk.visitCount);
      mine.lastVisitAt = Math.max(mine.lastVisitAt, disk.lastVisitAt);
    }
    return entries;
  }

  /** The file's entries; none when it does not exist or cannot be read (logged when `report`). */
  private readFile(report: boolean): BuiltinBrowserHistoryEntry[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as { entries?: unknown };
      if (!Array.isArray(parsed.entries)) return [];
      return parsed.entries
        .map(parseEntry)
        .filter((entry): entry is BuiltinBrowserHistoryEntry => entry !== null);
    } catch (err) {
      // No file yet is the normal first run; anything else is logged and starts over.
      if (report && (err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.log(`builtin browser: the history could not be read, starting empty: ${String(err)}`);
      }
      return [];
    }
  }
}
