/**
 * The whole CLI as a plain function: commander commands over
 * @prismshadow/penguin-core, returning an exit code.
 *
 * Built twice: into this package's `penguin` binary (penguin.ts), and — as the CLI
 * artifact pushed to POST /api/hmr/upgrade — into the bundle `penguin-hmr` loads from
 * the HMR store instead (see scripts/deploy.mjs).
 *
 * The CLI's own commands are contributions to `CliCommandsModule` (cli-commands.ts): the
 * host boots that module, turns each command's key into its node on the program, writes
 * the summary as its description and lets the command fill the node in. A first word that
 * names none of them may be a plugin's command, which the server lists and runs
 * (plugin-cli-commands.ts).
 */
import { Command, CommanderError } from "commander";
import { buildInfo } from "@prismshadow/penguin-core";
import type { CliCommandProgram } from "@prismshadow/penguin-core/cli";
import { bootBuiltinCommands } from "./cli-commands.js";
import { dispatchPluginCommand, serverPluginCommands } from "./plugin-cli-commands.js";
import { reportCommanderError } from "./usage-error.js";
import { getMessages, resolveLanguage } from "@prismshadow/penguin-server/cli";

/** The node for a dotted key under `program`, found or built one segment at a time. */
function commandAt(program: Command, key: string): Command {
  let node = program;
  for (const segment of key.split(".")) {
    node = node.commands.find((c) => c.name() === segment) ?? node.command(segment);
  }
  return node;
}

/**
 * Runs one invocation (`argv` = process.argv.slice(2)) and returns its exit code.
 * `exitOverride()` keeps commander from calling process.exit, and process.exitCode is
 * read back then restored, so calling this more than once in a process is safe.
 */
export async function cli(argv: string[]): Promise<number> {
  const language = resolveLanguage();
  const t = getMessages(language);
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
    .configureOutput({ outputError: () => {} })
    .enablePositionalOptions();

  for (const command of await bootBuiltinCommands()) {
    const node = commandAt(program, command.key).description(command.summary[language]);
    // CliCommandProgram is opaque in the contract; the host knows what it built. The locale
    // is resolved once, here, and every register consumes the bundle — no command resolves
    // a locale itself. The commands write to this process's own streams; this invocation
    // IS the process.
    command.code.register(node as unknown as CliCommandProgram, { messages: t });
  }

  // Show help only when no subcommand is given (empty input); do not error.
  program.action(() => {
    program.outputHelp();
  });

  const first = argv[0];
  if (
    first !== undefined &&
    !first.startsWith("-") &&
    first !== "help" &&
    !program.commands.some((c) => c.name() === first || c.aliases().includes(first))
  ) {
    // Not one of the CLI's commands: perhaps a plugin's. Only a running server is asked.
    try {
      const code = await dispatchPluginCommand(
        argv,
        language,
        serverPluginCommands({ autoStart: false }, t),
        t,
      );
      if (code !== null) return code;
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }

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
