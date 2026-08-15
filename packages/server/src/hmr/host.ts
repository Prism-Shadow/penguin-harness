/**
 * HmrHost: the runtime side of the stop-the-world hot-update protocol.
 *
 * RUNTIME LAYER — MECHANISM ONLY. Nothing here may encode what the product
 * does; policy belongs in the platform, which ships by HTTP push in seconds
 * while every line in this file costs a rebuild and a redeploy of every
 * installation. Before adding anything, read ./README.md — in particular the
 * "fix where the code is" trap, which is how this rule usually gets broken.
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
 * ONE atomic version: platform = cli + platform code + web is a single
 * indivisible unit, pushed together to POST /api/hmr/upgrade. The pushed
 * bundle (inline ESM source, delivered as bytes over HTTP — never a
 * server-side path a remote client could not produce) exports BOTH
 * `hotPlatform` (this runtime's business unit) and `cli` (the function
 * packages/cli's thin loader dynamically imports on every invocation — see
 * hmr/manifest.ts's resolveCliBundlePath). The web dist rides along in the
 * same request as a { relPath: base64 } manifest. There is no way to update
 * platform, cli, or web independently: doUpgradeAll only commits after BOTH
 * the platform boots successfully AND the web manifest validates — a failure
 * in either leaves the previous committed version untouched.
 *
 * Web dist pushes are held in memory (a relPath → bytes map), not written to
 * disk file-by-file: a dist can be hundreds of small files, and syncing each
 * one separately serializes on the destination filesystem's per-file
 * overhead (observed as low as ~100KB/s writing 300 small files to a
 * Windows/Defender-scanned disk). The pushed bytes are persisted as ONE
 * artifact instead (see persistVersion).
 *
 * Persistence: artifacts are content-addressed under hmr/store/ and the whole
 * version (platform + cli + web pointers) is promoted by ONE atomic rename of
 * hmr/harness.json — committed only AFTER the live in-memory boot AND web
 * install both succeeded, so a restart can never resume a version that failed
 * to take effect. A restart resumes harness.json as one unit (see restore()):
 * any failure — of any one of the three pieces — warns and falls back to the
 * packaged default entirely (never a platform/web mismatch, never a brick).
 * The store keeps at most STORE_KEEP versions (current + one rollback).
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
import type { Manifest } from "./manifest.js";
import type { PlatformApi } from "../platform/platform.js";
import { packagedPlatform } from "../platform/platform.js";
import type { AnyIface, AnyImpl } from "@prismshadow/penguin-core/kernel";

export interface PlatformBundle {
  id: string;
  iface: AnyIface;
  impl: AnyImpl;
}

/** Optional provenance recorded with a pushed version (never executed here). */
export interface GitSource {
  repo: string;
  revision: string;
}

/**
 * One atomic push: the platform+cli bundle (inline ESM source) plus the web dist as
 * a { relPath: base64 } manifest. Both travel in the SAME request — there is no
 * partial-target upgrade.
 */
export interface UpgradeAllTarget {
  bundle: string;
  web: Record<string, string>;
  source?: GitSource;
}

export type UpgradeOutcome =
  | {
      status: "ok";
      mode: "silent" | "migrated";
      impl: string;
      source: GitSource | null;
      web: { rev: string };
    }
  | { status: "blocked"; dropped: string[]; missing: string[]; invalid: string[] };

/** How many past versions (platform+cli bundle / web dist pairs) the store keeps (current + one rollback). */
const STORE_KEEP = 2;

export class HmrHost {
  readonly resources = new HotResources();

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
   * Lazy first boot. Resumes the last committed version (platform + cli + web)
   * from disk when present; otherwise boots the packaged platform v1 with a
   * fresh document.
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
   * Resume from harness.json (once), as ONE unit: the platform bundle, its parked
   * doc, and the web artifact are all read and validated BEFORE anything is
   * committed to `this.instance` / `this.webMem` — so a failure partway through
   * (a pruned bundle, a corrupt park, a missing web artifact) never leaves platform
   * and web resumed from different versions. Any failure is non-fatal: it warns and
   * leaves the runtime to boot the packaged default — a bad persisted state must
   * never brick the runtime.
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
    if (manifest.platform === undefined && manifest.web === undefined) {
      return; // nothing committed yet
    }
    try {
      if (manifest.platform === undefined) {
        throw new Error("harness.json has no `platform` entry");
      }
      if (manifest.web === undefined) {
        throw new Error("harness.json has no `web` entry");
      }
      const bundle = await this.importBundleFile(path.join(this.hmrDir, manifest.platform.bundle));
      const doc = JSON.parse(
        await fsp.readFile(path.join(this.hmrDir, manifest.platform.park), "utf8"),
      ) as Json;
      const gz = await fsp.readFile(path.join(this.hmrDir, manifest.web.manifest));
      const webMem = filesMapFromGzip(gz);
      // Everything validated: commit together. boot() runs last so a boot failure
      // (e.g. an incompatible parked doc) leaves nothing partially applied either.
      const instance = (await boot(
        bundle.impl,
        bundle.iface,
        doc,
        this.resources,
      )) as Instance<PlatformApi>;
      this.instance = instance;
      this.implId = bundle.id;
      this.webMem = webMem;
    } catch (err) {
      this.warn(
        `persisted version failed to restore (platform+cli+web are committed as one unit); ` +
          `using the packaged default: ${errMsg(err)}`,
      );
    }
  }

  /** Strictly request-driven; serialized on the op queue (never auto-triggered). */
  upgradeAll(target: UpgradeAllTarget): Promise<UpgradeOutcome> {
    const run = this.opQueue.then(() => this.doUpgradeAll(target));
    // The queue must survive a failed upgrade: swallow for chaining only.
    this.opQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doUpgradeAll(target: UpgradeAllTarget): Promise<UpgradeOutcome> {
    const current = await this.ensure();

    if (typeof target.web["index.html"] !== "string") {
      throw new Error("web dist manifest has no index.html");
    }
    const webMem = new Map<string, Buffer>();
    for (const [rel, b64] of Object.entries(target.web)) {
      if (!isSafeRelPath(rel)) throw new Error(`unsafe path in web dist manifest: ${rel}`);
      webMem.set(rel, Buffer.from(b64, "base64"));
    }

    const bundlePath = await this.writeInlineBundle(target.bundle);
    const bundle = await this.importUnifiedBundle(bundlePath);
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
      // Old instance + web untouched; the doc + path lists are the input for the
      // upper upgrade-ladder rungs (auto-upgrader / agent / human).
      return {
        status: "blocked",
        dropped: result.dropped,
        missing: result.missing,
        invalid: result.invalid,
      };
    }

    // Boot succeeded: commit web to memory too, then persist BOTH as one atomic
    // version — never a platform that's newer (or older) than the web it's paired
    // with.
    this.instance = result.instance as Instance<PlatformApi>;
    this.implId = bundle.id;
    this.webMem = webMem;
    await fsp.writeFile(parkPath, JSON.stringify(result.doc, null, 2));

    const digest = filesDigest(target.web);
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ files: target.web })));
    await this.persistVersion(target.bundle, result.doc, gz, digest.slice(0, 16));

    return {
      status: "ok",
      mode: result.mode,
      impl: bundle.id,
      source,
      web: { rev: digest.slice(0, 12) },
    };
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
   * Push-time validation: the bundle must export BOTH `hotPlatform` (this
   * runtime's business unit) and `cli` (a function — what packages/cli's thin
   * loader will dynamically import and call). Enforces the "platform = cli +
   * platform code + web, one indivisible version" invariant at the door, rather
   * than discovering a CLI-less bundle only when some later `penguin` invocation
   * fails to load it.
   */
  private async importUnifiedBundle(file: string): Promise<PlatformBundle> {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) throw new Error(`bundle file '${file}' does not exist`);
    const url = `${pathToFileURL(resolved).href}?v=${Date.now()}`;
    const mod = (await import(url)) as { hotPlatform?: PlatformBundle; cli?: unknown };
    if (mod.hotPlatform === undefined) {
      throw new Error(`${file} does not export 'hotPlatform'`);
    }
    if (typeof mod.cli !== "function") {
      throw new Error(
        `${file} does not export 'cli' (a function) — platform and cli ship together`,
      );
    }
    return mod.hotPlatform;
  }

  /**
   * Materializes an inline bundle (the single-file ESM sent in the request body)
   * to disk and returns its path — how a push reaches a runtime over HTTP alone:
   * the bytes travel in the request, the server writes them, then loads them.
   */
  private async writeInlineBundle(content: string): Promise<string> {
    const dir = path.join(this.hmrDir, "uploads");
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `platform-${sha1(content).slice(0, 16)}.mjs`);
    await fsp.writeFile(file, content, "utf8");
    return file;
  }

  // -- Web platform (the frontend package's built dist) ---------------------

  /**
   * The pushed web dist held in memory (relPath → bytes) — always installed
   * together with a platform+cli version (see doUpgradeAll); never written or
   * read file-by-file (see persistVersion). Null before anything has ever been
   * pushed or restored.
   */
  private webMem: Map<string, Buffer> | null = null;

  /** Static hosting's resolution: an in-memory pushed/restored dist, or null (the caller falls back to the configured webDist). */
  resolveWebSource(): { kind: "mem"; files: Map<string, Buffer> } | null {
    return this.webMem !== null ? { kind: "mem", files: this.webMem } : null;
  }

  // -- Persistence ----------------------------------------------------------

  /**
   * Content-addresses the bundle + its committed parked doc + the web gzip
   * artifact, then flips harness.json ONCE — `platform`, `cli` (same file as
   * `platform`, since one bundle exports both), and `web` all land in the SAME
   * atomic rename, never three separate commits that could leave one pointer
   * ahead of the others.
   */
  private async persistVersion(
    bundleContent: string,
    doc: Json,
    webGz: Buffer,
    webSha: string,
  ): Promise<void> {
    try {
      const sha = sha1(bundleContent).slice(0, 16);
      const platformDir = path.join(this.storeDir, "platform");
      await fsp.mkdir(platformDir, { recursive: true });
      await fsp.writeFile(path.join(platformDir, `${sha}.mjs`), bundleContent, "utf8");
      await fsp.writeFile(path.join(platformDir, `${sha}.park.json`), JSON.stringify(doc));

      const webDir = path.join(this.storeDir, "web");
      await fsp.mkdir(webDir, { recursive: true });
      await fsp.writeFile(path.join(webDir, `${webSha}.webz`), webGz);

      await this.commitManifest(() => ({
        platform: { bundle: `store/platform/${sha}.mjs`, park: `store/platform/${sha}.park.json` },
        cli: { bundle: `store/platform/${sha}.mjs` },
        web: { manifest: `store/web/${webSha}.webz` },
      }));
    } catch (err) {
      this.warn(`update not persisted (filesystem unavailable?): ${errMsg(err)}`);
    }
  }

  /** Writes and atomically replaces harness.json (the single commit point for a whole version). */
  private async commitManifest(next: () => Manifest): Promise<void> {
    await fsp.mkdir(this.hmrDir, { recursive: true });
    const manifest = next();
    const tmp = `${this.manifestPath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(manifest, null, 2));
    // Atomic within the same directory/filesystem (libuv maps this to
    // MoveFileEx REPLACE_EXISTING on Windows, rename(2) on POSIX).
    await fsp.rename(tmp, this.manifestPath);
    await this.pruneStore(manifest);
  }

  /**
   * Store GC: keep at most STORE_KEEP versions — the committed one is always
   * kept, the rest by recency. Best-effort; ordered after the manifest flip so
   * nothing referenced can be pruned. `cli` shares the platform bundle's file, so
   * only `platform` and `web` need their own sweep.
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

    const webDir = path.join(this.storeDir, "web");
    const webRef = manifest.web?.manifest.match(/([0-9a-f]+)\.webz$/)?.[1] ?? null;
    await keepNewest(
      webDir,
      (name) => /^([0-9a-f]+)\.webz$/.exec(name)?.[1] ?? null,
      webRef,
      (sha) => fsp.rm(path.join(webDir, `${sha}.webz`), { force: true }),
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
