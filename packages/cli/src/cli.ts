/**
 * The whole CLI as a plain function: commander commands over
 * @prismshadow/penguin-core, returning an exit code.
 *
 * Built twice: into this package's `penguin` binary (penguin.ts), and by
 * scripts/watch-push.mjs into the CLI artifact pushed to POST /api/hmr/upgrade,
 * which `penguin-hmr` loads from the HMR store instead.
 */
import { Command, CommanderError } from "commander";
import { VERSION } from "@prismshadow/penguin-core";
import { registerConfigCommand } from "./commands/config.js";
import { registerRunCommand } from "./commands/run.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerServeCommands } from "./commands/serve.js";
import { registerUpdateCommand } from "./commands/update.js";
import { defaultMessages } from "./i18n.js";

/**
 * Runs one invocation (`argv` = process.argv.slice(2)) and returns its exit code.
 * `exitOverride()` keeps commander from calling process.exit, and process.exitCode is
 * read back then restored, so calling this more than once in a process is safe.
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
  registerServeCommands(program, t);
  registerUpdateCommand(program, t);

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
