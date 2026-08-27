/**
 * Commander's own parse failures, said in the user's language.
 *
 * With `exitOverride()` commander still WRITES its English line before throwing
 * (`error: missing required argument 'sessionId'`), so `cli()` silences that output
 * channel and prints from here instead: one localized sentence naming what is wrong, and
 * — for every way a command can be typed wrong — that command's own usage plus a pointer
 * at its `--help`. Exit codes are commander's, unchanged.
 *
 * Only the identifier commander quoted survives from its message (the argument name, the
 * option flags, the command name); the prose around it is rebuilt from the dictionaries.
 * A failure that quotes nothing keeps commander's detail verbatim, so nothing is ever
 * swallowed silently.
 */
import type { Command, CommanderError } from "commander";
import type { Messages } from "./i18n.js";

/** Commander codes that mean "the command line was typed wrong" — these earn the usage line. */
const USAGE_ERROR_CODES = new Set([
  "commander.missingArgument",
  "commander.missingMandatoryOptionValue",
  "commander.optionMissingArgument",
  "commander.unknownOption",
  "commander.unknownCommand",
  "commander.invalidArgument",
  "commander.excessArguments",
  "commander.conflictingOption",
]);

/**
 * The deepest registered command this argv actually named, so the usage line quotes
 * `penguin schedule add` rather than `penguin`. Option tokens are skipped and the walk
 * stops at the first word naming no subcommand — an argument value, or an option's
 * value, which no grammar-free walk can tell apart from one. Landing on the parent only
 * costs the usage line some precision.
 */
export function commandForArgv(program: Command, argv: string[]): Command {
  let cmd = program;
  for (const token of argv) {
    if (token.startsWith("-")) continue;
    const next = cmd.commands.find((c) => c.name() === token || c.aliases().includes(token)) as
      Command | undefined;
    if (next === undefined) break;
    cmd = next;
  }
  return cmd;
}

/** Full spelling of a command including its ancestors (`penguin schedule add`). */
function commandPath(cmd: Command): string {
  const parts: string[] = [];
  for (let c: Command | null = cmd; c !== null; c = c.parent) parts.unshift(c.name());
  return parts.join(" ");
}

/** The single-quoted identifier in a commander message, when it has one. */
function quotedIdentifier(message: string): string | null {
  const m = /'([^']+)'/.exec(message);
  return m === null ? null : m[1]!;
}

/** The localized sentence for one commander failure. */
function usageErrorLine(err: CommanderError, argv: string[], atRoot: boolean, t: Messages): string {
  // `penguin <typo>`: bare `penguin` prints help, so the root carries an action handler
  // and commander calls a stray word "too many arguments". For a program that is nothing
  // but subcommands, the true diagnosis is an unknown command — say that instead.
  if (err.code === "commander.excessArguments" && atRoot) {
    const word = argv.find((a) => !a.startsWith("-"));
    if (word !== undefined) return t.usage.unknownCommand(word);
  }
  const detail = err.message.replace(/^error:\s*/, "");
  const token = quotedIdentifier(err.message);
  if (token === null) return t.usage.other(detail);
  switch (err.code) {
    case "commander.missingArgument":
      return t.usage.missingArgument(token);
    case "commander.missingMandatoryOptionValue":
      return t.usage.missingOption(token);
    case "commander.optionMissingArgument":
      return t.usage.optionMissingArgument(token);
    case "commander.unknownOption":
      return t.usage.unknownOption(token);
    case "commander.unknownCommand":
      return t.usage.unknownCommand(token);
    default:
      return t.usage.other(detail);
  }
}

/**
 * Reports one CommanderError and returns the exit code to hand back. `--help` and
 * `--version` travel this path too (exit code 0): they have already written their own
 * output, so nothing more is printed.
 */
export function reportCommanderError(
  err: CommanderError,
  program: Command,
  argv: string[],
  t: Messages,
): number {
  if (err.exitCode === 0) return err.exitCode;
  const cmd = commandForArgv(program, argv);
  process.stderr.write(`${t.error(usageErrorLine(err, argv, cmd === program, t))}\n`);
  if (USAGE_ERROR_CODES.has(err.code)) {
    process.stderr.write(`${t.usage.hint(commandPath(cmd), cmd.usage())}\n`);
  }
  return err.exitCode;
}
