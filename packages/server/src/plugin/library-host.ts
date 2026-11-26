/**
 * The server's own package, as the plugin library's host: its `dependencies` name the plugin
 * packages this build ships (core plugin/library-host.ts). Named at boot, so a checkout, the
 * npm package and a test all read the library the server was installed with.
 *
 * The implementation lives in the plugin domain package and finds the host from the directory
 * a caller hands it — the nearest package.json above that directory, when it is the server's.
 * The caller is this module, and this module sits inside the server package, so its own
 * location is the right starting point in a checkout and in the npm package alike. Where the
 * server is bundled into something else (the desktop app's single server bundle, a hot push's
 * platform bundle in the data root) there is no such package above it, and nothing is named:
 * the library is then the pushed copy, or the bundling package's own.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serverPackageDir as serverPackageDirAbove } from "@prismshadow/penguin-library-plugin/library-host";

export * from "@prismshadow/penguin-library-plugin/library-host";

/** The directory of the server package this module belongs to, or null when it is bundled into another. */
export function serverPackageDir(): string | null {
  return serverPackageDirAbove(path.dirname(fileURLToPath(import.meta.url)));
}
