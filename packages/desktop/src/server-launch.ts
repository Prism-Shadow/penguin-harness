/**
 * The embedded server's entry, forked by server-process.ts: the pushed CLI's server when the
 * data root has one, else the server bundled with this app (dist/server.js).
 *
 * A push carries a CLI bundle that contains the server's entry. Forking dist/server.js
 * unconditionally kept the entry this app was installed with, so a change on the entry side
 * (the process entry, the terminal WebSocket handshake) needed a new app install. Starting
 * through the pushed CLI makes it arrive with a push and a restart, as `penguin server` does
 * (the serve group lives in the server package now, packages/server/src/cli/server-entry.ts).
 * Nothing pushed, or a broken record, starts the bundled
 * server: a server that starts beats one that does not.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readPushedCli } from "@prismshadow/penguin-server/hmr/manifest";

const root = process.env.PENGUIN_HOME;
const pushed = root !== undefined ? await readPushedCli(root) : null;

if (pushed?.kind === "bundle") {
  // The CLI's `server` command runs the server in this process when it is marked as a
  // supervisor's child (PENGUIN_SERVE_CHILD, the serve group's supervisor in
  // packages/server/src/cli/serve.ts): the
  // desktop main process is the supervisor here, and a second one would spawn
  // process.execPath — the Electron binary. It also records which CLI started it as
  // PENGUIN_CLI_ENTRY (what the Agents' `penguin` runs and self-update re-runs), read from
  // argv[1]. This file is not a CLI, so argv[1] names the CLI of the harness that runs: the
  // `penguin-hmr` loader bundled beside the app's CLI (tsup.config.ts), or nothing in a
  // source run, where the app pins no CLI.
  process.env.PENGUIN_SERVE_CHILD = "1";
  const appCli = process.env.PENGUIN_CLI_ENTRY;
  const loader = appCli !== undefined ? path.join(path.dirname(appCli), "penguin-hmr.js") : null;
  process.argv[1] = loader !== null && fs.existsSync(loader) ? loader : (appCli ?? "");
  const mod = (await import(pathToFileURL(pushed.file).href)) as {
    cli?: (argv: string[]) => Promise<number>;
  };
  if (typeof mod.cli !== "function") throw new Error(`${pushed.file} does not export 'cli'`);
  await mod.cli(["server"]);
} else {
  await import(new URL("./server.js", import.meta.url).href);
}
