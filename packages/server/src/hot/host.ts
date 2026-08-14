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
 * Reload is strictly request-driven: nothing watches, nothing auto-triggers.
 * The canonical upgrade descriptor is a git specifier + revision
 * (e.g. file:///home/abc/x.git + deadbeef): on request the revision is
 * checked out, COMPILED INTO A SINGLE self-contained module file (esbuild,
 * kernel bundled in), imported with a cache-busting query, and swapped in.
 * When git is not installed the host falls back to reading a local working
 * tree and surfaces a warning (the revision is then unverified).
 *
 * Protocol (one straight line, see the proposal's MVP章节):
 *   enqueue → quiesce check → park (to disk) → strict parse / migrate → boot
 *   → drain queue. A blocked reconcile leaves the old instance untouched and
 *   returns the dropped/missing/invalid paths for the upper ladder rungs.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AnyIface, AnyImpl, Instance } from "@prismshadow/penguin-core/kernel";
import { boot, initialDoc, upgrade } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "./resources.js";
import type { PlatformApi } from "./platform-v1.js";
import { platformV1 } from "./platform-v1.js";
import { platformV2 } from "./platform-v2.js";

export interface PlatformBundle {
  id: string;
  iface: AnyIface;
  impl: AnyImpl;
}

export type UpgradeTarget =
  | { impl: string }
  | {
      /** Git specifier: anything `git clone` accepts (file:///home/abc/x.git, a plain path, …). */
      repo: string;
      /** Revision to check out (commit sha, tag, branch). */
      revision: string;
    };

export type UpgradeOutcome =
  | { status: "ok"; mode: "silent" | "migrated"; impl: string; warnings: string[] }
  | {
      status: "blocked";
      dropped: string[];
      missing: string[];
      invalid: string[];
      warnings: string[];
    };

/** In-repo demo bundles (the /hot page buttons); external distros arrive via git. */
const BUNDLES: Record<string, PlatformBundle> = {
  [platformV1.id]: platformV1,
  [platformV2.id]: platformV2,
};

/** Entry-point convention for a platform repo, in probe order. */
const PLATFORM_ENTRIES = ["hot-platform.mjs", "hot-platform.ts", "hot-platform.js"];

/** Demo UI panel versions served to the web platform host (packages/server/hot-assets/). */
const UI_PANEL_VERSIONS = ["v1", "v2"] as const;
type UiPanelVersion = (typeof UI_PANEL_VERSIONS)[number];

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
}

export class HotHost {
  readonly resources = new HotResources();

  private instance: Instance<PlatformApi> | null = null;
  private implId = platformV1.id;
  private uiVersion: UiPanelVersion = "v1";
  private readonly hotDir: string;
  private readonly gitBin: string;
  /** The freeze, as a queue: everything the HTTP layer gates on chains here. */
  private opQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly root: string,
    options: HotHostOptions = {},
  ) {
    this.hotDir = path.join(root, "hot");
    this.gitBin = options.gitBin ?? "git";
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

  /** Lazy first boot: platform v1 with a fresh document. */
  async ensure(): Promise<Instance<PlatformApi>> {
    if (this.instance === null) {
      const bundle = platformV1;
      this.instance = (await boot(
        bundle.impl,
        bundle.iface,
        initialDoc(bundle.iface, { motd: "hello from the penguin hot platform" }),
        this.resources,
      )) as Instance<PlatformApi>;
    }
    return this.instance;
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
    const { bundle, warnings } = await this.loadBundle(target);

    // Park to disk before touching anything: crash-safe by construction.
    await fsp.mkdir(this.hotDir, { recursive: true });
    const parkPath = path.join(this.hotDir, "platform.park.json");
    await fsp.writeFile(parkPath, JSON.stringify(current.park(), null, 2));

    const result = await upgrade({
      current,
      impl: bundle.impl,
      iface: bundle.iface,
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
        warnings,
      };
    }
    this.instance = result.instance as Instance<PlatformApi>;
    this.implId = bundle.id;
    await fsp.writeFile(parkPath, JSON.stringify(result.doc, null, 2));
    return { status: "ok", mode: result.mode, impl: bundle.id, warnings };
  }

  private async loadBundle(
    target: UpgradeTarget,
  ): Promise<{ bundle: PlatformBundle; warnings: string[] }> {
    if ("impl" in target) {
      const bundle = BUNDLES[target.impl];
      if (bundle === undefined) throw new Error(`unknown platform impl '${target.impl}'`);
      return { bundle, warnings: [] };
    }
    return this.loadBundleFromGit(target.repo, target.revision);
  }

  /**
   * The canonical descriptor path: check out repo@revision (or fall back to a
   * local working tree with a warning when git is missing), compile the entry
   * into ONE self-contained module file (kernel bundled in — the output has
   * zero bare imports beyond node builtins), then import it cache-busted.
   */
  private async loadBundleFromGit(
    repo: string,
    revision: string,
  ): Promise<{ bundle: PlatformBundle; warnings: string[] }> {
    const warnings: string[] = [];
    let srcDir: string;
    if (this.hasGit()) {
      srcDir = this.checkout(repo, revision);
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

    const entry = findPlatformEntry(srcDir);
    const outfile = path.join(this.hotDir, "build", `platform-${sanitize(revision)}.mjs`);
    await fsp.mkdir(path.dirname(outfile), { recursive: true });
    // Compiled ONLY on request (no watcher anywhere): one entry → one file.
    const esbuild = await import("esbuild");
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile,
      logLevel: "silent",
      // The repo may import the kernel as a bare specifier; resolve it to the
      // host's own copy so checkouts outside the workspace still build. It is
      // then BUNDLED IN (not external): kernel objects are pure data +
      // closures, so a private copy interoperates with the host kernel.
      // createRequire (not import.meta.resolve): available under both Node
      // and vitest's transform, and honors the package's exports map.
      alias: {
        "@prismshadow/penguin-core/kernel": createRequire(import.meta.url).resolve(
          "@prismshadow/penguin-core/kernel",
        ),
      },
    });

    const url = `${pathToFileURL(outfile).href}?v=${Date.now()}`;
    const mod = (await import(url)) as { hotPlatform?: PlatformBundle };
    if (mod.hotPlatform === undefined) {
      throw new Error(`${entry} does not export 'hotPlatform'`);
    }
    return { bundle: mod.hotPlatform, warnings };
  }

  private hasGit(): boolean {
    try {
      return spawnSync(this.gitBin, ["--version"], { stdio: "ignore" }).status === 0;
    } catch {
      return false;
    }
  }

  private checkout(repo: string, revision: string): string {
    const dir = path.join(this.hotDir, "checkouts", sanitize(revision));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const clone = spawnSync(this.gitBin, ["clone", "--quiet", repo, dir], { encoding: "utf8" });
    if (clone.status !== 0) {
      throw new Error(`git clone failed for '${repo}': ${clone.stderr?.trim()}`);
    }
    const checkout = spawnSync(
      this.gitBin,
      ["-C", dir, "checkout", "--quiet", "--detach", revision],
      { encoding: "utf8" },
    );
    if (checkout.status !== 0) {
      throw new Error(`git checkout '${revision}' failed: ${checkout.stderr?.trim()}`);
    }
    return dir;
  }

  // -- Demo UI panel (the web platform bundle in miniature) -----------------

  uiManifest(): { version: string; rev: string } {
    const content = this.readUiPanel().content;
    return { version: this.uiVersion, rev: sha1(content).slice(0, 12) };
  }

  readUiPanel(): { content: string; rev: string } {
    const content = fs.readFileSync(path.join(ASSETS_DIR, `panel.${this.uiVersion}.mjs`), "utf8");
    return { content, rev: sha1(content).slice(0, 12) };
  }

  activateUiPanel(version: string): { version: string; rev: string } {
    if (!UI_PANEL_VERSIONS.includes(version as UiPanelVersion)) {
      throw new Error(`unknown ui panel version '${version}'`);
    }
    this.uiVersion = version as UiPanelVersion;
    return this.uiManifest();
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

function sha1(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}
