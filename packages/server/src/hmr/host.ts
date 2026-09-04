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
 * ONE atomic push, THREE independent artifacts: platform code, the CLI's
 * command implementations, and the web dist are three separately compiled
 * single-file products — there is no physical bundle that carries more than
 * one of them — but they always move together in ONE request to POST
 * /api/hmr/upgrade and land as ONE atomic version. The pushed `platform` and
 * `cli` fields are each inline ESM source (delivered as bytes over HTTP —
 * never a server-side path a remote client could not produce): `platform`
 * must export `hotPlatform` (this runtime's business unit, imported and
 * booted here); `cli` is never imported or executed by this process at all —
 * it is only content-addressed into the store, for packages/cli's own thin
 * loader to dynamically import later (see hmr/manifest.ts's
 * resolveCliBundlePath). The web dist rides along in the same request as a
 * { relPath: base64 } manifest. There is no way to update platform, cli, or
 * web independently: doUpgradeAll only commits after the platform boots
 * successfully AND the web manifest validates — a failure in either leaves
 * the previous committed version untouched.
 *
 * Web dist pushes are held in memory (a relPath → bytes map), not written to
 * disk file-by-file: a dist can be hundreds of small files, and syncing each
 * one separately serializes on the destination filesystem's per-file
 * overhead (observed as low as ~100KB/s writing 300 small files to a
 * Windows/Defender-scanned disk). The pushed bytes are persisted as ONE
 * artifact instead (see persistVersion).
 *
 * Persistence: artifacts are content-addressed under hmr/store/ (platform and
 * cli each get their own subtree, since they are no longer the same file) and
 * the whole version (platform + cli + web pointers) is promoted by ONE atomic
 * rename of hmr/harness.json — committed only AFTER the live in-memory boot
 * AND web install both succeeded, so a restart can never resume a version
 * that failed to take effect. A restart resumes harness.json as one unit (see
 * restore()): any failure — of any one of the three pieces, including a `cli`
 * pointer whose file is missing — warns and falls back to the packaged
 * default entirely (never a platform/web mismatch, never a brick). The store
 * keeps at most STORE_KEEP versions (current + one rollback) per artifact.
 *
 * CODE persists; STATE does not. Only platform code, the CLI bundle, and the web
 * dist are written to disk — never the parked context document a swap produces.
 * A restart therefore always resumes the pushed CODE, but boots it against a
 * FRESH initial context (bundle.context — see PlatformBundle below), not
 * whatever state was live when the process last exited. This is deliberate: the
 * live resources a parked doc's handles would reference (child processes, etc.)
 * die with the process anyway, so a restored doc could only ever resume as
 * "handles that fail to reclaim, nodes stuck degraded" — worse than a clean
 * boot. State DOES survive a hot swap (park → migrate → boot, entirely
 * in-memory, see kernel/upgrade.ts) — it just never survives a process restart.
 *
 * Reload is strictly request-driven: nothing watches, nothing auto-triggers.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { pathToFileURL } from "node:url";
import type {
  Instance,
  Json,
  AnyIface,
  AnyImpl,
  Opaque,
  Resources,
} from "@prismshadow/penguin-core/kernel";
import { boot, initialDoc, upgrade, Interface } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "./resources.js";
import type { Manifest } from "./manifest.js";
import type { PlatformApi } from "./platform.js";
import { packagedPlatform } from "./platform.js";

/**
 * The contract every platform bundle must satisfy — packaged or pushed. `context` is the
 * initial context a fresh boot creates the tree with (see initialDoc): the runtime never
 * hardcodes a business value of its own, so this is where a business platform's own
 * starting state belongs (see platform/platform.ts's packagedPlatform).
 */
export interface PlatformBundle {
  id: string;
  iface: AnyIface;
  impl: AnyImpl;
  context: Json;
}

/** Optional provenance recorded with a pushed version (never executed here). */
export interface GitSource {
  repo: string;
  revision: string;
}

/**
 * Files a push needs on DISK rather than in memory. The web dist is only ever served as
 * bytes, so it stays in RAM; an asset is something the platform hands to the OS — a
 * native `.node` whose loader resolves it by path, a helper binary it execs — and a
 * bundle cannot carry those: it is imported from the data root, where neither a relative
 * `build/Release/pty.node` nor a bare specifier resolves (verified: node-pty's binding
 * fails to load from a bundle placed outside the server's own module graph).
 */
export interface UpgradeAssets {
  /** relPath → base64 content. */
  files: Record<string, string>;
  /** relPaths that must land executable (a helper binary the platform spawns). */
  exec?: string[];
}

/**
 * One atomic push: the platform bundle and the cli bundle (each inline ESM source,
 * independent single-file artifacts) plus the web dist as a { relPath: base64 }
 * manifest. All three travel in the SAME request — there is no partial-target
 * upgrade.
 */
export interface UpgradeAllTarget {
  platform: string;
  cli: string;
  web: Record<string, string>;
  assets?: UpgradeAssets;
  source?: GitSource;
}

/**
 * Written into an assets directory once every file in it is on disk. Its absence marks a
 * directory whose materialization was interrupted; no asset path can collide with it
 * (assets arrive as `node_modules/...` paths).
 */
export const MATERIALIZED = ".materialized";

export type UpgradeOutcome =
  | {
      status: "ok";
      mode: "silent" | "migrated";
      impl: string;
      source: GitSource | null;
      web: { rev: string };
      /**
       * Whether persistVersion's disk commit succeeded. The live swap always applies
       * on `status: "ok"` regardless (see the module doc: "never brick"); when this is
       * false the new version is running but NOT durable — a restart would resume the
       * previously committed version instead. Callers (routes.ts, scripts/deploy.mjs)
       * surface this so a filesystem failure during persistence is visible rather than
       * indistinguishable from a fully-durable push.
       */
      persisted: boolean;
    }
  | { status: "blocked"; dropped: string[]; missing: string[]; invalid: string[] };

/**
 * How many versions of each artifact (platform bundle / cli bundle / web dist / assets
 * dir, each independently) the store keeps by recency — a rollback copy behind the newest.
 * The version harness.json references is kept on top of these, so a store holds three
 * entries whenever the committed version is not among the two most recently written.
 */
const STORE_KEEP = 2;

export class HmrHost {
  readonly resources = new HotResources();

  private instance: Instance<PlatformApi> | null = null;
  /**
   * The bundle behind the RUNNING instance, held as the loaded object rather than a
   * pointer to re-read: it is what boot-failure recovery re-boots (see recoverPrevious).
   * A bundle's `id` cannot stand in for this — the packaged export IS what a push
   * delivers (hmr/entry.ts re-exports `packagedPlatform` as `hotPlatform`), so every
   * pushed bundle carries the packaged id and comparing ids cannot tell a pushed version
   * from the compiled-in default. Nor can the manifest: a push whose disk commit failed
   * (`persisted: false`) is running a version harness.json does not name.
   */
  private current: PlatformBundle = packagedPlatform;
  /** Current version's materialized native assets dir (see assetsDir()). */
  private assets: string | null = null;
  private readonly hmrDir: string;
  private readonly storeDir: string;
  private readonly manifestPath: string;
  /**
   * Single-flight guard for the first boot (see ensure()): every concurrent caller before the
   * first successful boot awaits the SAME promise, so restore() and the packaged-default
   * fallback can never run twice and race each other into assigning `this.instance` (a double
   * boot, or a restored version clobbered by a concurrently-booted packaged default).
   */
  private initPromise: Promise<Instance<PlatformApi>> | null = null;
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

  /** The running version's id — derived from the running bundle, never tracked alongside it. */
  currentImplId(): string {
    return this.current.id;
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
   * fresh document. Concurrent callers before the first boot completes share one
   * in-flight promise (see `initPromise`) rather than each racing their own
   * restore()/packaged-boot.
   */
  /**
   * The App of THIS moment, or null before the first boot and after dispose. For the
   * callers that outlive swaps — the runtime app, the process handlers — which must not
   * hold a generation's objects across a push (see ServerBoot.tree).
   */
  currentApp(): Instance<PlatformApi> | null {
    return this.instance;
  }

  ensure(): Promise<Instance<PlatformApi>> {
    if (this.instance !== null) return Promise.resolve(this.instance);
    this.initPromise ??= this.initialize();
    return this.initPromise;
  }

  /** Runs exactly once per process (guarded by `initPromise` in ensure()). */
  private async initialize(): Promise<Instance<PlatformApi>> {
    try {
      await this.restore();
      if (this.instance === null) {
        const bundle = packagedPlatform;
        this.instance = (await boot(
          bundle.impl,
          bundle.iface,
          initialDoc(bundle.iface, bundle.context),
          this.resources,
        )) as Instance<PlatformApi>;
        this.current = bundle;
      }
      return this.instance;
    } catch (err) {
      // A failed init must not permanently strand ensure(): clear the guard so the next
      // caller gets a fresh attempt instead of the same rejection forever.
      this.initPromise = null;
      throw err;
    }
  }

  /**
   * Resume from harness.json, as ONE unit: the platform bundle, the cli bundle's own
   * existence, and the web artifact are all read and validated BEFORE anything is
   * committed to `this.instance` / `this.webMem` — so a failure partway through (a
   * pruned bundle, a missing web artifact, a missing cli artifact) never leaves
   * platform and web resumed from different versions. The cli bundle is never
   * imported here (this process never runs it — only packages/cli's own loader
   * does); its file just has to exist, so a restore can never leave `cli.bundle`
   * pointing at nothing. Any failure is non-fatal: it warns and leaves the runtime
   * to boot the packaged default — a bad persisted version must never brick the
   * runtime. Only ever called once (from initialize(), itself single-flighted by
   * ensure()'s `initPromise`).
   *
   * Boots the restored bundle against its OWN fresh initial context (bundle.context),
   * not a resumed state — state is never written to disk (see the module doc), so a
   * restart always resumes the pushed CODE with a clean slate, never last run's doc.
   */
  private async restore(): Promise<void> {
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
      if (manifest.cli === undefined) {
        throw new Error("harness.json has no `cli` entry");
      }
      if (manifest.web === undefined) {
        throw new Error("harness.json has no `web` entry");
      }
      const cliPath = path.join(this.hmrDir, manifest.cli.bundle);
      if (!fs.existsSync(cliPath)) {
        throw new Error(`cli bundle '${manifest.cli.bundle}' does not exist`);
      }
      // Republished before boot, same ordering as an upgrade: a resumed platform loads its
      // native modules out of the assets the version was committed with.
      if (manifest.assets !== undefined) {
        const assetsDir = path.join(this.hmrDir, manifest.assets.dir);
        if (!fs.existsSync(assetsDir)) {
          throw new Error(`assets dir '${manifest.assets.dir}' does not exist`);
        }
        this.publishAssets(assetsDir);
      }
      const bundle = await this.importBundleFile(path.join(this.hmrDir, manifest.platform.bundle));
      const gz = await fsp.readFile(path.join(this.hmrDir, manifest.web.manifest));
      const webMem = filesMapFromGzip(gz);
      // The same floor a push is held to (doUpgradeAll): a web version without its entry
      // page would be committed as "restored" and then answer 404 to every navigation,
      // with nothing in the log to say why. Failing here lands on the packaged default
      // instead, and names the reason.
      if (!webMem.has("index.html")) {
        throw new Error(`web dist '${manifest.web.manifest}' has no index.html`);
      }
      // Everything validated: commit together. boot() runs last so a boot failure
      // leaves nothing partially applied either.
      const instance = (await boot(
        bundle.impl,
        bundle.iface,
        initialDoc(bundle.iface, bundle.context),
        this.resources,
      )) as Instance<PlatformApi>;
      this.instance = instance;
      this.current = bundle;
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

    const { file: platformPath, sha: platformSha } = await this.storePlatformBundle(
      target.platform,
    );
    const bundle = await this.importBundleFile(platformPath);
    const source = target.source ?? null;

    // Assets land BEFORE the boot: the platform's create() may load a native module out of
    // them. A failed boot puts the pointer back, so the surviving old platform keeps
    // claiming the assets it booted with.
    const previousAssets = this.assets;
    const assetsDir = target.assets ? await this.materializeAssets(target.assets) : null;
    if (assetsDir !== null) this.publishAssets(assetsDir);

    let result;
    try {
      result = await upgrade({
        current,
        impl: bundle.impl,
        iface: bundle.iface,
        resources: this.resources,
      });
    } catch (err) {
      this.publishAssets(previousAssets);
      throw err;
    }
    if (result.status === "blocked") {
      this.publishAssets(previousAssets);
      // Old instance + web untouched; the doc + path lists are the input for the
      // upper upgrade-ladder rungs (auto-upgrader / agent / human).
      return {
        status: "blocked",
        dropped: result.dropped,
        missing: result.missing,
        invalid: result.invalid,
      };
    }
    if (result.status === "failed") {
      // The pushed platform's boot threw AFTER the old tree was disposed
      // (validate-then-swap disposes first so the new tree can adopt what the old one
      // delivered). Without recovery the process is half-dead: `this.instance` still
      // answers HTTP out of closures, but its manager is closed and the current-App
      // pointer is released — until a restart. So re-boot the PREVIOUS platform from the
      // parked document the kernel handed back. The park-by-inventory contract is what
      // makes this an ordinary load: the old App's dispose suspended and detached
      // everything, so the recovered App adopts the delivered resources and restarts the
      // suspended machinery like any successor. The pusher still gets an error — the
      // push DID fail — but the machine it failed on keeps working.
      this.publishAssets(previousAssets);
      await this.recoverPrevious(result.doc);
      throw new Error(`the pushed platform failed to boot: ${errMsg(result.error)}`);
    }

    // Boot succeeded: commit web to memory too, then persist platform + cli + web
    // as one atomic version — never a platform that's newer (or older) than the
    // web or cli it's paired with. `result.doc` (the swap's parked+migrated state)
    // is never written to disk — see the module doc: code persists, state does not.
    this.instance = result.instance as Instance<PlatformApi>;
    this.current = bundle;
    this.webMem = webMem;

    const digest = filesDigest(target.web);
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ files: target.web })));
    const persisted = await this.persistVersion(
      platformSha,
      target.cli,
      gz,
      digest.slice(0, 16),
      assetsDir,
      source,
    );

    return {
      status: "ok",
      mode: result.mode,
      impl: bundle.id,
      source,
      web: { rev: digest.slice(0, 12) },
      persisted,
    };
  }

  /**
   * Boot-failure recovery: re-boot the version that was running before the failed
   * upgrade, from its own parked document. The bundle is `this.current` — the object
   * that was running, still loaded — rather than anything re-read from disk: the
   * manifest names the last DURABLE version, which is a different version whenever the
   * running one could not be persisted, and a bundle's `id` cannot distinguish pushed
   * from packaged at all (see the field's doc). Best-effort by design: a double fault
   * only warns and leaves the disposed instance in place, because /api/hmr is
   * runtime-owned and therefore still reachable for a follow-up push, and a process
   * restart restores the committed version regardless.
   */
  private async recoverPrevious(doc: Json): Promise<void> {
    try {
      const bundle = this.current;
      this.instance = (await boot(
        bundle.impl,
        bundle.iface,
        doc,
        this.resources,
      )) as Instance<PlatformApi>;
      // `current` unchanged: the previous version is the running version again.
    } catch (err) {
      this.warn(
        `boot-failure recovery failed too — the process serves a half-stopped App until ` +
          `a successful push or a restart: ${errMsg(err)}`,
      );
    }
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
    if (mod.hotPlatform.context === undefined) {
      // Every bundle carries its own initial context now (see PlatformBundle above):
      // state is never persisted, so a boot with no context to fall back on would have
      // nothing to boot a fresh tree with — reject it the same way a missing
      // `hotPlatform` export is rejected, rather than booting with `undefined`.
      throw new Error(`${file}'s 'hotPlatform' has no 'context'`);
    }
    return mod.hotPlatform;
  }

  /**
   * Materializes the inline platform bundle (the single-file ESM sent in the
   * request body) to disk and returns its path and sha — how a push reaches a
   * runtime over HTTP alone: the bytes travel in the request, the server writes
   * them, then loads them via importBundleFile. Only the platform artifact needs
   * this treatment: it is the only one of the three this process ever imports
   * and boots. The cli artifact is never imported here (see persistVersion) — it
   * goes straight from request body to content-addressed store.
   *
   * It lands at its FINAL content-addressed path, before the boot that decides
   * whether it will be committed, so the bytes exist on disk exactly once: an
   * upload area separate from the store would hold a second copy of every bundle
   * ever pushed, under no sweep (pruneStore only knows the store). The cost is
   * that a push which fails to boot leaves an unreferenced file behind; the next
   * successful push's prune collects it, and the committed version is force-kept
   * regardless of how many failures sit between them.
   *
   * The write goes through writeStoreFile, which matters more here than for the other
   * two artifacts: this path is taken before the commit, so an idempotent re-push aims
   * at the exact file the current manifest points at — and the running version boots
   * from it.
   */
  private async storePlatformBundle(content: string): Promise<{ file: string; sha: string }> {
    const sha = sha1(content).slice(0, 16);
    const dir = path.join(this.storeDir, "platform");
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${sha}.mjs`);
    await writeStoreFile(file, Buffer.from(content, "utf8"));
    return { file, sha };
  }

  // -- Web platform (the frontend package's built dist) ---------------------

  /**
   * The pushed web dist held in memory (relPath → bytes) — always installed
   * together with a platform + cli version (see doUpgradeAll); never written or
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
   * Unpacks a push's assets under store/assets/<sha>/, content-addressed like every other
   * artifact so an unchanged set reuses its directory. Modes are restored from the push's
   * `exec` list: an asset arrives as base64 with no mode of its own, and a helper binary
   * without its exec bit is exactly the failure this whole path exists to avoid.
   *
   * An identical set is NOT re-written. That is a correctness requirement, not a saving:
   * these assets are native modules, and on Windows the copies from the last push are
   * mapped into this very process — reopening one for writing fails with EBUSY and takes
   * the whole upgrade down with it. The directory name already proves the content
   * matches; MATERIALIZED, written last, is what proves the directory is complete, so a
   * push interrupted halfway is repaired rather than trusted.
   */
  private async materializeAssets(assets: UpgradeAssets): Promise<string> {
    const sha = filesDigest(assets.files).slice(0, 16);
    const dir = path.join(this.storeDir, "assets", sha);
    const marker = path.join(dir, MATERIALIZED);
    if (fs.existsSync(marker)) return dir;

    const exec = new Set(assets.exec ?? []);
    for (const [rel, b64] of Object.entries(assets.files)) {
      if (!isSafeRelPath(rel)) throw new Error(`unsafe path in assets manifest: ${rel}`);
      const file = path.join(dir, rel);
      const content = Buffer.from(b64, "base64");
      await fsp.mkdir(path.dirname(file), { recursive: true });
      // Repairing an incomplete directory: whatever already matches is left alone, for the
      // same reason the whole directory is skipped above.
      if (!(await sameFileContent(file, content))) await fsp.writeFile(file, content);
      // Explicit chmod: writeFile's mode is masked by umask, and ignored outright when
      // the file already exists (a reused, content-addressed directory).
      await fsp.chmod(file, exec.has(rel) ? 0o755 : 0o644);
    }
    await fsp.writeFile(marker, sha);
    return dir;
  }

  /** Points the registry at this version's assets (or clears it when a push has none). */
  private publishAssets(dir: string | null): void {
    this.assets = dir;
  }

  /**
   * Where the current version's native-module assets live, or null when none were
   * pushed. A declared member of the hmr capability (see RUNTIME_INTERFACES), read by
   * the bundle's pty loader — not a registry key: the host is already the claimed
   * object, so its per-push state belongs on it.
   */
  assetsDir(): string | null {
    return this.assets;
  }

  /**
   * Content-addresses the cli bundle (never imported — just stored, for packages/cli's
   * own loader to pick up) and the web gzip artifact next to the platform bundle the
   * boot already stored (its CODE only — see the module doc: state is never
   * persisted), then flips harness.json ONCE — `platform`, `cli`, and `web` all land in the SAME atomic
   * rename, never three separate commits that could leave one pointer ahead of the
   * others. `platform.bundle` and `cli.bundle` are genuinely independent files
   * (distinct content, distinct sha) rather than the same physical bundle under two
   * manifest keys.
   *
   * Returns whether the commit succeeded — the caller surfaces this to clients
   * (`persisted` in UpgradeOutcome) so a live swap that could not be written to disk
   * is visibly at risk of reverting on the next restart, rather than silently ok.
   */
  private async persistVersion(
    platformSha: string,
    cliContent: string,
    webGz: Buffer,
    webSha: string,
    assetsDir: string | null,
    source: GitSource | null,
  ): Promise<boolean> {
    try {
      // The platform bundle is already in the store: storePlatformBundle put it at its
      // content-addressed path so the boot could import it from there, through the same
      // writeStoreFile the other two artifacts go through.
      const cliSha = sha1(cliContent).slice(0, 16);
      const cliDir = path.join(this.storeDir, "cli");
      await fsp.mkdir(cliDir, { recursive: true });
      await writeStoreFile(path.join(cliDir, `${cliSha}.mjs`), Buffer.from(cliContent, "utf8"));

      const webDir = path.join(this.storeDir, "web");
      await fsp.mkdir(webDir, { recursive: true });
      await writeStoreFile(path.join(webDir, `${webSha}.webz`), webGz);

      await this.commitManifest(() => ({
        platform: { bundle: `store/platform/${platformSha}.mjs` },
        cli: { bundle: `store/cli/${cliSha}.mjs` },
        web: { manifest: `store/web/${webSha}.webz` },
        ...(assetsDir === null
          ? {}
          : { assets: { dir: path.relative(this.hmrDir, assetsDir).split(path.sep).join("/") } }),
        // Provenance travels with the version it describes, so `penguin version` on this
        // machine can name the revision a pushed harness came from — the bundles are
        // content-addressed and say nothing about their origin on their own.
        ...(source === null ? {} : { source }),
        pushedAt: new Date().toISOString(),
      }));
      return true;
    } catch (err) {
      this.warn(`update not persisted (filesystem unavailable?): ${errMsg(err)}`);
      return false;
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
   * Store GC: keep the STORE_KEEP most recently written of each artifact, plus the one
   * harness.json references, which is kept whether or not recency would have. Best-effort;
   * ordered after the manifest flip so nothing referenced can be pruned. `platform`, `cli`,
   * `web` and the assets directories are independent subtrees (no shared file to piggyback a
   * sweep on), so each gets its own pass.
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
    const platformBundleRef = manifest.platform?.bundle.match(/([0-9a-f]+)\.mjs$/)?.[1] ?? null;
    await keepNewest(
      platformDir,
      (name) => /^([0-9a-f]+)\.mjs$/.exec(name)?.[1] ?? null,
      platformBundleRef,
      (sha) => fsp.rm(path.join(platformDir, `${sha}.mjs`), { force: true }),
    );

    const cliDir = path.join(this.storeDir, "cli");
    const cliRef = manifest.cli?.bundle.match(/([0-9a-f]+)\.mjs$/)?.[1] ?? null;
    await keepNewest(
      cliDir,
      (name) => /^([0-9a-f]+)\.mjs$/.exec(name)?.[1] ?? null,
      cliRef,
      (sha) => fsp.rm(path.join(cliDir, `${sha}.mjs`), { force: true }),
    );

    const webDir = path.join(this.storeDir, "web");
    const webRef = manifest.web?.manifest.match(/([0-9a-f]+)\.webz$/)?.[1] ?? null;
    await keepNewest(
      webDir,
      (name) => /^([0-9a-f]+)\.webz$/.exec(name)?.[1] ?? null,
      webRef,
      (sha) => fsp.rm(path.join(webDir, `${sha}.webz`), { force: true }),
    );

    // Pre-store pushes staged the platform bundle in `hmr/uploads/` before importing it
    // and then wrote a second copy into the store; nothing ever read the staged copy
    // again and no sweep covered that directory. Removing it here is one line in the
    // sweep that already owns disk reclamation, rather than a migration step.
    await fsp
      .rm(path.join(this.hmrDir, "uploads"), { recursive: true, force: true })
      .catch(() => undefined);

    // Assets are directories, not single files; otherwise the same keep-newest rule.
    const assetsRoot = path.join(this.storeDir, "assets");
    const assetsRef = manifest.assets?.dir.match(/([0-9a-f]+)$/)?.[1] ?? null;
    await keepNewest(
      assetsRoot,
      (name) => (/^[0-9a-f]+$/.test(name) ? name : null),
      assetsRef,
      (sha) => fsp.rm(path.join(assetsRoot, sha), { recursive: true, force: true }),
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

/**
 * Writes one content-addressed artifact. A file that already holds these exact bytes is left
 * untouched — the store is keyed by content hash, so re-pushing a version (an idempotent push, a
 * rollback to something installed before) otherwise rewrites the very file the committed manifest
 * points at, and a crash during that rewrite truncates a bundle the runtime still needs to boot.
 * Anything else is written to a temp file and renamed into place, so an interrupted write leaves
 * the store's previous state rather than a half-written artifact under a hash that promises
 * complete content.
 */
async function writeStoreFile(file: string, content: Buffer): Promise<void> {
  if (await sameFileContent(file, content)) return;
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    await fsp.writeFile(tmp, content, { flush: true });
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Whether `file` already holds exactly these bytes (missing/unreadable counts as no). */
async function sameFileContent(file: string, content: Buffer): Promise<boolean> {
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile() || stat.size !== content.length) return false;
    return (await fsp.readFile(file)).equals(content);
  } catch {
    return false;
  }
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

/** The hot-update host: the cross-generation resource registry and the current App. */
@Interface()
export abstract class Hmr {
  abstract resources: Resources;
  abstract ensure(): Promise<Opaque<"PlatformInstance", Awaited<ReturnType<HmrHost["ensure"]>>>>;
  abstract resolveWebSource(): Opaque<
    "WebSource",
    NonNullable<ReturnType<HmrHost["resolveWebSource"]>>
  > | null;
  abstract assetsDir(): string | null;
  abstract dispose(): void;
}
/** Compile-time proof the host satisfies the contract. */
export type _HmrCheck = HmrHost extends Hmr ? true : never;
