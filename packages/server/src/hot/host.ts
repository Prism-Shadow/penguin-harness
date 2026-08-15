/**
 * HotHost: the runtime side of the stop-the-world upgrade protocol (MVP).
 *
 * The host owns everything that must survive a platform swap: the resource
 * registry (live processes + their output buffers), the operation queue the
 * HTTP layer gates on, and the parked-document file on disk (crash safety:
 * the worst case of a failed swap is "old impl + parked doc, re-boot by
 * hand").
 *
 * Freeze semantics: requests arriving during a swap are ENQUEUED, not
 * rejected — the HTTP layer awaits waitIdle() and proceeds once the swap
 * completes, so a client never observes the stop-the-world window (it only
 * sees latency). Concurrent upgrade requests serialize on the same queue.
 *
 * Loading and compiling are decoupled capabilities:
 *
 * (a) LOAD — the fundamental interface: a single-file JS bundle
 *     (`bundlePath`) plus an OPTIONAL git specifier recorded as provenance.
 *     Needs nothing installed: no git, no compiler.
 * (b) COMPILE — source upgrades (`repo` + `revision`, TS or JS): check out
 *     the revision, compile the entry into ONE self-contained file in a
 *     compiler SUBPROCESS (esbuild, resolved from the package or PATH),
 *     incremental via a per-commit-sha output cache — then call (a).
 * (c) Both git and the compiler are optional system capabilities. Without a
 *     compiler, only (a) is usable (source upgrades fail with a pointer to
 *     it). Without git, (b) degrades to reading a local working tree with a
 *     "revision NOT verified" warning.
 *
 * Reload is strictly request-driven: nothing watches, nothing auto-triggers.
 *
 * Protocol (one straight line, see the proposal's MVP章节):
 *   enqueue → quiesce check → park (to disk) → strict parse / migrate → boot
 *   → drain queue. A blocked reconcile leaves the old instance untouched and
 *   returns the dropped/missing/invalid paths for the upper ladder rungs.
 */
import { execFile as execFileCb, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { AnyIface, AnyImpl, Instance, Json } from "@prismshadow/penguin-core/kernel";
import { boot, initialDoc, upgrade } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "./resources.js";
import type { PlatformApi } from "./platform-v1.js";
import { platformV1 } from "./platform-v1.js";
import { platformV2 } from "./platform-v2.js";

const execFile = promisify(execFileCb);

export interface PlatformBundle {
  id: string;
  iface: AnyIface;
  impl: AnyImpl;
}

export interface GitSource {
  /** Git specifier: anything `git clone` accepts (file:///home/abc/x.git, a plain path, …). */
  repo: string;
  /** Revision (commit sha, tag, branch); resolved to an exact sha when git is available. */
  revision: string;
}

export type UpgradeTarget =
  /** Built-in demo bundle (the /hot page buttons). */
  | { impl: string }
  /** Layer (a): a prebuilt single-file JS bundle + optional provenance. */
  | { bundlePath: string; source?: GitSource }
  /** Layer (b): source checkout + subprocess compile, then layer (a). */
  | GitSource;

export type CompileMode = "none" | "fresh" | "cached";

export type UpgradeOutcome =
  | {
      status: "ok";
      mode: "silent" | "migrated";
      impl: string;
      warnings: string[];
      compile: CompileMode;
      source: GitSource | null;
    }
  | {
      status: "blocked";
      dropped: string[];
      missing: string[];
      invalid: string[];
      warnings: string[];
    };

/** In-repo demo bundles; external distros arrive via bundlePath or git. */
const BUNDLES: Record<string, PlatformBundle> = {
  [platformV1.id]: platformV1,
  [platformV2.id]: platformV2,
};

/** Entry-point convention for a platform source repo, in probe order. */
const PLATFORM_ENTRIES = [
  "hot-platform.mjs",
  "hot-platform.ts",
  "hot-platform.js",
  "hot-platform.mts",
];

// Dev runs unbundled from src/hot/ (two levels above the package root's
// hot-assets/), the tsup build bundles into dist/index.js (one level): probe both.
const ASSETS_DIR = (() => {
  for (const rel of ["../hot-assets/", "../../hot-assets/"]) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error("hot-assets directory not found next to the server package");
})();

export interface HotHostOptions {
  /** Test seam: the git binary to invoke (default "git"). */
  gitBin?: string;
  /**
   * Test seam: the compiler executable. undefined → auto-detect (esbuild
   * package, then PATH); null → force "no compiler installed"; a string →
   * use that executable as-is.
   */
  compilerBin?: string | null;
}

interface Compiler {
  cmd: string;
  prefixArgs: string[];
}

interface LoadResult {
  bundle: PlatformBundle;
  warnings: string[];
  compile: CompileMode;
  source: GitSource | null;
  /** The single-file bundle on disk (for persistence); absent for built-in impls. */
  bundleFile?: string;
}

/**
 * The committed on-disk state: a runtime restart boots exactly this. The whole
 * promotion is one atomic rename of current.json — so a crash mid-write leaves
 * the previous committed state intact. Paths are relative to hotDir.
 */
interface Manifest {
  platform?: { bundle: string; park: string };
  web?: { dir: string };
}

export class HotHost {
  readonly resources = new HotResources();
  /**
   * Per-process credential for local agents (the hot-skill-authoring SKILL
   * teaches agents to read it from $PENGUIN_HOME/hot/api.json): presenting it
   * as a Bearer token is admin-equivalent for the hot APIs. File-permission
   * gated (0600), regenerated every boot — nothing to persist or rotate.
   */
  readonly apiToken = crypto.randomBytes(32).toString("hex");

  private instance: Instance<PlatformApi> | null = null;
  private implId = platformV1.id;
  private readonly hotDir: string;
  private readonly storeDir: string;
  private readonly manifestPath: string;
  private restored = false;
  private readonly gitBin: string;
  private readonly compilerOption: string | null | undefined;
  private compilerMemo: Compiler | null | undefined;
  /** The freeze, as a queue: everything the HTTP layer gates on chains here. */
  private opQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly root: string,
    options: HotHostOptions = {},
  ) {
    this.hotDir = path.join(root, "hot");
    this.storeDir = path.join(this.hotDir, "store");
    this.manifestPath = path.join(this.hotDir, "current.json");
    this.gitBin = options.gitBin ?? "git";
    this.compilerOption = options.compilerBin;
  }

  private warn(msg: string): void {
    process.stderr.write(`[hot] ${msg}\n`);
  }

  currentImplId(): string {
    return this.implId;
  }

  /** Which optional system capabilities are present (surfaced to clients). */
  capabilities(): { git: boolean; compiler: boolean } {
    return { git: this.hasGit(), compiler: this.resolveCompiler() !== null };
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
   * present (a restart continues the pushed code and its parked state);
   * otherwise boots the packaged platform v1 with a fresh document.
   */
  async ensure(): Promise<Instance<PlatformApi>> {
    if (this.instance === null) {
      await this.restore();
      if (this.instance === null) {
        const bundle = platformV1;
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
   * Resume from current.json (once). Sets webDistDir and boots the persisted
   * platform bundle with its committed parked doc. Any failure (missing or
   * corrupt artifact, incompatible bundle) is non-fatal: it warns and leaves
   * the runtime to boot the packaged default — a bad persisted state must
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
    if (manifest.web?.dir !== undefined) {
      const dir = path.join(this.hotDir, manifest.web.dir);
      if (fs.existsSync(path.join(dir, "index.html"))) this.webDistDir = dir;
      else this.warn(`persisted web dist missing (${manifest.web.dir}); using packaged assets`);
    }
    if (manifest.platform !== undefined) {
      try {
        const bundle = await this.importBundleFile(
          path.join(this.hotDir, manifest.platform.bundle),
        );
        const doc = JSON.parse(
          await fsp.readFile(path.join(this.hotDir, manifest.platform.park), "utf8"),
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

  /**
   * Commit protocol: content-address the bundle + its committed parked doc
   * into the store, then flip current.json atomically (write-temp + rename on
   * the same filesystem). Called ONLY after the live boot already succeeded,
   * so a restart can never resume a bundle that failed to boot. Best-effort:
   * a read-only filesystem downgrades to in-memory-only (the live swap still
   * happened) with a warning.
   */
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

  private async persistWeb(distDir: string): Promise<void> {
    try {
      const rel = path.relative(this.hotDir, distDir).split(path.sep).join("/");
      await this.commitManifest((m) => ({ ...m, web: { dir: rel } }));
    } catch (err) {
      this.warn(`web update not persisted (filesystem unavailable?): ${errMsg(err)}`);
    }
  }

  /** Reads, updates, and atomically replaces current.json (the single commit point). */
  private async commitManifest(update: (m: Manifest) => Manifest): Promise<void> {
    await fsp.mkdir(this.hotDir, { recursive: true });
    let current: Manifest = {};
    try {
      current = JSON.parse(await fsp.readFile(this.manifestPath, "utf8")) as Manifest;
    } catch {
      // no manifest yet
    }
    const tmp = `${this.manifestPath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(update(current), null, 2));
    // Atomic within the same directory/filesystem (libuv maps this to
    // MoveFileEx REPLACE_EXISTING on Windows, rename(2) on POSIX).
    await fsp.rename(tmp, this.manifestPath);
  }

  /**
   * MVP quiesce check: the demo tree has no long-running turns, so this is a
   * constant. The real platform's check ("agent turn in flight → refuse or
   * ask") plugs in here.
   */
  private hasActiveWork(): boolean {
    return false;
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
    if (this.hasActiveWork()) {
      return {
        status: "blocked",
        dropped: [],
        missing: [],
        invalid: ["platform has active work; retry when idle"],
        warnings: [],
      };
    }
    const loaded = await this.loadBundle(target);

    // Park to disk before touching anything: crash-safe by construction.
    await fsp.mkdir(this.hotDir, { recursive: true });
    const parkPath = path.join(this.hotDir, "platform.park.json");
    await fsp.writeFile(parkPath, JSON.stringify(current.park(), null, 2));

    const result = await upgrade({
      current,
      impl: loaded.bundle.impl,
      iface: loaded.bundle.iface,
      resources: this.resources,
    });
    if (result.status === "blocked") {
      // Old instance untouched; the doc + path lists are the input for the
      // auto-upgrader / agent / human rungs (outside the MVP kernel).
      return {
        status: "blocked",
        dropped: result.dropped,
        missing: result.missing,
        invalid: result.invalid,
        warnings: loaded.warnings,
      };
    }
    this.instance = result.instance as Instance<PlatformApi>;
    this.implId = loaded.bundle.id;
    await fsp.writeFile(parkPath, JSON.stringify(result.doc, null, 2));
    // Commit AFTER the live boot succeeded: a restart resumes only validated code.
    if (loaded.bundleFile !== undefined) await this.persistPlatform(loaded.bundleFile, result.doc);
    return {
      status: "ok",
      mode: result.mode,
      impl: loaded.bundle.id,
      warnings: loaded.warnings,
      compile: loaded.compile,
      source: loaded.source,
    };
  }

  private async loadBundle(target: UpgradeTarget): Promise<LoadResult> {
    if ("impl" in target) {
      const bundle = BUNDLES[target.impl];
      if (bundle === undefined) throw new Error(`unknown platform impl '${target.impl}'`);
      return { bundle, warnings: [], compile: "none", source: null };
    }
    if ("bundlePath" in target) {
      // Layer (a): the fundamental interface. No git, no compiler — just a
      // single JS file; the git specifier, when given, is provenance only.
      return {
        bundle: await this.importBundleFile(target.bundlePath),
        warnings: [],
        compile: "none",
        source: target.source ?? null,
        bundleFile: target.bundlePath,
      };
    }
    return this.loadFromSource(target.repo, target.revision);
  }

  /**
   * Layer (b): checkout + subprocess compile, then layer (a). Incremental:
   * output files are keyed by the exact commit sha, so re-upgrading to a
   * revision that was already compiled skips the compiler entirely.
   */
  private async loadFromSource(repo: string, revision: string): Promise<LoadResult> {
    if (this.resolveCompiler() === null) {
      throw new Error(
        "no JS/TS compiler is available on this system (esbuild not installed); " +
          "source upgrades need one — provide a prebuilt single-file bundle (bundlePath) instead",
      );
    }

    const warnings: string[] = [];
    let srcDir: string;
    let exactSha: string | null = null;
    if (this.hasGit()) {
      srcDir = await this.checkout(repo, revision);
      exactSha = (await this.git(["-C", srcDir, "rev-parse", "HEAD"])).trim();
    } else {
      warnings.push(
        `git is not installed; reading '${repo}' as a local working tree — revision '${revision}' is NOT verified`,
      );
      srcDir = repo.startsWith("file://") ? fileURLToPath(repo) : repo;
      if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
        throw new Error(
          `without git only a local working-tree directory can be loaded; '${repo}' is not one (bare .git repositories need git)`,
        );
      }
    }

    const outfile = path.join(
      this.hotDir,
      "build",
      `platform-${sanitize(exactSha ?? revision)}.mjs`,
    );
    // Incremental cache only when the key is an exact, verified commit sha —
    // a working-tree fallback has no stable identity and always recompiles.
    let compile: CompileMode;
    if (exactSha !== null && fs.existsSync(outfile)) {
      compile = "cached";
    } else {
      const entry = findPlatformEntry(srcDir);
      await this.compileSingleFile(entry, outfile);
      compile = "fresh";
    }

    return {
      bundle: await this.importBundleFile(outfile),
      warnings,
      compile,
      source: { repo, revision: exactSha ?? revision },
      bundleFile: outfile,
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
   * Compile in a SUBPROCESS (the compiler is a system capability, not a
   * library dependency): one entry → one self-contained file. The repo may
   * import the kernel as a bare specifier; it is aliased to the host's copy
   * and BUNDLED IN (kernel objects are pure data + closures, so a private
   * copy interoperates with the host kernel).
   */
  private async compileSingleFile(entry: string, outfile: string): Promise<void> {
    const compiler = this.resolveCompiler()!;
    await fsp.mkdir(path.dirname(outfile), { recursive: true });
    const kernelPath = createRequire(import.meta.url).resolve("@prismshadow/penguin-core/kernel");
    try {
      await execFile(compiler.cmd, [
        ...compiler.prefixArgs,
        entry,
        "--bundle",
        "--format=esm",
        "--platform=node",
        `--outfile=${outfile}`,
        "--log-level=silent",
        `--alias:@prismshadow/penguin-core/kernel=${kernelPath}`,
      ]);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr?.trim();
      throw new Error(`compile failed for '${entry}'${stderr ? `: ${stderr}` : ""}`);
    }
  }

  /** esbuild from the package (run under node) or from PATH; memoized. */
  private resolveCompiler(): Compiler | null {
    if (this.compilerMemo !== undefined) return this.compilerMemo;
    let found: Compiler | null = null;
    if (this.compilerOption === null) {
      found = null;
    } else if (typeof this.compilerOption === "string") {
      found = { cmd: this.compilerOption, prefixArgs: [] };
    } else {
      try {
        // Executed directly: depending on the package manager this resolves
        // to the native binary (pnpm links it) or a shebanged JS shim — both
        // are directly executable; running it under node would break on the
        // native-binary case.
        const script = createRequire(import.meta.url).resolve("esbuild/bin/esbuild");
        found = { cmd: script, prefixArgs: [] };
      } catch {
        try {
          if (spawnSync("esbuild", ["--version"], { stdio: "ignore" }).status === 0) {
            found = { cmd: "esbuild", prefixArgs: [] };
          }
        } catch {
          found = null;
        }
      }
    }
    this.compilerMemo = found;
    return found;
  }

  private hasGit(): boolean {
    try {
      return spawnSync(this.gitBin, ["--version"], { stdio: "ignore" }).status === 0;
    } catch {
      return false;
    }
  }

  private async git(args: string[]): Promise<string> {
    try {
      const { stdout } = await execFile(this.gitBin, args);
      return stdout;
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr?.trim();
      throw new Error(`git ${args[0]} failed${stderr ? `: ${stderr}` : ""}`);
    }
  }

  private async checkout(repo: string, revision: string): Promise<string> {
    const dir = path.join(this.hotDir, "checkouts", sanitize(revision));
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.mkdir(dir, { recursive: true });
    await this.git(["clone", "--quiet", repo, dir]);
    await this.git(["-C", dir, "checkout", "--quiet", "--detach", revision]);
    return dir;
  }

  // -- Web platform (the frontend package's built dist) ---------------------

  /**
   * Overrides the directory the server's static hosting serves (null → the
   * configured webDist). Runtime-level pointer, not parked: the pushed dist
   * lives on disk, and a restart falls back to the packaged assets.
   */
  webDistDir: string | null = null;

  /**
   * Materializes an inline platform bundle (the single-file ESM sent in the
   * request body) to disk and returns its path. This is how a push reaches a
   * runtime over HTTP alone — no shared filesystem, no scp: the bytes travel
   * in the request, the server writes them, then loads by path.
   */
  async writeInlineBundle(content: string): Promise<string> {
    const dir = path.join(this.hotDir, "uploads");
    await fsp.mkdir(dir, { recursive: true });
    const file = path.join(dir, `platform-${sha1(content).slice(0, 16)}.mjs`);
    await fsp.writeFile(file, content, "utf8");
    return file;
  }

  /**
   * Materializes an inline web dist (a { relPath: base64 } manifest sent in
   * the request body) to a fresh directory and returns its path. Same story
   * as writeInlineBundle: the assets travel over HTTP, not a shared disk.
   * Paths are validated to stay within the target directory.
   */
  async writeInlineWebDist(files: Record<string, string>): Promise<string> {
    const hash = crypto.createHash("sha1");
    for (const rel of Object.keys(files).sort()) hash.update(rel).update("\0").update(files[rel]!);
    // Under the store (content-addressed): the committed dir is persisted in
    // place, so restore just points webDistDir back at it.
    const dir = path.join(this.storeDir, "web", hash.digest("hex").slice(0, 16));
    await fsp.rm(dir, { recursive: true, force: true });
    for (const [rel, b64] of Object.entries(files)) {
      const target = path.resolve(dir, rel);
      if (target !== dir && !target.startsWith(dir + path.sep)) {
        throw new Error(`unsafe path in web dist manifest: ${rel}`);
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, Buffer.from(b64, "base64"));
    }
    if (!fs.existsSync(path.join(dir, "index.html"))) {
      throw new Error("web dist manifest has no index.html");
    }
    return dir;
  }

  /**
   * Inline web push: materialize the manifest under the store, serve it, and
   * commit it (so a restart resumes it). The commit is the same atomic
   * manifest flip as the platform side.
   */
  async installInlineWebDist(
    files: Record<string, string>,
  ): Promise<{ dist: string; rev: string }> {
    const dir = await this.writeInlineWebDist(files);
    const info = this.setWebDist(dir);
    await this.persistWeb(dir);
    return info;
  }

  /** Points static hosting at a freshly pushed web dist; returns its content rev. */
  setWebDist(distPath: string): { dist: string; rev: string } {
    const dist = path.resolve(distPath);
    const index = path.join(dist, "index.html");
    if (!fs.existsSync(index)) {
      throw new Error(`'${distPath}' is not a web dist (no index.html)`);
    }
    this.webDistDir = dist;
    return { dist, rev: sha1(fs.readFileSync(index, "utf8")).slice(0, 12) };
  }

  /**
   * Publishes the local-agent credential file ($PENGUIN_HOME/hot/api.json,
   * mode 0600): agents on this machine read { url, token } from it to call
   * the hot APIs. Called once the HTTP listener is up (index.ts).
   */
  async writeApiFile(url: string): Promise<void> {
    await fsp.mkdir(this.hotDir, { recursive: true });
    await fsp.writeFile(
      path.join(this.hotDir, "api.json"),
      JSON.stringify({ url, token: this.apiToken }, null, 2),
      { mode: 0o600 },
    );
  }

  /** Agent modules resolve from the in-repo asset dir (the gist stand-in). */
  resolveAgentModule(key: string): string {
    if (!/^[a-z0-9.-]+$/.test(key)) throw new Error(`invalid agent module key '${key}'`);
    const file = path.join(ASSETS_DIR, `${key}.mjs`);
    if (!fs.existsSync(file)) throw new Error(`unknown agent module '${key}'`);
    return pathToFileURL(file).href;
  }

  /** Process-exit sweep only; never part of an upgrade. */
  dispose(): void {
    this.instance?.dispose();
    this.instance = null;
    this.resources.disposeAll();
  }
}

function findPlatformEntry(dir: string): string {
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        penguin?: { hotEntry?: string };
      };
      if (pkg.penguin?.hotEntry !== undefined) {
        const entry = path.join(dir, pkg.penguin.hotEntry);
        if (fs.existsSync(entry)) return entry;
        throw new Error(`package.json penguin.hotEntry '${pkg.penguin.hotEntry}' does not exist`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("hotEntry")) throw err;
      // Unparseable package.json: fall through to the filename convention.
    }
  }
  for (const name of PLATFORM_ENTRIES) {
    const entry = path.join(dir, name);
    if (fs.existsSync(entry)) return entry;
  }
  throw new Error(
    `no platform entry found in '${dir}' (expected package.json penguin.hotEntry or one of ${PLATFORM_ENTRIES.join(", ")})`,
  );
}

function sanitize(revision: string): string {
  return /^[0-9A-Za-z._-]+$/.test(revision) ? revision : sha1(revision).slice(0, 12);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sha1(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}
