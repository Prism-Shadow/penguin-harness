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
 * from the store when it is named by sha. The parser writes what a push carries inline into
 * the blobs its lease opens; this check hands it a lease over memory, so reading a push here
 * stores nothing. A body that does not parse, a CLI this process
 * cannot read, and a server that knows no loader to run it with are left to the endpoint:
 * this check only refuses what it has seen fail.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
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

/** The lease `parseUpgradeTarget` reads a push under (packages/hmr keeps the name to itself). */
type BlobLease = Parameters<typeof parseUpgradeTarget>[2];

/**
 * A lease over memory: what a push carries inline is kept under its sha256 for the length of
 * the check instead of being written to the blob store, and a part named by `{ sha }` is
 * taken as held — whether the store has it is the endpoint's to say. An inline push is
 * therefore held here once; a push that names its parts by sha, the way the pushers send a
 * large one, costs its small body.
 */
function scratchLease(inline: Map<string, Buffer>): BlobLease {
  return {
    open: async () => {
      const chunks: Buffer[] = [];
      return {
        write: async (chunk) => {
          chunks.push(Buffer.from(chunk));
        },
        close: async () => {
          const bytes = Buffer.concat(chunks);
          const sha = createHash("sha256").update(bytes).digest("hex");
          inline.set(sha, bytes);
          return sha;
        },
        abort: async () => {},
      };
    },
    hold: () => true,
    release: () => {},
  };
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
  let source: Buffer;
  try {
    const inline = new Map<string, Buffer>();
    const target = await parseUpgradeTarget(
      request.headers.get("content-type"),
      Buffer.from(await request.arrayBuffer()),
      scratchLease(inline),
    );
    const cli = inline.get(target.cli.sha) ?? readBlob?.(target.cli.sha) ?? null;
    if (cli === null) return null;
    source = cli;
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
