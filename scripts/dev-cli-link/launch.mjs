/**
 * The globally linked `penguin` and `penguin-hmr` of a source checkout (`pnpm link:cli`, which
 * `pnpm build` runs): this checkout's built CLI, run with the environment `pnpm penguin` gives
 * the same CLI from source. Linked bare, it would run on the installed release's data root and
 * port, and write that root in this checkout's formats, which the release may not read.
 *
 * The built entry is loaded into this same process, so the TTY, stdin, signals and the exit
 * code are the CLI's own, with no parent process in between to relay them.
 */
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The root `penguin` script's run-with-env assignments; dev-entry-isolation.test.ts pins them. */
const DEV_CLI_ENV = [
  "--unset=PENGUIN_CLI_ENTRY",
  "PENGUIN_HOME=~/.penguin/dev-data-cli",
  "PENGUIN_PROFILE=dev",
  "PORT=7369",
];

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Runs `packages/cli/dist/<entry>` as `node packages/cli/dist/<entry>` would. */
export async function launch(entry) {
  // run-with-env's rule: unset what must not be inherited; default a variable only when it is
  // unset or empty, and say so when an inherited value wins.
  for (const token of DEV_CLI_ENV) {
    if (token.startsWith("--unset=")) {
      delete process.env[token.slice("--unset=".length)];
      continue;
    }
    const [name, raw] = token.split("=");
    const value = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
    if (!process.env[name]) process.env[name] = value;
    else if (process.env[name] !== value) {
      console.error(`penguin (dev link): ${name}=${process.env[name]} overrides ${value}`);
    }
  }
  const file = path.join(checkout, "packages", "cli", "dist", entry);
  // argv[1] is how the CLI finds itself: the entry `penguin server|web` re-runs and names to
  // the server, and the place the server resolves plugin packages from.
  process.argv[1] = file;
  await import(pathToFileURL(file).href);
}
