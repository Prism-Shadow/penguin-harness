/**
 * HmrHost: the runtime side of the stop-the-world hot-update protocol.
 *
 * The host owns everything that must survive a platform swap: the resource
 * registry (live processes + their output buffers), the operation queue the
 * HTTP layer gates on, and the committed on-disk state.
 *
 * Freeze semantics: requests arriving during a swap are ENQUEUED, not
 * rejected — the HTTP layer awaits waitIdle() and proceeds once the swap
 * completes, so a client never observes the stop-the-world window (it only
 * sees latency). Concurrent upgrade requests serialize on the same queue.
 *
 * Code arrives as BYTES over HTTP (an inline single-file platform bundle; a
 * web dist as ONE gzip artifact, or the equivalent { relPath: base64 } JSON
 * manifest) — never as a server-side path a remote client could not produce.
 * bundlePath/distPath remain as same-machine dev conveniences.
 *
 * Web dist pushes are held in memory (a relPath → bytes map), not written to
 * disk file-by-file: a dist can be hundreds of small files, and syncing each
 * one separately serializes on the destination filesystem's per-file
 * overhead (observed as low as ~100KB/s writing 300 small files to a
 * Windows/Defender-scanned disk). The pushed bytes are persisted as ONE
 * artifact instead (see persistWebArtifact).
 *
 * Persistence: artifacts are content-addressed under hmr/store/ and promoted
 * by ONE atomic rename of hmr/harness.json — committed only AFTER the live
 * in-memory boot succeeded, so a restart can never resume a bundle that
 * failed to boot. A restart resumes harness.json; any restore failure warns
 * and falls back to the packaged default (never bricks). The store keeps at
 * most STORE_KEEP platform bundles / web dists (current + one rollback).
 *
 * Reload is strictly request-driven: nothing watches, nothing auto-triggers.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import type { Instance, Json } from "@prismshadow/penguin-core/kernel";
import { boot, initialDoc, upgrade } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "./resources.js";
import type { PlatformApi } from "../platform/platform.js";
import { packagedPlatform } from "../platform/platform.js";
import type { AnyIface, AnyImpl } from "@prismshadow/penguin-core/kernel";

export interface PlatformBundle {
  id: string;
  iface: AnyIface;
  impl: AnyImpl;
}

/** Optional provenance recorded with a pushed bundle (never executed here). */
export interface GitSource {
  repo: string;
  revision: string;
}

export type UpgradeTarget = {
  /** A prebuilt single-file JS bundle on this machine + optional provenance. */
  bundlePath: string;
  source?: GitSource;
};

export type UpgradeOutcome =
  | { status: "ok"; mode: "silent" | "migrated"; impl: string; source: GitSource | null }
  | { status: "blocked"; dropped: string[]; missing: string[]; invalid: string[] };

/**
 * The committed on-disk state (hmr/harness.json): a runtime restart boots
 * exactly this. The whole promotion is one atomic rename — a crash mid-write
 * leaves the previous committed state intact. Paths are relative to hotDir.
 */
interface Manifest {
  platform?: { bundle: string; park: string };
  /**
   * `manifest` (current form): one gzip(JSON.stringify({ files })) artifact,
   * restored straight into memory. `dir` (legacy): a plain on-disk
   * directory from before web pushes were single-artifacted — still
   * honored on restore so an old commit keeps serving after an upgrade.
   */
  web?: { manifest: string } | { dir: string };
}

/** How many past platform bundles / web dists the store keeps (current + one rollback). */
const STORE_KEEP = 2;

export class HmrHost {
  readonly resources = new HotResources();
  /**
   * Per-process credential for local tools (published to
   * $PENGUIN_HOME/hmr/api.json, mode 0600): presenting it as a Bearer token
   * is admin-equivalent for the hot APIs. Regenerated every boot.
   */
  readonly apiToken = crypto.randomBytes(32).toString("hex");

  private instance: Instance<PlatformApi> | null = null;
  private implId = packagedPlatform.id;
  private readonly hmrDir: string;
  private readonly storeDir: string;
  private readonly manifestPath: string;
  private restored = false;
  /** The freeze, as a queue: everything the HTTP layer gates on chains here. */
  private opQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: string) {
    this.hmrDir = path.join(root, "hmr");
    this.storeDir = path.join(this.hmrDir, "store");
    this.manifestPath = path.join(this.hmrDir, "harness.json");
  }

  private warn(msg: string): void {
    process.stderr.write(`[hmr] ${msg}\n`);
  }

  currentImplId(): string {
    return this.implId;
  }

  /**
   * The request gate: resolves once no swap is in flight. Requests arriving
   * during an upgrade wait here — they observe latency, never an error.
   */
  waitIdle(): Promise<void> {
    return this.opQueue.then(
      () => undefined,
      () => undefined,
    );
  }

  /**
   * Lazy first boot. Resumes the last committed platform + web from disk when
   * present; otherwise boots the packaged platform v1 with a fresh document.
   */
  async ensure(): Promise<Instance<PlatformApi>> {
    if (this.instance === null) {
      await this.restore();
      if (this.instance === null) {
        const bundle = packagedPlatform;
        this.instance = (await boot(
          bundle.impl,
          bundle.iface,
          initialDoc(bundle.iface, { motd: "hello from the penguin hot platform" }),
          this.resources,
        )) as Instance<PlatformApi>;
      }
    }
    return this.instance;
  }

  /**
   * Resume from harness.json (once). Any failure (missing or corrupt
   * artifact, incompatible bundle) is non-fatal: it warns and leaves the
   * runtime to boot the packaged default — a bad persisted state must never
   * brick the runtime.
   */
  private async restore(): Promise<void> {
    if (this.restored) return;
    this.restored = true;
    let manifest: Manifest;
    try {
      manifest = JSON.parse(await fsp.readFile(this.manifestPath, "utf8")) as Manifest;
    } catch {
      return; // nothing committed yet
    }
    if (manifest.web !== undefined && "manifest" in manifest.web) {
      try {
        const gz = await fsp.readFile(path.join(this.hmrDir, manifest.web.manifest));
        this.webMem = filesMapFromGzip(gz);
      } catch (err) {
        this.warn(
          `persisted web dist missing/corrupt (${manifest.web.manifest}); using packaged assets: ${errMsg(err)}`,
        );
      }
    } else if (manifest.web !== undefined && "dir" in manifest.web) {
      const dir = path.join(this.hmrDir, manifest.web.dir);
      if (fs.existsSync(path.join(dir, "index.html"))) this.webDistDir = dir;
      else this.warn(`persisted web dist missing (${manifest.web.dir}); using packaged assets`);
    }
    if (manifest.platform !== undefined) {
      try {
        const bundle = await this.importBundleFile(
          path.join(this.hmrDir, manifest.platform.bundle),
        );
        const doc = JSON.parse(
          await fsp.readFile(path.join(this.hmrDir, manifest.platform.park), "utf8"),
        ) as Json;
        this.instance = (await boot(
          bundle.impl,
          bundle.iface,
          doc,
          this.resources,
        )) as Instance<PlatformApi>;
        this.implId = bundle.id;
      } catch (err) {
        this.warn(
          `persisted platform failed to restore; using the packaged default: ${errMsg(err)}`,
        );
      }
    }
  }

  /** Strictly request-driven; serialized on the op queue (never auto-triggered). */
  upgradeTo(target: UpgradeTarget): Promise<UpgradeOutcome> {
    const run = this.opQueue.then(() => this.doUpgrade(target));
    // The queue must survive a failed upgrade: swallow for chaining only.
    this.opQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doUpgrade(target: UpgradeTarget): Promise<UpgradeOutcome> {
    const current = await this.ensure();

    const bundle = await this.importBundleFile(target.bundlePath);
    const source = target.source ?? null;

    // Park to disk before touching anything: crash-safe by construction.
    await fsp.mkdir(this.hmrDir, { recursive: true });
    const parkPath = path.join(this.hmrDir, "platform.park.json");
    await fsp.writeFile(parkPath, JSON.stringify(current.park(), null, 2));

    const result = await upgrade({
      current,
      impl: bundle.impl,
      iface: bundle.iface,
      resources: this.resources,
    });
    if (result.status === "blocked") {
      // Old instance untouched; the doc + path lists are the input for the
      // upper upgrade-ladder rungs (auto-upgrader / agent / human).
      return {
        status: "blocked",
        dropped: result.dropped,
        missing: result.missing,
        invalid: result.invalid,
      };
    }
    this.instance = result.instance as Instance<PlatformApi>;
    this.implId = bundle.id;
    await fsp.writeFile(parkPath, JSON.stringify(result.doc, null, 2));
    // Commit AFTER the live boot succeeded: a restart resumes only validated code.
    await this.persistPlatform(target.bundlePath, result.doc);
    return { status: "ok", mode: result.mode, impl: bundle.id, source };
  }

  /** Layer (a) core: import one JS file, cache-busted so re-imports load fresh code. */
  private async importBundleFile(file: string): Promise<PlatformBundle> {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) throw new Error(`bundle file '${file}' does not exist`);
    const url = `${pathToFileURL(resolved).href}?v=${Date.now()}`;
    const mod = (await import(url)) as { hotPlatform?: PlatformBundle };
    if (mod.hotPlatform === undefined) {
      throw new Error(`${file} does not export 'hotPlatform'`);
    }
    return mod.hotPlatform;
  }

  /**
   * Materializes an inline platform bundle (the single-file ESM sent in the
   * request body) to disk and returns its path — how a push reaches a runtime
   * over HTTP alone: the bytes travel in the request, the server writes them,
   * then loads by path.
   */
  async writeInlineBundle(content: string): Promise<string> {
    const dir = path.join(this.hmrDir, "uploads");
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `platform-${sha1(content).slice(0, 16)}.mjs`);
    await fsp.writeFile(file, content, "utf8");
    return file;
  }

  // -- Web platform (the frontend package's built dist) ---------------------

  /**
   * Overrides the directory the server's static hosting serves when set (a
   * dev distPath push or a restored legacy { dir } manifest); null when
   * nothing is pushed OR a memory-resident dist (webMem) is authoritative —
   * see resolveWebSource, which checks webMem FIRST.
   */
  webDistDir: string | null = null;

  /**
   * The pushed web dist held in memory (relPath → bytes): the primary path
   * for a web push, replacing per-file disk writes with one artifact (see
   * persistWebArtifact). Null when nothing has been pushed to memory.
   */
  private webMem: Map<string, Buffer> | null = null;

  /**
   * Static hosting's resolution order: an in-memory pushed dist first, then
   * a disk override (dev distPath push, or a restored legacy manifest), then
   * null — the caller (app.ts) falls back to the configured webDist.
   */
  resolveWebSource():
    { kind: "mem"; files: Map<string, Buffer> } | { kind: "dir"; dir: string } | null {
    if (this.webMem !== null) return { kind: "mem", files: this.webMem };
    if (this.webDistDir !== null) return { kind: "dir", dir: this.webDistDir };
    return null;
  }

  /**
   * Validates a { relPath: base64 } manifest, installs it as the in-memory
   * dist (memory always wins over a stale disk override — see
   * resolveWebSource), and persists it as the one gzip artifact `gz`
   * decodes/encodes to. Shared by both push transports below so they
   * converge on identical memory state and identical persistence.
   */
  private async commitWebFiles(
    files: Record<string, string>,
    gz: Buffer,
  ): Promise<{ rev: string }> {
    if (typeof files["index.html"] !== "string") {
      throw new Error("web dist manifest has no index.html");
    }
    const mem = new Map<string, Buffer>();
    for (const [rel, b64] of Object.entries(files)) {
      if (!isSafeRelPath(rel)) throw new Error(`unsafe path in web dist manifest: ${rel}`);
      mem.set(rel, Buffer.from(b64, "base64"));
    }
    const digest = filesDigest(files);
    this.webMem = mem;
    this.webDistDir = null; // the fresh push wins over any stale disk override
    await this.persistWebArtifact(gz, digest.slice(0, 16));
    return { rev: digest.slice(0, 12) };
  }

  /**
   * THE PRIMARY PATH: a raw gzip(JSON.stringify({ files })) artifact as the
   * request body — one write on this end instead of one per file (the
   * small-file-count bottleneck this replaces).
   */
  async installGzipWebDist(gz: Buffer): Promise<{ rev: string }> {
    return this.commitWebFiles(filesFromGzip(gz), gz);
  }

  /**
   * The JSON { relPath: base64 } manifest transport: re-packed into the same
   * gzip artifact so both transports persist through the identical path.
   */
  async installInlineWebDist(files: Record<string, string>): Promise<{ rev: string }> {
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ files })));
    return this.commitWebFiles(files, gz);
  }

  /** Points static hosting at a freshly pushed web dist on disk (dev convenience); returns its content rev. */
  setWebDist(distPath: string): { dist: string; rev: string } {
    const dist = path.resolve(distPath);
    const index = path.join(dist, "index.html");
    if (!fs.existsSync(index)) {
      throw new Error(`'${distPath}' is not a web dist (no index.html)`);
    }
    this.webMem = null; // the disk override wins over any stale memory push
    this.webDistDir = dist;
    return { dist, rev: sha1(fs.readFileSync(index, "utf8")).slice(0, 12) };
  }

  // -- Persistence ----------------------------------------------------------

  /** Content-address the bundle + its committed parked doc, then flip harness.json. */
  private async persistPlatform(bundleFile: string, doc: Json): Promise<void> {
    try {
      const content = await fsp.readFile(bundleFile);
      const sha = sha1(content.toString("utf8")).slice(0, 16);
      const dir = path.join(this.storeDir, "platform");
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, `${sha}.mjs`), content);
      await fsp.writeFile(path.join(dir, `${sha}.park.json`), JSON.stringify(doc));
      await this.commitManifest((m) => ({
        ...m,
        platform: { bundle: `store/platform/${sha}.mjs`, park: `store/platform/${sha}.park.json` },
      }));
    } catch (err) {
      this.warn(`platform update not persisted (filesystem unavailable?): ${errMsg(err)}`);
    }
  }

  /** Writes the gzip artifact once (content-addressed) and flips harness.json to point at it. */
  private async persistWebArtifact(gz: Buffer, sha: string): Promise<void> {
    try {
      const dir = path.join(this.storeDir, "web");
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, `${sha}.webz`), gz);
      await this.commitManifest((m) => ({ ...m, web: { manifest: `store/web/${sha}.webz` } }));
    } catch (err) {
      this.warn(`web update not persisted (filesystem unavailable?): ${errMsg(err)}`);
    }
  }

  /** Reads, updates, and atomically replaces harness.json (the single commit point). */
  private async commitManifest(update: (m: Manifest) => Manifest): Promise<void> {
    await fsp.mkdir(this.hmrDir, { recursive: true });
    let current: Manifest = {};
    try {
      current = JSON.parse(await fsp.readFile(this.manifestPath, "utf8")) as Manifest;
    } catch {
      // no manifest yet
    }
    const next = update(current);
    const tmp = `${this.manifestPath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2));
    // Atomic within the same directory/filesystem (libuv maps this to
    // MoveFileEx REPLACE_EXISTING on Windows, rename(2) on POSIX).
    await fsp.rename(tmp, this.manifestPath);
    await this.pruneStore(next);
  }

  /**
   * Store GC: keep at most STORE_KEEP platform bundles and web dists — the
   * committed one is always kept, the rest by recency. Best-effort; ordered
   * after the manifest flip so nothing referenced can be pruned.
   */
  private async pruneStore(manifest: Manifest): Promise<void> {
    const keepNewest = async (
      dir: string,
      keys: (name: string) => string | null,
      referenced: string | null,
      remove: (key: string) => Promise<void>,
    ): Promise<void> => {
      let names: string[];
      try {
        names = await fsp.readdir(dir);
      } catch {
        return;
      }
      const byKey = new Map<string, number>();
      for (const name of names) {
        const key = keys(name);
        if (key === null) continue;
        try {
          const mtime = (await fsp.stat(path.join(dir, name))).mtimeMs;
          byKey.set(key, Math.max(byKey.get(key) ?? 0, mtime));
        } catch {
          // raced with a concurrent prune
        }
      }
      const ranked = [...byKey.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
      const kept = new Set(ranked.slice(0, STORE_KEEP));
      if (referenced !== null) kept.add(referenced);
      for (const key of ranked) {
        if (!kept.has(key)) await remove(key).catch(() => undefined);
      }
    };

    const platformDir = path.join(this.storeDir, "platform");
    const platformRef = manifest.platform?.bundle.match(/([0-9a-f]+)\.mjs$/)?.[1] ?? null;
    await keepNewest(
      platformDir,
      (name) => /^([0-9a-f]+)\.mjs$/.exec(name)?.[1] ?? null,
      platformRef,
      async (sha) => {
        await fsp.rm(path.join(platformDir, `${sha}.mjs`), { force: true });
        await fsp.rm(path.join(platformDir, `${sha}.park.json`), { force: true });
      },
    );

    // .webz artifacts only: a directory left over from a pre-single-artifact
    // install (the legacy { dir } form) doesn't match `.webz` and is simply
    // left alone — not tracked, not pruned.
    const webDir = path.join(this.storeDir, "web");
    const webRef =
      manifest.web !== undefined && "manifest" in manifest.web
        ? (manifest.web.manifest.match(/([0-9a-f]+)\.webz$/)?.[1] ?? null)
        : null;
    await keepNewest(
      webDir,
      (name) => /^([0-9a-f]+)\.webz$/.exec(name)?.[1] ?? null,
      webRef,
      (sha) => fsp.rm(path.join(webDir, `${sha}.webz`), { force: true }),
    );
  }

  /**
   * Publishes the local credential file ($PENGUIN_HOME/hmr/api.json, mode
   * 0600): local tools read { url, token } from it to call the hot APIs.
   * Called once the HTTP listener is up (index.ts).
   */
  async writeApiFile(url: string): Promise<void> {
    await fsp.mkdir(this.hmrDir, { recursive: true });
    await fsp.writeFile(
      path.join(this.hmrDir, "api.json"),
      JSON.stringify({ url, token: this.apiToken }, null, 2),
      { mode: 0o600 },
    );
  }

  /** Process-exit sweep only; never part of an upgrade. */
  dispose(): void {
    this.instance?.dispose();
    this.instance = null;
    this.resources.disposeAll();
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sha1(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}

/** Content hash over a web dist manifest: stable across re-pushes of identical content. */
function filesDigest(files: Record<string, string>): string {
  const hash = crypto.createHash("sha1");
  for (const rel of Object.keys(files).sort()) hash.update(rel).update("\0").update(files[rel]!);
  return hash.digest("hex");
}

/** No absolute paths, no `..` segments — the map is looked up by exact key, but a malformed key must never be stored. */
function isSafeRelPath(rel: string): boolean {
  if (rel === "" || rel.startsWith("/") || rel.includes("\\")) return false;
  return rel.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** Decodes a gzip(JSON.stringify({ files })) artifact into its manifest. */
function filesFromGzip(gz: Buffer): Record<string, string> {
  let parsed: { files?: unknown };
  try {
    parsed = JSON.parse(zlib.gunzipSync(gz).toString("utf8")) as { files?: unknown };
  } catch (err) {
    throw new Error(`invalid gzip web dist artifact: ${errMsg(err)}`);
  }
  if (typeof parsed.files !== "object" || parsed.files === null) {
    throw new Error("gzip web dist artifact has no `files`");
  }
  return parsed.files as Record<string, string>;
}

/** Decodes a gzip artifact straight into the in-memory relPath → bytes map (the restore path). */
function filesMapFromGzip(gz: Buffer): Map<string, Buffer> {
  const files = filesFromGzip(gz);
  const mem = new Map<string, Buffer>();
  for (const [rel, b64] of Object.entries(files)) {
    if (!isSafeRelPath(rel)) throw new Error(`unsafe path in web dist manifest: ${rel}`);
    mem.set(rel, Buffer.from(b64, "base64"));
  }
  return mem;
}
