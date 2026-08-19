/** `penguin`: the CLI built into this binary. */
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
