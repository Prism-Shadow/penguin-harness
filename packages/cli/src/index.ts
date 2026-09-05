/**
 * The whole CLI as a plain function: commander commands over
 * @prismshadow/penguin-core, returning an exit code.
 *
 * Built twice: into this package's `penguin` binary (penguin.ts), and — as the CLI
 * artifact pushed to POST /api/hmr/upgrade — into the bundle `penguin-hmr` loads from
 * the HMR store instead (see scripts/deploy.mjs).
 */
import { Command, CommanderError } from "commander";
import { buildInfo } from "@prismshadow/penguin-core";
import { registerAuthCommand } from "./commands/auth.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerRunCommand } from "./commands/run.js";
import { registerChatCommand } from "./commands/chat.js";
import { registerLsCommand } from "./commands/ls.js";
import { registerInputCommand } from "./commands/input.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerAgentCommand } from "./commands/agent.js";
import { registerProjectCommand } from "./commands/project.js";
import { registerCostCommand } from "./commands/cost.js";
import { registerScheduleCommand } from "./commands/schedule.js";
import { registerOrgCommand } from "./commands/org.js";
import { registerServeCommands } from "./commands/serve.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerVersionCommand } from "./commands/version.js";
import { reportCommanderError } from "./usage-error.js";
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
    // The same string `penguin version` prints, so the flag and the subcommand can never
    // disagree. Commander stores it eagerly, which costs a source build its two git calls on
    // every startup; a release build reads stamped constants and spawns nothing.
    .version(buildInfo().describe, "-v, --version", t.versionDesc)
    .exitOverride()
    // Commander writes its English `error: ...` line before throwing; drop that channel
    // and report the failure localized from the catch below (see usage-error.ts). Both
    // settings must be in place before the subcommands are created — that is when they
    // are copied down (commander's copyInheritedSettings).
    .configureOutput({ outputError: () => {} });

  registerAuthCommand(program, t);
  registerConfigCommand(program, t);
  registerRunCommand(program, t);
  registerChatCommand(program, t);
  registerLsCommand(program, t);
  registerInputCommand(program, t);
  registerLogsCommand(program, t);
  registerAgentCommand(program, t);
  registerProjectCommand(program, t);
  registerCostCommand(program, t);
  registerScheduleCommand(program, t);
  registerOrgCommand(program, t);
  registerServeCommands(program, t);
  registerUpdateCommand(program, t);
  registerVersionCommand(program, t);

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
    if (err instanceof CommanderError) return reportCommanderError(err, program, argv, t);
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    process.exitCode = priorExitCode;
  }
}
