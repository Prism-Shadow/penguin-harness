/**
 * How the platform gets hold of node-pty.
 *
 * node-pty is a native module, and a pushed platform bundle cannot carry one: the bundle
 * is imported from `<dataRoot>/hmr/store/platform/<sha>.mjs`, where neither node-pty's own
 * relative `build/Release/pty.node` nor a bare `require("node-pty")` resolves (verified —
 * the binding fails with "Failed to load native module: pty.node"). So the binary travels
 * as a push ASSET (see hmr/host.ts's UpgradeAssets) and is loaded from the directory the
 * runtime publishes through the resource registry.
 *
 * Order matters: the runtime's own copy is tried FIRST when this code runs as part of the
 * packaged server, because that binary is built for the machine it is running on. A pushed
 * asset comes from whatever machine ran the deploy, so it is the fallback — right for the
 * hot path it exists to serve, but never allowed to displace a known-good local build.
 */
import { createRequire } from "node:module";
import path from "node:path";

/** The slice of node-pty this package uses (kept narrow so the fallback stays checkable). */
export interface NodePty {
  spawn(
    file: string,
    args: string[] | string,
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ): import("node-pty").IPty;
}

let cached: NodePty | null = null;

/**
 * Resolves node-pty once per platform instance. `resources` comes from the kernel's node
 * context; a runtime that published no assets simply leaves the fallback unused.
 */
export function loadNodePty(assets?: () => string | null): NodePty {
  if (cached !== null) return cached;

  const attempts: Array<() => NodePty> = [
    // Packaged server: this module is part of the runtime's own graph.
    () => createRequire(import.meta.url)("node-pty") as NodePty,
    // Pushed bundle: the binary rides along as an asset, laid out as a real package dir —
    // located through the hmr capability's declared assetsDir(), not a registry key.
    () => {
      const dir = assets?.() ?? null;
      if (dir === null) throw new Error("no assets directory available");
      // A require anchored inside the assets dir resolves `node_modules/node-pty` there,
      // which lets node-pty's own relative loader find its binary as it normally would.
      return createRequire(path.join(dir, "index.mjs"))("node-pty") as NodePty;
    },
  ];

  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      cached = attempt();
      return cached;
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`node-pty is unavailable to the platform: ${failures.join(" / ")}`);
}
