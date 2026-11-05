/**
 * The server's own package, as the plugin library's host: its `dependencies` name the plugin
 * packages this build ships (core plugin/library-host.ts). Named at boot, so a checkout, the npm
 * package and a test all read the library the server was installed with.
 *
 * Found from this module's location — the nearest package.json above it, when that is the
 * server's. Where the server is bundled into something else (the desktop app's single server
 * bundle, a hot push's platform bundle in the data root) there is no such package above it, and
 * nothing is named: the library is then the pushed copy, or the bundling package's own.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_PACKAGE = "@prismshadow/penguin-server";

/** The directory of the server package this module belongs to, or null when it is bundled into another. */
export function serverPackageDir(
  from: string = path.dirname(fileURLToPath(import.meta.url)),
): string | null {
  for (let dir = from; ;) {
    const file = path.join(dir, "package.json");
    if (fs.existsSync(file)) {
      try {
        const { name } = JSON.parse(fs.readFileSync(file, "utf8")) as { name?: unknown };
        return name === SERVER_PACKAGE ? dir : null;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
