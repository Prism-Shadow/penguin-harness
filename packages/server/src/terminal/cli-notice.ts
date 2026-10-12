/**
 * The first line of a terminal: which `penguin` runs there, on a development instance, and why
 * `penguin` there is not this instance's, on any instance where that is so.
 *
 * A development instance is where the question comes up at all. The machine typically has the
 * installed app, the checkout being worked on and often more worktrees, each with a `penguin`
 * and a server of its own, and one that answers to the wrong one looks exactly like the right
 * one until it misbehaves. So a terminal of a server running from a checkout states, before
 * its prompt, whose CLI `penguin` is and which data root it targets — the shim's default, see
 * services/cli-shim.ts. An installation says nothing: its terminals look as they always did.
 *
 * Two states are worth a warning anywhere: a checkout whose CLI cannot run (the shim is a stub
 * that says why), and a shim that should be there and is not (the server could not write it,
 * or it was removed since), where `penguin` silently becomes whatever else PATH finds.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerConfig } from "../config.js";
import type { TerminalNotice } from "./session.js";

/**
 * Whether this server's terminals get their `penguin`'s data root from the shim: there is a
 * shim (`dirs`, the Session environment's pathPrepend, is not empty) and the runtime that wrote
 * it names the root in it — cliLaunch is how a runtime says it is that recent. A pushed platform
 * can run on an older runtime, whose shim does not; there, and where there is no shim at all,
 * the shell keeps the server's PENGUIN_HOME so that `penguin` finds this server as before.
 */
export function shimNamesDataRoot(
  config: Pick<ServerConfig, "cliLaunch">,
  dirs: readonly string[],
): boolean {
  return config.cliLaunch !== undefined && dirs.length > 0;
}

/** `dir` with the home directory spelled `~`, the way a person reads a path. */
function tilde(dir: string, home: string): string {
  if (home === "" || home === path.sep) return dir;
  if (dir === home) return "~";
  return dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : dir;
}

/**
 * The notice a new terminal of this server shows, or null for none. `dirs` is what the
 * terminal puts first on PATH (the Session environment's pathPrepend: the shim directory, or
 * nothing when there is no shim to offer).
 */
export function terminalCliNotice(
  config: Pick<ServerConfig, "root" | "cliEntry" | "cliLaunch">,
  dirs: readonly string[],
  home: string = os.homedir(),
): TerminalNotice | null {
  const launch = config.cliLaunch;
  if (launch?.unavailable) {
    return {
      tone: "warning",
      text: `This dev instance's penguin cannot run, and says so instead: ${launch.unavailable}`,
    };
  }
  const shim = dirs.length > 0 ? path.join(dirs[0]!, "penguin") : null;
  if (shim !== null && !fs.existsSync(shim)) {
    return {
      tone: "warning",
      text:
        `penguin here is not this instance's: ${tilde(shim, home)} is missing (see the server ` +
        "log), so whichever penguin PATH finds first runs instead.",
    };
  }
  if (!launch?.checkout || !config.cliEntry) return null;
  const which =
    launch.origin === "env"
      ? `${tilde(config.cliEntry, home)} (PENGUIN_CLI_ENTRY)`
      : `the CLI of ${tilde(launch.checkout, home)} (${launch.origin === "source" ? "source" : "built"})`;
  return {
    tone: "info",
    text:
      `This dev instance's penguin: ${which}, on data root ${tilde(config.root, home)} ` +
      "(`penguin server status` shows its server).",
  };
}
