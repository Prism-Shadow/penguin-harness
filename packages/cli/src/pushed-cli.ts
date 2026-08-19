/**
 * Which CLI implementation this invocation should run: the one pushed to this machine's
 * HMR store, or the one built into the binary.
 *
 * Hot update only counts if it reaches the command people actually type. `penguin` used to
 * always run its built-in commands, with the pushed CLI reachable only as a second command
 * — so a fix pushed alongside the server it talks to sat on disk unused unless the user
 * knew to run `penguin-hmr` instead. Preferring the pushed one, exactly as the server
 * prefers a pushed platform over its packaged default, is what makes the push arrive.
 *
 * Two things keep that from being a way to brick the CLI:
 *
 * - A pushed bundle that cannot be loaded is a warning on stderr, not a failure. Old
 *   behaviour beats no behaviour, and the store is the only place a bad push lives — the
 *   binary itself is untouched (the server's restore does the same thing with a damaged
 *   store).
 * - `PENGUIN_NO_HMR=1` runs the built-in CLI without even looking, which is the way back
 *   when a pushed CLI loads fine and then misbehaves.
 *
 * NO side effects at import time, deliberately: `penguin.ts` and `penguin-hmr.ts` both
 * import this, and penguin-hmr.ts decides whether it is the process entry point by
 * comparing import.meta.url against argv[1]. If that check lived in a module penguin.ts
 * imports, bundling the two together (the desktop app does exactly this) would fire it on
 * every plain `penguin` run.
 */
import { pathToFileURL } from "node:url";

export type CliFn = (argv: string[]) => Promise<number>;

/**
 * The pushed CLI, or null when nothing has been pushed to `root`. Throws only when a
 * bundle IS recorded and turns out to be unusable — the caller distinguishes "there is
 * nothing to run" from "what there is, is broken".
 */
export async function loadPushedCli(root: string): Promise<CliFn | null> {
  // Dynamic: the manifest reader lives in the server package, and a run that never looks
  // for a pushed CLI should not pay to load it.
  const { resolveCliBundlePath } = await import("@prismshadow/penguin-server/hmr/manifest");
  const bundlePath = await resolveCliBundlePath(root);
  if (bundlePath === null) return null;
  // Cache-busted: a re-push writes a new file, but the same path may be reused.
  const mod = (await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`)) as {
    cli?: CliFn;
  };
  if (typeof mod.cli !== "function") throw new Error(`${bundlePath} does not export 'cli'`);
  return mod.cli;
}

export interface ResolveCliOptions {
  /** Data root whose HMR store is consulted. */
  root: string;
  /** The implementation compiled into this binary. */
  builtIn: CliFn;
  env?: NodeJS.ProcessEnv;
  /** Injected in tests; production uses loadPushedCli. */
  load?: (root: string) => Promise<CliFn | null>;
  /** Injected in tests; production writes to stderr. */
  warn?: (line: string) => void;
}

/** The implementation to run, with the fallbacks the module doc describes. */
export async function resolveCli(options: ResolveCliOptions): Promise<CliFn> {
  const env = options.env ?? process.env;
  if (env.PENGUIN_NO_HMR === "1") return options.builtIn;
  const load = options.load ?? loadPushedCli;
  try {
    return (await load(options.root)) ?? options.builtIn;
  } catch (err) {
    // Nothing pushed is the ordinary case and says nothing. A pushed bundle that fails to
    // load is worth a line: without it the user silently gets older behaviour than the
    // server they are talking to.
    const warn = options.warn ?? ((line: string) => process.stderr.write(`${line}\n`));
    warn(
      `penguin: the pushed CLI could not be loaded (${
        err instanceof Error ? err.message : String(err)
      }); running the built-in one. Set PENGUIN_NO_HMR=1 to skip this check.`,
    );
    return options.builtIn;
  }
}
