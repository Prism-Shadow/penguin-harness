/**
 * `penguin-hmr`: the CLI currently pushed to this machine's HMR store, instead of the
 * one built into this binary. Use `penguin` when nothing is pushed.
 *
 * Which entry runs is the shared answer in the server's command-shim module,
 * `@prismshadow/penguin-server/cli-shim` — the same answer the `penguin` written into this
 * data root's `bin/` runs under. This loader asks it for the pushed bundle, and reports a
 * fault by name: `own-entry` when nothing is pushed here, `record-unreadable` and
 * `declared-loader-missing` when the installation is broken, `cli-unloadable` when the
 * pushed CLI cannot be loaded.
 */
// First import on purpose, as in penguin.ts: the pushed CLI bundle this entry loads
// reaches node:sqlite the same way (see warnings.ts).
import "./warnings.js";
import "dotenv/config";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveRoot } from "@prismshadow/penguin-core";
import { resolveCli } from "@prismshadow/penguin-server/cli-shim";

/** This file: the loader's own entry, which resolution answers with on a pushed root. */
const SELF_ENTRY = fileURLToPath(import.meta.url);

export async function loadCli(
  root: string,
  /**
   * The entry resolution answers for: this module. A test that runs a fixture product's
   * loader through this same procedure names that fixture instead.
   */
  callerEntry: string = SELF_ENTRY,
): Promise<(argv: string[]) => Promise<number>> {
  const answer = await resolveCli({ callerEntry, root });
  // A fault is reported by name: it says which part of the installation is broken, where a
  // wrapper that only said "no CLI pushed" would hide the difference.
  if (answer.kind === "fault") throw new Error(`${answer.fault}: ${answer.detail}`);
  // The one reason that answers an entry with no bundle means nothing is pushed here: this
  // entry exists to run the pushed CLI, and there is none to run.
  if (answer.bundle === null) {
    throw new Error(`${answer.reason}: nothing is pushed to ${root}; use \`penguin\` instead`);
  }
  const bundlePath = answer.bundle;
  // Cache-busted: a re-push writes a new file, but the same path may be reused.
  let mod: { cli?: (argv: string[]) => Promise<number> };
  try {
    mod = (await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`)) as {
      cli?: (argv: string[]) => Promise<number>;
    };
  } catch (err) {
    // A loader that is present but cannot load its CLI reports this as its first act; the
    // push gate and the release assertion turn a failed probe into the same name.
    throw new Error(
      `cli-unloadable: ${bundlePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof mod.cli !== "function") {
    throw new Error(`cli-unloadable: ${bundlePath} does not export 'cli'`);
  }
  return mod.cli;
}

/** Only when run as the entry point, so tests can import loadCli. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadCli(resolveRoot())
    .then((cli) => cli(process.argv.slice(2)))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
