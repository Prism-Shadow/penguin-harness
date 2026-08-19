/**
 * `penguin`: the CLI this machine should run — whatever was last pushed to its HMR store,
 * else the implementation built into this binary. See pushed-cli.ts for why that order, and
 * for the two ways back when a push goes wrong.
 */
import "dotenv/config";
import { resolveRoot } from "@prismshadow/penguin-core";
import { cli } from "./index.js";
import { resolveCli } from "./pushed-cli.js";

/**
 * Running from source (tsx, i.e. `pnpm penguin` in this repo) means the working tree IS the
 * thing being run, and a bundle pushed to the dev data root must not shadow it — editing a
 * command and seeing yesterday's push instead is a trap worth closing in code rather than
 * in every dev script. The entry's own extension is the signal: a built binary is .js.
 */
const fromSource = import.meta.url.endsWith(".ts");

(fromSource ? Promise.resolve(cli) : resolveCli({ root: resolveRoot(), builtIn: cli }))
  .then((run) => run(process.argv.slice(2)))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
