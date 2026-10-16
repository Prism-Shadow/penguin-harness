/**
 * The whole CLI as a plain function — one host plus the command contributions it
 * discovers, returning an exit code.
 *
 * Built twice: into this package's `penguin` binary (penguin.ts), and — as the CLI
 * artifact pushed to POST /api/hmr/upgrade — into the bundle `penguin-hmr` loads from
 * the HMR store instead (see scripts/deploy.mjs).
 *
 * THE HOST keeps what dispatch needs to exist before anything can be named: `--version`
 * (the same string `penguin version` prints), and its own reserved commands — auth, exec,
 * plugin, update, version — registered eagerly, their code statically imported. Their
 * root segments are closed to contributions (RESERVED_ROOTS), so no package can shadow
 * them.
 *
 * THE CONTRIBUTIONS are everything else. One discovery reads the `cli.commands` data
 * halves — the CLI's own table, the server package's declaration module, the plugin
 * closure of the data root — without importing any command's code (contributions.ts).
 * Then one decision, before the parse:
 *
 *   - argv names commands from TWO OR MORE packages → the ambiguity report: one
 *     copyable `penguin exec <package> …` line per candidate, exit code 2. Nothing runs;
 *     naming the package is the caller's call to make.
 *   - argv names ONE package's commands → that package's code half loads now (the only
 *     import of it anywhere) and registers on the program; commander's own nesting
 *     handles the rest (`server` + `server.status` from one package never collide).
 *   - argv names none (bare `penguin`, `--help`, a reserved command, a stray word) →
 *     PHANTOM registration: every discovered command as a plain commander tree carrying
 *     its summary — the data half alone — so help and completion list the world without
 *     loading a line of any package's code.
 */
import { Command, CommanderError } from "commander";
import { buildInfo } from "@prismshadow/penguin-core";
import { registerAuthCommand } from "./commands/auth.js";
import { registerExecCommand, shellQuote } from "./commands/exec.js";
import { registerPluginCommand } from "./commands/plugin.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerVersionCommand } from "./commands/version.js";
import { reportCommanderError } from "./usage-error.js";
import { defaultMessages, resolveLanguage } from "./i18n.js";
import { cliContext } from "./context.js";
import {
  cliSummary,
  discoverCliCommands,
  matchingCommands,
  matchingPackages,
  registerPackageCommands,
  type CliDiscovered,
} from "./contributions.js";

/** The help/completion half of the discovery: every command as a summary-carrying tree. */
function registerPhantoms(
  program: Command,
  commands: readonly CliDiscovered[],
  language: "en" | "zh",
): void {
  const listed = new Set<string>();
  for (const { entry } of commands) {
    // Two packages contributing the same key list once here; the invocation is where
    // that gets reported, and a doubled help line helps nobody.
    if (listed.has(entry.key)) continue;
    listed.add(entry.key);
    let node = program;
    let prefix = "";
    const segments = entry.key.split(".");
    for (const segment of segments) {
      prefix = prefix === "" ? segment : `${prefix}.${segment}`;
      let child = node.commands.find((c) => c.name() === segment);
      if (child === undefined) child = node.command(segment);
      // The leaf carries the summary; an intermediate node stands for its own entry when
      // one exists (a shorter key found earlier in the same walk).
      if (prefix === entry.key) child.description(cliSummary(entry, language));
      node = child;
    }
  }
}

/** The ambiguity report: header, one exec line per candidate package, the closing note. */
function reportAmbiguous(
  argv: readonly string[],
  pkgs: readonly string[],
  t: ReturnType<typeof defaultMessages>,
): number {
  const words = argv.filter((arg) => !arg.startsWith("-")).join(" ");
  process.stderr.write(`${t.ambiguous.header(words, pkgs.length)}\n`);
  const rest = argv.map(shellQuote).join(" ");
  for (const pkg of pkgs) {
    // The package's npm name (or whatever identity its package.json declared) is what
    // `exec` accepts verbatim; quoted so the line pastes into a shell as one command.
    process.stderr.write(`  penguin exec ${shellQuote(pkg)} ${rest}\n`);
  }
  process.stderr.write(`${t.ambiguous.note()}\n`);
  return 2;
}

/**
 * Runs one invocation (`argv` = process.argv.slice(2)) and returns its exit code.
 * `exitOverride()` keeps commander from calling process.exit, and process.exitCode is
 * read back then restored, so calling this more than once in a process is safe.
 */
export async function cli(argv: string[]): Promise<number> {
  const t = defaultMessages();
  const language = resolveLanguage();
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

  // One discovery, one match, one registration decision — all before the parse. The
  // context carries the resolved language and this invocation's data root to whichever
  // package's code half a dispatch names.
  const ctx = cliContext({ language });
  const discovery = await discoverCliCommands({ root: ctx.root });
  const matches = matchingCommands(discovery.commands, argv);
  const pkgs = matchingPackages(matches);
  if (pkgs.length >= 2) {
    return reportAmbiguous(argv, pkgs, t);
  }
  if (pkgs.length === 1) {
    await registerPackageCommands(discovery, pkgs[0]!, matches[0]!.entry.key, program, ctx);
  } else {
    registerPhantoms(program, discovery.commands, language);
  }

  registerExecCommand(program, t, { language });
  registerPluginCommand(program, t, { language });
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
