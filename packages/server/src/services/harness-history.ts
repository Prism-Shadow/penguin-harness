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
import zlib from "node:zlib";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type {
  HarnessHistory,
  HarnessHistoryEntry,
  HarnessInfo,
  IfacesSummary,
} from "@prismshadow/penguin-core";
import table from "../ifaces.json" with { type: "json" };
import { readHarnessInfo, readManifest } from "../hmr/manifest.js";
import { readApiToken } from "../auth/api-token.js";
import { loopbackHostRoles } from "./preview-token.js";
import { summarizeTable } from "../hmr/ifaces-diff.js";
import type { Clock, Config, Log, Paths } from "../hmr/capabilities.js";
import type { HttpFetch } from "./update-check-service.js";

/** How long after boot the runtime's commit of a pushed version is expected to have landed. */
const COMMIT_SETTLE_MS = 1500;

/** How many versions the history remembers; the newest are kept. */
export const HISTORY_KEEP = 100;

export abstract class HarnessHistoryIface extends Interface<{
  /** The recorded versions, newest first, with the runtime's current commit. */
  list(): Promise<HarnessHistory>;
  /** A recorded interface table by hash, or null. */
  table(hash: string): Promise<unknown | null>;
  /**
   * Pushes a kept version back through the runtime's own upgrade endpoint. Resolves when
   * the runtime has answered; false when this platform kept no artifacts for that id.
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

@Component()
export class HarnessHistoryStore implements HarnessHistoryIface {
  @Use() private readonly paths!: Paths;
  @Use() private readonly clock!: Clock;
  @Use() private readonly config!: Config;
  @Use() private readonly http!: HttpFetch;
  @Use() private readonly log!: Log;

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
    await writeAtomic(
      path.join(this.dir, "history.json"),
      JSON.stringify(next.slice(0, HISTORY_KEEP), null, 2),
    );
    // The runtime's store keeps one rollback copy of each artifact; the platform keeps a
    // few whole versions of its own, so the history can push one back.
    if (current !== null) await this.keepArtifacts(entry.id);
  }

  private versionsDir(): string {
    return path.join(this.dir, "versions");
  }

  /** Copies the committed version's artifacts under `versions/<id>/`, once, and prunes the oldest beyond KEEP_VERSIONS. */
  private async keepArtifacts(id: string): Promise<void> {
    const manifest = await readManifest(this.paths.root);
    if (manifest === null) return;
    const hmrDir = path.join(this.paths.root, "hmr");
    const dir = path.join(this.versionsDir(), id);
    try {
      await fsp.access(path.join(dir, "version.json"));
      return; // already kept
    } catch {
      // fall through
    }
    const platform = str(manifest.platform?.bundle);
    const cli = str(manifest.cli?.bundle);
    const web = str(manifest.web?.manifest);
    if (platform === null || cli === null || web === null) return;
    const tmp = `${dir}.${process.pid}.tmp`;
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.mkdir(tmp, { recursive: true });
    try {
      await this.copyVersion(manifest, hmrDir, tmp, id);
    } catch {
      // The runtime already pruned a file behind a pointer, or the copy could not be
      // written: this version is not kept, and the history line stands without it.
      await fsp.rm(tmp, { recursive: true, force: true });
      return;
    }
    await fsp.rename(tmp, dir);
    // Prune: keep the newest KEEP_VERSIONS by the history's order.
    const keep = new Set((await this.entries()).map((e) => e.id).slice(0, KEEP_VERSIONS));
    for (const name of await fsp.readdir(this.versionsDir())) {
      if (!keep.has(name))
        await fsp.rm(path.join(this.versionsDir(), name), { recursive: true, force: true });
    }
  }

  private async copyVersion(
    manifest: NonNullable<Awaited<ReturnType<typeof readManifest>>>,
    hmrDir: string,
    tmp: string,
    id: string,
  ): Promise<void> {
    const platform = str(manifest.platform?.bundle)!;
    const cli = str(manifest.cli?.bundle)!;
    const web = str(manifest.web?.manifest)!;
    await fsp.copyFile(path.join(hmrDir, platform), path.join(tmp, "platform.mjs"));
    await fsp.copyFile(path.join(hmrDir, cli), path.join(tmp, "cli.mjs"));
    await fsp.copyFile(path.join(hmrDir, web), path.join(tmp, "web.webz"));
    const exec: string[] = [];
    const assetsDir = str(manifest.assets?.dir);
    if (assetsDir !== null) {
      const from = path.join(hmrDir, assetsDir);
      const to = path.join(tmp, "assets");
      for (const entry of await fsp.readdir(from, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const abs = path.join(entry.parentPath, entry.name);
        const rel = path.relative(from, abs).split(path.sep).join("/");
        await fsp.mkdir(path.dirname(path.join(to, rel)), { recursive: true });
        await fsp.copyFile(abs, path.join(to, rel));
        if (rel.endsWith("spawn-helper") || ((await fsp.stat(abs)).mode & 0o111) !== 0)
          exec.push(rel);
      }
    }
    await fsp.writeFile(
      path.join(tmp, "version.json"),
      JSON.stringify({
        id,
        source: manifest.source ?? null,
        assets: assetsDir === null ? null : { exec },
      }),
    );
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
      return await this.push(id);
    } catch (err) {
      // The caller has already answered (the swap replaces it); the log is where a failed
      // push back is seen.
      this.log.line(
        `[harness-history] rollback to ${id} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }

  private async push(id: string): Promise<boolean> {
    const dir = path.join(this.versionsDir(), id);
    const meta = JSON.parse(await fsp.readFile(path.join(dir, "version.json"), "utf8")) as {
      source: { repo: string; revision: string } | null;
      assets: { exec: string[] } | null;
    };
    const webz = await fsp.readFile(path.join(dir, "web.webz"));
    const web = JSON.parse(zlib.gunzipSync(webz).toString("utf8")) as {
      files: Record<string, string>;
    };
    let assets: { files: Record<string, string>; exec: string[] } | undefined;
    if (meta.assets !== null) {
      const from = path.join(dir, "assets");
      const files: Record<string, string> = {};
      for (const entry of await fsp.readdir(from, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const abs = path.join(entry.parentPath, entry.name);
        files[path.relative(from, abs).split(path.sep).join("/")] = (
          await fsp.readFile(abs)
        ).toString("base64");
      }
      assets = { files, exec: meta.assets.exec };
    }
    const body = zlib.gzipSync(
      Buffer.from(
        JSON.stringify({
          platform: await fsp.readFile(path.join(dir, "platform.mjs"), "utf8"),
          cli: await fsp.readFile(path.join(dir, "cli.mjs"), "utf8"),
          web,
          ...(assets ? { assets } : {}),
          ...(meta.source ? { source: meta.source } : {}),
        }),
      ),
    );
    const token = readApiToken(this.paths.root);
    if (token === null) throw new Error("no local api token to push with");
    // The runtime's own door, from inside: this platform is what gets replaced, so the
    // route that calls this answers before starting it.
    // Addressed to the App host: on a loopback bind the two loopback names play different
    // roles (services/preview-token.ts), and only the App one serves the API.
    const host = loopbackHostRoles(this.config.host)?.app ?? this.config.host;
    const res = await this.http.fetch(`http://${host}:${this.config.port}/api/hmr/upgrade`, {
      method: "POST",
      headers: { "content-type": "application/gzip", authorization: `Bearer ${token}` },
      body,
    });
    const text = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`rollback to ${id}: ${res.status} ${text}`);
    }
    this.log.line(`[harness-history] rolled back to ${id}: ${text.slice(0, 200)}`);
    return true;
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
    const marked = await Promise.all(
      entries.map(async (e) => ({ ...e, rollbackable: await this.kept(e.id) })),
    );
    return { current, entries: marked };
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
