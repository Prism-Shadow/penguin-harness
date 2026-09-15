/**
 * The harness history, kept by the platform itself. The runtime commits a version
 * (harness.json) and knows nothing else about it; the platform that boots IS that version
 * and records it here — the runtime's commit record plus the interface table this platform
 * was built from — under `<root>/harness-history/`, its own directory beside the
 * runtime's store. Every boot records (a push, a restart, a fresh install), so the record
 * is complete on any runtime old enough to boot this platform.
 *
 * The record is made once the runtime's commit has LANDED, never before: on a push the
 * runtime commits after the boot succeeds, so at setup harness.json still names the previous
 * version, and a line written then would carry the previous bundles under this platform's
 * table. `hmrControl.current()` resolves when the swap that booted this platform is over —
 * commit included — and that is when the line is written. A generation the runtime put back
 * (its boot failed) never records: what harness.json names then is not it.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { atomicWriteFile } from "@prismshadow/penguin-core";
import type {
  HarnessHistory,
  HarnessHistoryEntry,
  HarnessInfo,
  IfacesSummary,
  RollbackFailure,
} from "@prismshadow/penguin-core";
import table from "../ifaces.json" with { type: "json" };
import { readHarnessInfo } from "../hmr/manifest.js";
import { readPushedBuild } from "../hmr/pushed-build.js";
import { summarizeTable } from "@prismshadow/penguin-hmr";
import type {
  Channels,
  Clock,
  HmrControl,
  HmrControlApi,
  Log,
  Paths,
} from "../hmr/capabilities.js";

/** How many versions the history remembers; the newest are kept. */
export const HISTORY_KEEP = 100;

export abstract class HarnessHistoryIface extends Interface<{
  /** The recorded versions, newest first, with the runtime's current commit and the last rollback that failed. */
  list(): Promise<HarnessHistory>;
  /** A recorded interface table by hash, or null. */
  table(hash: string): Promise<unknown | null>;
  /**
   * Pushes a kept version back through the runtime's own upgrade channel. Resolves true
   * once the runtime has taken it (this platform is then being replaced); false when this
   * platform kept no artifacts for that id; throws when the runtime refused, after
   * recording the refusal for `list()`.
   */
  rollback(id: string): Promise<boolean>;
}>() {}

/** How many versions' artifacts the platform keeps for rollback (the runtime's store keeps one). */
export const KEEP_VERSIONS = 5;

/** A version's id: its content-addressed bundles, or its table for a packaged boot. */
export function versionId(bundles: HarnessInfo["bundles"], tableHash: string | null): string {
  const sha = (p: string | null) =>
    p === null ? "" : p.slice(p.lastIndexOf("/") + 1).replace(/\.[a-z]+$/i, "");
  const fromBundles = [sha(bundles.platform), sha(bundles.cli), sha(bundles.web)]
    .filter(Boolean)
    .join("-");
  return fromBundles !== "" ? fromBundles : `packaged-${tableHash ?? "unknown"}`;
}

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
    id: versionId(bundles, ifaces?.hash ?? null),
    rollbackable: false,
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

/** The file a kept version's upgrade body is stored as: exactly what pushing it back sends. */
const BUILD_FILE = "build.gz";

@Component()
export class HarnessHistoryStore implements HarnessHistoryIface {
  @Use() private readonly paths!: Paths;
  @Use() private readonly clock!: Clock;
  @Use() private readonly log!: Log;
  @Use() private readonly hmrControl!: HmrControl;
  @Use() private readonly channels!: Channels;

  /** The boot's record, so a read that arrives first waits for it instead of racing it. */
  private booted: Promise<void> = Promise.resolve();
  /** Records run one at a time: two at once would write the same file over each other. */
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;
  /** The last push back the runtime refused, kept in memory: a refused push leaves this platform running. */
  private lastRollback: RollbackFailure | null = null;

  private get dir(): string {
    return path.join(this.paths.root, "harness-history");
  }

  setup({ effect }: ClassCtx): void {
    effect(() => {
      this.disposed = true;
    });
    // Not awaited: current() waits out the swap that is booting this very platform.
    this.booted = (this.hmrControl as unknown as HmrControlApi).current().then(
      () => this.recordQuietly(),
      () => undefined, // no generation could boot: nothing to record
    );
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
   * table belongs to the platform that recorded it and is left alone. Nothing is written
   * when the line is already what it would be.
   */
  record(): Promise<void> {
    const run = this.chain.then(() => (this.disposed ? undefined : this.recordNow()));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async recordNow(): Promise<void> {
    const current = await readHarnessInfo(this.paths.root);
    const own = table as { hash: string; ifaces: object; types: object; modules: object };
    const summary = summarizeTable(own as unknown as Parameters<typeof summarizeTable>[0]);
    await fsp.mkdir(path.join(this.dir, "ifaces"), { recursive: true });
    const tablePath = path.join(this.dir, "ifaces", `${summary.hash}.json`);
    try {
      await fsp.access(tablePath);
    } catch {
      await atomicWriteFile(tablePath, JSON.stringify(own));
    }
    const entry: HarnessHistoryEntry = {
      id: versionId(current?.bundles ?? { platform: null, cli: null, web: null }, summary.hash),
      rollbackable: false,
      source: current?.source ?? null,
      pushedAt: current?.pushedAt ?? this.clock.now().toISOString(),
      bundles: current?.bundles ?? { platform: null, cli: null, web: null },
      ifaces: summary,
    };
    const entries = await this.entries();
    const at = entries.findIndex((e) => sameVersion(e, entry));
    if (at !== -1 && entries[at]!.ifaces?.hash !== summary.hash) return;
    const next = at === -1 ? [entry, ...entries] : entries.map((e, i) => (i === at ? entry : e));
    if (at === -1 || JSON.stringify(entries[at]) !== JSON.stringify(entry)) {
      await atomicWriteFile(
        path.join(this.dir, "history.json"),
        JSON.stringify(next.slice(0, HISTORY_KEEP), null, 2),
      );
    }
    // The runtime's store keeps one rollback copy of each artifact; the platform keeps a
    // few whole versions of its own, so the history can push one back.
    if (current !== null) await this.keepArtifacts(entry.id);
  }

  private versionsDir(): string {
    return path.join(this.dir, "versions");
  }

  /**
   * Keeps the committed version's upgrade body under `versions/<id>/`, once, and prunes the
   * oldest beyond KEEP_VERSIONS. The body is the one a hand-over forwards (hmr/pushed-build.ts):
   * bundles, the web archive, the native assets with their exec bits, the provenance.
   */
  private async keepArtifacts(id: string): Promise<void> {
    if (await this.kept(id)) return;
    const body = readPushedBuild(this.paths.root);
    // No store, a partial record, or a file the runtime already pruned: this version is not
    // kept, and the history line stands without it.
    if (body === null) return;
    const dir = path.join(this.versionsDir(), id);
    const tmp = `${dir}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await fsp.mkdir(tmp, { recursive: true });
      await fsp.writeFile(path.join(tmp, BUILD_FILE), body);
      await fsp.writeFile(path.join(tmp, "version.json"), JSON.stringify({ id }));
      await fsp.rename(tmp, dir);
    } catch {
      await fsp.rm(tmp, { recursive: true, force: true });
      return;
    }
    // Prune: keep the newest KEEP_VERSIONS by the history's order.
    const keep = new Set((await this.entries()).map((e) => e.id).slice(0, KEEP_VERSIONS));
    for (const name of await fsp.readdir(this.versionsDir())) {
      if (!keep.has(name) && !name.includes(".tmp-"))
        await fsp.rm(path.join(this.versionsDir(), name), { recursive: true, force: true });
    }
  }

  private async kept(id: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return false;
    try {
      await fsp.access(path.join(this.versionsDir(), id, "version.json"));
      return true;
    } catch {
      return false;
    }
  }

  async rollback(id: string): Promise<boolean> {
    if (!(await this.kept(id))) return false;
    try {
      await this.push(id);
      return true;
    } catch (err) {
      // The route has already answered; the refusal is kept for the next read of the
      // history, and logged where a failed push back is seen.
      const message = err instanceof Error ? err.message : String(err);
      this.lastRollback = { id, error: message, at: this.clock.now().toISOString() };
      this.log.line(`[harness-history] rollback to ${id} failed: ${message}`);
      throw err;
    }
  }

  /**
   * Hands the kept body to the runtime's upgrade channel in-process — the same endpoint a
   * deploy reaches over HTTP, minus the network: no bind address, scheme gate or token is
   * involved, because the code being pushed is already on this machine and the route that
   * called this has done the platform's own admin check. The runtime swaps this platform
   * out on success, exactly as it does for a push from outside.
   */
  private async push(id: string): Promise<void> {
    const body = await fsp.readFile(path.join(this.versionsDir(), id, BUILD_FILE));
    const control = this.hmrControl as unknown as HmrControlApi;
    const res = await control.endpoint(
      new Request("http://localhost/api/hmr/upgrade", {
        method: "POST",
        headers: { "content-type": "application/gzip" },
        body,
      }),
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`rollback to ${id}: ${res.status} ${text}`);
    const outcome = JSON.parse(text) as { status: string; web?: { rev: string }; reason?: string };
    if (outcome.status !== "ok") {
      throw new Error(`rollback to ${id}: ${outcome.reason ?? text.slice(0, 200)}`);
    }
    this.lastRollback = null;
    this.log.line(`[harness-history] rolled back to ${id}: ${text.slice(0, 200)}`);
    // Live clients (browser tabs AND the desktop window) reload once a version lands — what
    // the HTTP route does for a push from outside (hmr/routes.ts).
    this.channels.broadcast(
      "user:",
      { type: "web_updated", rev: outcome.web?.rev ?? "" },
      "server_event",
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
    await this.booted;
    const [current, entries] = await Promise.all([
      readHarnessInfo(this.paths.root),
      this.entries(),
    ]);
    const marked = await Promise.all(
      entries.map(async (e) => ({ ...e, rollbackable: await this.kept(e.id) })),
    );
    return { current, entries: marked, lastRollback: this.lastRollback };
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
