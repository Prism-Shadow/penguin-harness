/**
 * The non-bootstrap CLI surface: `penguin run|chat|config`, as a plain function — not
 * a platform instance. `cli()` never boots the HMR platform (see
 * @prismshadow/penguin-server/platform's PlatformIface/platformImpl, and
 * HmrHost.ensure()'s boot() call) and never touches HotResources; it just organizes
 * commander commands over @prismshadow/penguin-core and returns an exit code. "Loading
 * the platform bundle" and "starting a platform" are deliberately different
 * operations — the CLI needs only the former.
 *
 * This module is exported from TWO places, always in lockstep:
 * - platform-bundle.ts re-exports it as `cli` — esbuild's compile target for
 *   scripts/watch-push.mjs, the self-contained bundle pushed to POST /api/hmr/upgrade.
 *   packages/cli/src/index.ts's thin loader dynamically imports THAT compiled bundle
 *   from the data root's HMR store on every invocation and calls its `cli(argv)` — so
 *   pushing a new version hot-updates the CLI's command implementations too, with no
 *   rebuild or reinstall of the `penguin` binary itself.
 * - index.ts imports this module directly (statically) as the packaged fallback for
 *   when nothing has been pushed yet or the hot-loaded bundle is unusable — identical
 *   function, just resolved the ordinary way instead of dynamically imported from the
 *   HMR store.
 *
 * `web` / `server` / `update` stay OUT of this file entirely: they start or replace
 * the runtime that carries this very bundle (`update` replaces the CLI installation
 * itself, and documents its own "never resolves anything dynamically" safety
 * invariant — see commands/update.ts's module doc), so hot-loading them would be
 * circular or unsafe. They live in commands/{serve,update}.ts, registered directly by
 * the thin loader (index.ts's runLocal).
 */
import { Command, CommanderError } from "commander";
import { VERSION } from "@prismshadow/penguin-core";
import { registerConfigCommand } from "./commands/config.js";
import { registerRunCommand } from "./commands/run.js";
import { registerChatCommand } from "./commands/chat.js";
import { defaultMessages } from "./i18n.js";

/**
 * Runs one CLI invocation and returns its exit code. Never calls `process.exit`
 * itself: commander's default exit-on-error/--help/--version behavior is disabled via
 * `exitOverride()`, so lifetime stays with the caller — the thin `penguin` loader in
 * the ordinary case, or a test importing `cli` directly. `argv` is the bare user
 * argument list (no node executable, no script path — i.e. `process.argv.slice(2)`).
 *
 * Command actions communicate failure the existing way, via `process.exitCode`; this
 * function reads that back as its return value and restores whatever
 * `process.exitCode` was before the call, so a `cli()` call has no side effect on
 * ambient process state beyond its return value — safe to call more than once in the
 * same process (as tests, and a long-running loader process, do).
 */
export async function cli(argv: string[]): Promise<number> {
  const t = defaultMessages();
  const program = new Command();
  program
    .name("penguin")
    .description(t.cliDescription)
    .version(VERSION, "-v, --version", t.versionDesc)
    .exitOverride();

  registerConfigCommand(program, t);
  registerRunCommand(program, t);
  registerChatCommand(program, t);

  // Show help only when no subcommand is given (empty input); do not error.
  program.action(() => {
    program.outputHelp();
  });

  const priorExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await program.parseAsync(argv, { from: "user" });
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode;
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    process.exitCode = priorExitCode;
  }
}
