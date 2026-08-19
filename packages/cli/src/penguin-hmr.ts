/**
 * `penguin-hmr`: strictly the CLI pushed to this machine's HMR store, erroring when there
 * is none.
 *
 * `penguin` already prefers the pushed CLI (see pushed-cli.ts), so this is no longer how an
 * update is reached — it is how you check that one arrived, and how a script pins itself to
 * pushed code rather than silently falling back to the built-in implementation.
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { resolveRoot } from "@prismshadow/penguin-core";
import { loadPushedCli } from "./pushed-cli.js";

/** Only when run as the entry point, so importing this module has no side effects. */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolveRoot();
  loadPushedCli(root)
    .then((cli) => {
      if (cli === null) throw new Error(`no CLI pushed to ${root}; use \`penguin\` instead`);
      return cli(process.argv.slice(2));
    })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exitCode = 1;
    });
}
