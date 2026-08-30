/**
 * The harness history, kept by the platform itself. The runtime commits a version
 * (harness.json) and knows nothing else about it; the platform that boots IS that version
 * and records it here — the runtime's commit record plus the interface table this platform
 * was built from — under `<root>/harness-history/`, its own directory beside the
 * runtime's store. Every boot records (a push, a restart, a fresh install), so the record
 * is complete on any runtime old enough to boot this platform.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type {
  HarnessHistory,
  HarnessHistoryEntry,
  HarnessInfo,
  IfacesSummary,
} from "@prismshadow/penguin-core";
import table from "../ifaces.json" with { type: "json" };
import { readHarnessInfo } from "../hmr/manifest.js";
import { summarizeTable } from "../hmr/ifaces-diff.js";
import type { Clock, Paths } from "../hmr/capabilities.js";

/** How long after boot the runtime's commit of a pushed version is expected to have landed. */
const COMMIT_SETTLE_MS = 1500;

/** How many versions the history remembers; the newest are kept. */
export const HISTORY_KEEP = 100;

export abstract class HarnessHistoryIface extends Interface<{
  /** The recorded versions, newest first, with the runtime's current commit. */
  list(): Promise<HarnessHistory>;
  /** A recorded interface table by hash, or null. */
  table(hash: string): Promise<unknown | null>;
}>() {}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** A stored table's summary, or null unless every part of it is there. */
function summaryOf(raw: unknown): IfacesSummary | null {
  const i = (raw ?? {}) as Record<string, unknown>;
  const hash = str(i.hash);
  if (hash === null) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { hash, nodes: num(i.nodes), interfaces: num(i.interfaces), types: num(i.types) };
}

/** An entry as written to disk, or null unless it names a version. */
function entryOf(raw: unknown): HarnessHistoryEntry | null {
  const e = (raw ?? {}) as Record<string, unknown>;
  const b = (e.bundles ?? {}) as Record<string, unknown>;
  const bundles = { platform: str(b.platform), cli: str(b.cli), web: str(b.web) };
  const ifaces = summaryOf(e.ifaces);
  if (bundles.platform === null && bundles.cli === null && bundles.web === null && ifaces === null)
    return null;
  const src = (e.source ?? {}) as Record<string, unknown>;
  const repo = str(src.repo);
  const revision = str(src.revision);
  return {
    source: repo !== null && revision !== null ? { repo, revision } : null,
    pushedAt: str(e.pushedAt),
    bundles,
    ifaces,
  };
}

/** Two entries name the same version when their bundles agree, or — for a packaged boot with no bundles — their tables do. */
function sameVersion(a: HarnessHistoryEntry, b: HarnessHistoryEntry): boolean {
  const noBundles = (e: HarnessHistoryEntry) =>
    e.bundles.platform === null && e.bundles.cli === null && e.bundles.web === null;
  if (noBundles(a) || noBundles(b))
    return noBundles(a) && noBundles(b) && a.ifaces?.hash === b.ifaces?.hash;
  return (
    a.bundles.platform === b.bundles.platform &&
    a.bundles.cli === b.bundles.cli &&
    a.bundles.web === b.bundles.web
  );
}

@Component()
export class HarnessHistoryStore implements HarnessHistoryIface {
  @Use() private readonly paths!: Paths;
  @Use() private readonly clock!: Clock;

  private get dir(): string {
    return path.join(this.paths.root, "harness-history");
  }

  /**
   * Records this boot: the runtime's current commit, with this platform's own table. On a
   * push the runtime commits AFTER the boot succeeds, so at setup harness.json still names
   * the previous version; the record is made again a moment later, and on every read —
   * each time an upsert that never touches another platform's line (see record).
   */
  async setup({ effect }: ClassCtx): Promise<void> {
    await this.recordQuietly();
    const later = setTimeout(() => void this.recordQuietly(), COMMIT_SETTLE_MS);
    later.unref();
    effect(() => clearTimeout(later));
  }

  private async recordQuietly(): Promise<void> {
    try {
      await this.record();
    } catch {
      // A history that cannot be written is not a reason not to boot or to answer.
    }
  }

  /**
   * Upserts the line for the runtime's current commit. A line already there for the same
   * bundles is refreshed only when it carries THIS platform's table; one carrying another
   * table belongs to the platform that recorded it (the boot before a push sees the
   * previous commit) and is left alone.
   */
  async record(): Promise<void> {
    const current = await readHarnessInfo(this.paths.root);
    const own = table as { hash: string; ifaces: object; types: object; modules: object };
    const summary = summarizeTable(own as unknown as Parameters<typeof summarizeTable>[0]);
    await fsp.mkdir(path.join(this.dir, "ifaces"), { recursive: true });
    const tablePath = path.join(this.dir, "ifaces", `${summary.hash}.json`);
    try {
      await fsp.access(tablePath);
    } catch {
      await writeAtomic(tablePath, JSON.stringify(own));
    }
    const entry: HarnessHistoryEntry = {
      source: current?.source ?? null,
      pushedAt: current?.pushedAt ?? this.clock.now().toISOString(),
      bundles: current?.bundles ?? { platform: null, cli: null, web: null },
      ifaces: summary,
    };
    const entries = await this.entries();
    const at = entries.findIndex((e) => sameVersion(e, entry));
    if (at !== -1 && entries[at]!.ifaces?.hash !== summary.hash) return;
    const next = at === -1 ? [entry, ...entries] : entries.map((e, i) => (i === at ? entry : e));
    await writeAtomic(
      path.join(this.dir, "history.json"),
      JSON.stringify(next.slice(0, HISTORY_KEEP), null, 2),
    );
  }

  /** The entries on disk, newest first; a truncated or hand-edited file degrades to what still parses. */
  async entries(): Promise<HarnessHistoryEntry[]> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fsp.readFile(path.join(this.dir, "history.json"), "utf8"));
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.map(entryOf).filter((e): e is HarnessHistoryEntry => e !== null);
  }

  async list(): Promise<HarnessHistory> {
    await this.recordQuietly();
    const [current, entries] = await Promise.all([
      readHarnessInfo(this.paths.root),
      this.entries(),
    ]);
    return { current, entries };
  }

  async table(hash: string): Promise<unknown | null> {
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    try {
      return JSON.parse(await fsp.readFile(path.join(this.dir, "ifaces", `${hash}.json`), "utf8"));
    } catch {
      return null;
    }
  }
}

/** The current commit as the history should show it: what `readHarnessInfo` says, or null. */
export type { HarnessInfo };

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, text);
  await fsp.rename(tmp, file);
}
