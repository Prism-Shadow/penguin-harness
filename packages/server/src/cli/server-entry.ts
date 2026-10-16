/**
 * Which CLI entry starts a server: the pushed one when this data root has it.
 *
 * A push carries a CLI bundle, and that bundle contains the server's entry — the whole CLI is
 * bundled together with @prismshadow/penguin-server. `penguin-hmr` is the loader that runs it.
 * A server started through the installed `penguin.js` keeps the entry it was installed with,
 * so everything on the entry side (the process entry, the terminal WebSocket handshake)
 * would only change with a reinstall. Starting through `penguin-hmr` whenever the root has a
 * usable pushed CLI makes those changes arrive with a push and a restart.
 *
 * Resolved at every start, not once: a supervisor that relaunches its child after a restart
 * request picks up the CLI pushed since it was itself started.
 */
import fs from "node:fs";
import path from "node:path";
import { readPushedCli } from "../hmr/manifest.js";

/** The loader that runs the pushed CLI, emitted next to `penguin.js` (tsup.config.ts). */
export const PUSHED_CLI_LOADER = "penguin-hmr.js";

/**
 * The entry to start a server with: the `penguin-hmr` loader beside `ownEntry` when `root`
 * records a usable pushed CLI, else `ownEntry` itself. Nothing pushed, a broken record and an
 * installation without the loader all fall back to `ownEntry`: a server that starts on the
 * installed CLI beats one that does not start.
 */
export async function serverStartEntry(ownEntry: string, root: string): Promise<string> {
  if (path.basename(ownEntry) === PUSHED_CLI_LOADER) return ownEntry;
  const loader = path.join(path.dirname(ownEntry), PUSHED_CLI_LOADER);
  if (!fs.existsSync(loader)) return ownEntry;
  return (await readPushedCli(root)).kind === "bundle" ? loader : ownEntry;
}
