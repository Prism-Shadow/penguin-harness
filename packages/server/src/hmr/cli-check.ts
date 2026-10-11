/**
 * A push is refused when its CLI bundle cannot be started.
 *
 * Every server start path runs the pushed CLI once a push has landed (packages/cli
 * server-entry.ts): a CLI bundle that fails to start would keep the server down at its next
 * restart, long after the push that brought it. The upgrade itself boots the pushed platform
 * and puts the previous one back when it fails, but never runs the CLI — so the CLI is run
 * here, before the push is handed to the mechanism, exactly the way a start path runs it:
 * this installation's `penguin-hmr` loader, on a scratch data root whose record names the
 * pushed bundle, asked for `--version`. Loading it any other way would differ in what the
 * bundle sees at import (where the loader runs from decides where its plugin library is
 * found). It runs in a process of its own: the pushed code does not run inside this server,
 * and a bundle that hangs is cut off.
 *
 * The push is read with the mechanism's own parser (`parseUpgradeTarget`), the CLI resolved
 * from the store when it is named by sha. A body that does not parse, a CLI this process
 * cannot read, and a server that knows no loader to run it with are left to the endpoint:
 * this check only refuses what it has seen fail.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseUpgradeTarget } from "@prismshadow/penguin-hmr";

const execFileAsync = promisify(execFile);

/** Long enough for a cold start of a full CLI bundle; short enough not to hold a push. */
const START_TIMEOUT_MS = 30_000;

/** The loader that runs a pushed CLI, beside the installation's CLI entry (packages/cli tsup). */
export function pushedCliLoader(cliEntry: string | null | undefined): string | null {
  if (!cliEntry) return null;
  const loader = path.join(path.dirname(cliEntry), "penguin-hmr.js");
  return fs.existsSync(loader) ? loader : null;
}

/**
 * Why `request`'s CLI bundle cannot be started by `loader`, or null when it starts or this
 * check has nothing to say about it. `readBlob` resolves a CLI pushed as `{ sha }`; a control
 * object from an HMR layer that predates it has none, and such a CLI is then not checked.
 */
export async function pushedCliProblem(
  request: Request,
  readBlob: ((sha: string) => Buffer | null) | undefined,
  loader: string | null,
): Promise<string | null> {
  if (loader === null) return null;
  let source: string;
  try {
    const target = parseUpgradeTarget(
      request.headers.get("content-type"),
      Buffer.from(await request.arrayBuffer()),
      readBlob ?? (() => null),
    );
    source = target.cli;
  } catch {
    return null;
  }
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-cli-check-"));
  try {
    await fsp.mkdir(path.join(root, "hmr", "store", "cli"), { recursive: true });
    await fsp.writeFile(path.join(root, "hmr", "store", "cli", "pushed.mjs"), source);
    await fsp.writeFile(
      path.join(root, "hmr", "harness.json"),
      JSON.stringify({ cli: { bundle: "store/cli/pushed.mjs" } }),
    );
    await execFileAsync(process.execPath, [loader, "--version"], {
      cwd: root,
      timeout: START_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PENGUIN_HOME: root,
        // Under the desktop app process.execPath is the Electron binary, which runs a script
        // only as Node with this set; without it, a second app instance would open.
        ELECTRON_RUN_AS_NODE: "1",
      },
    });
    return null;
  } catch (err) {
    const e = err as { killed?: boolean; stderr?: string; message?: string };
    if (e.killed) return `the CLI bundle did not start within ${START_TIMEOUT_MS / 1000}s`;
    // Node prints where an import failed before what failed; the error line says why.
    const lines = (e.stderr ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    const reason = lines.find((l) => /Error\b|error:|does not export/.test(l)) ?? lines[0];
    return `the CLI bundle cannot be started: ${reason ?? e.message ?? "unknown error"}`;
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}
