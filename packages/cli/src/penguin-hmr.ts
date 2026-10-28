/**
 * `penguin-hmr`: the CLI currently pushed to this machine's HMR store, instead of the
 * one built into this binary. Use `penguin` when nothing is pushed.
 *
 * Which entry runs is resolution's answer (the shared procedure this package's server
 * publishes as `./cli-resolution`, beside the record reader this loader already imports):
 * this loader answers with itself for a root that holds a pushed CLI, and reports the reason
 * or the fault by name otherwise — `no-record` on a root nothing was ever pushed to,
 * `damaged-record`, `cli-pointer-unusable`, `cli-bundle-missing`, `loader-missing` for a
 * product whose declaration names no present loader. A name, not a sentence, is what a
 * person and a remote command act on.
 */
// First import on purpose, as in penguin.ts: the pushed CLI bundle this entry loads
// reaches node:sqlite the same way (see warnings.ts).
import "./warnings.js";
import "dotenv/config";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveRoot } from "@prismshadow/penguin-core";
import {
  answerForRecordState,
  loaderDeclarationFor,
  readCliRecord,
  recordStateDetail,
  resolveCli,
} from "@prismshadow/penguin-server/cli-resolution";

/** This file: the loader's own entry, which resolution answers with on a pushed root. */
const SELF = fileURLToPath(import.meta.url);

export async function loadPushedCli(
  root: string,
  /**
   * The entry resolution answers for: this module. A test that runs a fixture product's
   * loader through this same procedure names that fixture instead.
   */
  self: string = SELF,
): Promise<(argv: string[]) => Promise<number>> {
  const resolved = await resolveCli({
    self,
    root,
    declaration: await loaderDeclarationFor(self),
  });
  // A fault is reported by name: it says which part of the installation is broken, and a
  // wrapper that only said "no CLI pushed" would hide the difference.
  if (resolved.kind === "fault") throw new Error(`${resolved.fault}: ${resolved.detail}`);
  // The two reasons that name the installed CLI are not a CLI to load here: this entry
  // exists to run the PUSHED one, and there is none.
  if (resolved.reason === "no-record" || resolved.reason === "no-pushed-cli") {
    throw new Error(`${resolved.reason}: nothing is pushed to ${root}; use \`penguin\` instead`);
  }
  const record = await readCliRecord(root);
  if (record.kind !== "bundle") {
    // Resolution answered this entry itself (it is the product's loader), so the record's own
    // state is what stands between it and a CLI: it reports that state under the name the
    // fixed table gives it, not as a sentence about "an unusable CLI".
    const answer = answerForRecordState(record.kind);
    const name = answer.kind === "entry" ? answer.reason : answer.fault;
    throw new Error(`${name}: ${recordStateDetail(record, root)}`);
  }
  const bundlePath = record.file;
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
      `loader-unloadable: ${bundlePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (typeof mod.cli !== "function") {
    throw new Error(`loader-unloadable: ${bundlePath} does not export 'cli'`);
  }
  return mod.cli;
}

/** Only when run as the entry point, so tests can import loadPushedCli. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadPushedCli(resolveRoot())
    .then((cli) => cli(process.argv.slice(2)))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
