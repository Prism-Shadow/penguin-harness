/** `penguin`: the CLI built into this binary. */
// First import on purpose: it installs the node:sqlite warning filter, and the graph
// below reaches that builtin while it loads (see warnings.ts).
import "./warnings.js";
import "dotenv/config";
import { cli } from "./index.js";

cli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
