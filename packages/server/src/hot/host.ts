/**
 * HotHost: the runtime side of the stop-the-world upgrade protocol (MVP).
 *
 * The host owns everything that must survive a platform swap: the resource
 * registry (live processes + their output buffers), the freeze flag the HTTP
 * layer consults, and the parked-document file on disk (crash safety: the
 * worst case of a failed swap is "old impl + parked doc, re-boot by hand").
 *
 * Protocol (one straight line, see the proposal's MVP章节):
 *   freeze → quiesce check → park (to disk) → strict parse / migrate → boot
 *   → unfreeze. A blocked reconcile leaves the old instance untouched and
 *   returns the dropped/missing/invalid paths for the upper ladder rungs.
 */
import crypto from "node:crypto";
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

export type UpgradeOutcome =
  | { status: "ok"; mode: "silent" | "migrated"; impl: string }
  | { status: "blocked"; dropped: string[]; missing: string[]; invalid: string[] }
  | { status: "busy" };

/** In-repo distro registry; a downloaded platform.tar.gz would land here as a modulePath. */
const BUNDLES: Record<string, PlatformBundle> = {
  [platformV1.id]: platformV1,
  [platformV2.id]: platformV2,
};

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

export class HotHost {
  readonly resources = new HotResources();
  /** While true the HTTP layer answers 503 for hot APIs (stop-the-world window). */
  frozen = false;

  private instance: Instance<PlatformApi> | null = null;
  private implId = platformV1.id;
  private uiVersion: UiPanelVersion = "v1";
  private readonly parkDir: string;

  constructor(private readonly root: string) {
    this.parkDir = path.join(root, "hot");
  }

  currentImplId(): string {
    return this.implId;
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

  async upgradeTo(target: string | { modulePath: string }): Promise<UpgradeOutcome> {
    if (this.frozen) return { status: "busy" };
    const current = await this.ensure();
    this.frozen = true;
    try {
      if (this.hasActiveWork()) return { status: "busy" };
      const bundle = await this.loadBundle(target);
      // Park to disk before touching anything: crash-safe by construction.
      await fsp.mkdir(this.parkDir, { recursive: true });
      const parkPath = path.join(this.parkDir, "platform.park.json");
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
        };
      }
      this.instance = result.instance as Instance<PlatformApi>;
      this.implId = bundle.id;
      await fsp.writeFile(parkPath, JSON.stringify(result.doc, null, 2));
      return { status: "ok", mode: result.mode, impl: bundle.id };
    } finally {
      this.frozen = false;
    }
  }

  private async loadBundle(target: string | { modulePath: string }): Promise<PlatformBundle> {
    if (typeof target === "string") {
      const bundle = BUNDLES[target];
      if (bundle === undefined) throw new Error(`unknown platform impl '${target}'`);
      return bundle;
    }
    // True hot code loading: a self-contained platform module (the
    // platform.tar.gz story in miniature). Cache-busting query so a rebuilt
    // file is re-imported; the superseded module instance is leaked by design
    // (rare event, bounded cost — see the proposal).
    const url = `${pathToFileURL(path.resolve(target.modulePath)).href}?v=${Date.now()}`;
    const mod = (await import(url)) as { hotPlatform?: PlatformBundle };
    if (mod.hotPlatform === undefined) {
      throw new Error(`${target.modulePath} does not export 'hotPlatform'`);
    }
    return mod.hotPlatform;
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

function sha1(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}
