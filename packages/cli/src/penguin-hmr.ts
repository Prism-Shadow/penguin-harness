/**
 * `penguin-hmr`: the CLI currently pushed to this machine's HMR store, instead of the
 * one built into this binary. Use `penguin` when nothing is pushed.
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { resolveRoot } from "@prismshadow/penguin-core";
import { resolveCliBundlePath } from "@prismshadow/penguin-server/hmr/manifest";

export async function loadPushedCli(root: string): Promise<(argv: string[]) => Promise<number>> {
  const bundlePath = await resolveCliBundlePath(root);
  if (bundlePath === null) throw new Error(`no CLI pushed to ${root}; use \`penguin\` instead`);
  // Cache-busted: a re-push writes a new file, but the same path may be reused.
  const mod = (await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`)) as {
    cli?: (argv: string[]) => Promise<number>;
  };
  if (typeof mod.cli !== "function") throw new Error(`${bundlePath} does not export 'cli'`);
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
