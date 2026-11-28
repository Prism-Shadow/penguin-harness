/**
 * Runs before every test file: names the server's own package as the plugin library's host, as
 * the platform does at boot (hmr/platform.ts) — so a test that reads the library without booting
 * an App reads the one the server ships, and one that pointed the library elsewhere does not
 * leave the next file reading a fixture (this suite does not isolate modules between files).
 *
 * The name has to reach every copy of core the run holds. This file is part of the run's own
 * module graph, where core sits as the symlinked workspace package; the plugin domain library
 * ships to the server as an injected snapshot (a file: copy under .pnpm), which the run
 * externalizes, so its dist — and the core copy inside that snapshot — is loaded by the raw
 * Node loader, a second module registry whose state the graph's copy cannot see. The snapshot
 * ships a copy of every workspace package it depends on, so the loader walks to the copy
 * beneath the plugin package and that is where `useLibraryHost` has to be named again. The
 * resolution below walks from the plugin package's own directory, the same walk its dist's
 * import performs, so the copy this file names is the copy the library reads.
 */
import {
  useInstalledPluginPrefix,
  useLibraryHost,
  usePushedPluginLibrary,
} from "@prismshadow/penguin-core";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { serverPackageDir } from "../../src/plugin/library-host.js";

const host = serverPackageDir();

usePushedPluginLibrary(null);
useInstalledPluginPrefix(null);
useLibraryHost(host);

// The Node loader's copy, inside the plugin domain snapshot (see above). The require form is
// used because this file belongs to the run's module graph: an `import` here would resolve
// through the graph again and reach the same copy the line above named. Node loads ESM
// modules through require since 22.12, so this works on the run's Node without flags.
// The copy is required by its absolute dist path, not by its package name: core's exports
// map carries no `require` condition, so a named require throws ERR_PACKAGE_PATH_NOT_EXPORTED
// before Node reads any file, while an absolute file path bypasses the exports map entirely.
// dist/index.js is the file the map's "." import condition points at, so requiring it lands
// on the same module instance the snapshot's dist import resolves to.
try {
  const requireOf = createRequire(import.meta.url);
  const pluginPackageJson = requireOf.resolve("@prismshadow/penguin-library-plugin/package.json");
  const snapshotRequire = createRequire(pluginPackageJson);
  const nodeCopy = snapshotRequire(
    join(dirname(pluginPackageJson), "..", "penguin-core", "dist", "index.js"),
  ) as {
    usePushedPluginLibrary(dir: string | null): void;
    useInstalledPluginPrefix(prefix: string | null): void;
    useLibraryHost(dir: string | null): void;
  };
  nodeCopy.usePushedPluginLibrary(null);
  nodeCopy.useInstalledPluginPrefix(null);
  nodeCopy.useLibraryHost(host);
} catch {
  // No snapshot beside the server (an install whose plugin domain is a symlink, a future
  // install layout): the graph's copy is then the only one, and it is already named.
}
