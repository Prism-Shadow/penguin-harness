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
 * Order matters, and it runs from the copy built for this machine to the copy built
 * elsewhere:
 *
 * 1. This module's own graph — the packaged server, whose node-pty was installed with it.
 * 2. The PROGRAM this process was started from (`process.argv[1]`): a pushed platform runs
 *    inside an installed release (`<program>/lib/dist/penguin-hmr.js`), and that release's
 *    `lib/node_modules/node-pty` was published for this machine's own platform. This is
 *    what makes a build pushed from another kind of machine — a Mac installing on Linux, an
 *    x64 box installing on arm64 — open terminals at all.
 * 3. The pushed asset. It comes from whatever machine ran the deploy, so it carries that
 *    machine's binding (and node-pty's darwin and win32 prebuilds): right for the hot path
 *    it exists to serve, never allowed to displace a copy built for this machine.
 *
 * node-pty's own loader tries `build/Release`, `build/Debug`, then `prebuilds/<platform>-
 * <arch>`, so a copy without a binding for this machine fails at require time and the next
 * one is asked. When none loads, the error says so in one sentence before the details.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { unpackedAssetsDir } from "../hmr/asset-archives.js";

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

/** One place node-pty may be required from, and what to call it in an error. */
export interface NodePtySource {
  label: string;
  /** A require anchored where that copy resolves; throws when there is no such anchor. */
  require: () => NodeJS.Require;
}

/** The copy that loaded: the module, and the package directory it was loaded from. */
export interface LoadedNodePty {
  pty: NodePty;
  dir: string;
}

let cached: LoadedNodePty | null = null;

/**
 * The sources a platform instance tries, in order (see the module doc). `assets` comes from
 * the hmr capability; `argv1` is the process entry.
 */
export function nodePtySources(
  assets?: () => string | null,
  argv1: string | undefined = process.argv[1],
): NodePtySource[] {
  return [
    // Packaged server: this module is part of the runtime's own graph.
    { label: "this server's own", require: () => createRequire(import.meta.url) },
    // The installed program a pushed platform runs inside: its node-pty is this machine's.
    {
      label: "the installed program's",
      require: () => {
        if (argv1 === undefined || !path.isAbsolute(argv1)) {
          throw new Error("no program entry to resolve from");
        }
        return createRequire(argv1);
      },
    },
    // Pushed bundle: the binary rides along as an asset, laid out as a real package dir —
    // located through the hmr capability's declared assetsDir(), not a registry key.
    {
      label: "the pushed build's",
      require: () => {
        const pushed = assets?.() ?? null;
        if (pushed === null) throw new Error("no assets directory available");
        // A push carries node-pty as an archive; it is unpacked before it is required. A
        // require anchored inside the assets dir resolves `node_modules/node-pty` there,
        // which lets node-pty's own relative loader find its binary as it normally would.
        return createRequire(path.join(unpackedAssetsDir(pushed), "index.mjs"));
      },
    },
  ];
}

/**
 * The first source whose node-pty loads on this machine, with where it came from. Throws
 * one plain sentence, then what each source said, when none does.
 */
export function loadNodePtyFrom(
  sources: readonly NodePtySource[],
  where: string = `${process.platform}-${process.arch}`,
): LoadedNodePty {
  const failures: string[] = [];
  for (const source of sources) {
    try {
      const req = source.require();
      const dir = path.dirname(req.resolve("node-pty/package.json"));
      return { pty: req("node-pty") as NodePty, dir };
    } catch (err) {
      const said = (err instanceof Error ? err.message : String(err)).split("\n")[0]!;
      failures.push(`${source.label}: ${said}`);
    }
  }
  throw new Error(
    `Terminals cannot start on this machine: no copy of node-pty here loads on ${where}. ` +
      `(${failures.join(" / ")})`,
  );
}

/**
 * Resolves node-pty once per platform instance. `assets` comes from the kernel's node
 * context; a runtime that published no assets simply leaves that source unused.
 */
export function loadNodePty(assets?: () => string | null): NodePty {
  cached ??= loadNodePtyFrom(nodePtySources(assets));
  return cached.pty;
}

/** The package directory the loaded node-pty came from; null before the first load. */
export function loadedNodePtyDir(): string | null {
  return cached?.dir ?? null;
}
