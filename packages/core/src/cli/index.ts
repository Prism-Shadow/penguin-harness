/**
 * The CLI command contribution contract: the data and code halves of one `penguin`
 * command, shared by the two places commands are collected.
 *
 * A command is ONE contribution of a `@Component` (or `@Module`) class: the
 * `contributes` entry is its data half (the key and the one-line summary), and the
 * `@Bind(entry.id)` field is its code half — the same class shape the sandbox backends
 * are written with. Two hosts collect such contributions, each in its own module tree:
 *
 *   - The CLI's own commands are contributions to the CLI's `CliCommandsModule.commands`
 *     slot. The CLI bundle is the one that starts the server (a push carries it), so what
 *     it collects is fixed by the build, the same in the CLI process and in the server's.
 *   - A plugin's commands are contributions to the server's
 *     `PluginCliCommandsProvider.commands` slot (`@prismshadow/penguin-server/plugin`).
 *     They live in the server's tree like every other plugin contribution; the CLI lists
 *     them from the server and asks the server to run one.
 *
 * A key is the command's path (`a.b.c` answers `penguin a b c ARGS`). The host turns it
 * into the command node and writes the summary as the node's description; the code half
 * receives that node and adds the options, arguments and action. A code half never builds
 * its own path with `program.command("…")`.
 */
import type { Opaque } from "../kernel/markers.js";
import type { JsonObject } from "../kernel/json.js";

/** A shipped plugin's commands, booted by the CLI from the plugin's `./cli` export (module.ts). */
export type * from "./module.js";

/** A command's one-line summary, one per language — what help prints. */
export interface CliCommandSummary {
  en: string;
  zh: string;
}

/**
 * The local files a plugin command exchanges with the terminal that runs it. Named by option,
 * never by operand: the terminal holds no grammar of the command, and an option's value is the
 * one argument it can find without one (`--image a.png` or `--image=a.png`, up to a bare `--`).
 */
export interface CliCommandFiles {
  /** Options (`--image`) whose value is a local file the terminal reads and sends with the run. */
  read?: string[];
  /**
   * The option (`--out`) whose value is the local directory the terminal saves the run's files
   * into; absent, or not given on the command line, the current directory.
   */
  write?: string;
}

/** The data half of one command: the slot's data type. */
export interface CliCommandData {
  /** `a.b.c` — the leading argv segments this command answers; lowercase `[a-z][a-z0-9-]*` segments joined by dots. */
  key: string;
  /** The one-line summary help prints, per language. */
  summary: CliCommandSummary;
  /**
   * Who may run it where a host checks (the server): `admin` (the default) or any member of the
   * caller's Project — the run then needs one, and the command reads it from `ctx.caller`.
   */
  access?: "admin" | "member";
  /** The local files it reads and returns, for the terminal to send and save (plugin commands). */
  files?: CliCommandFiles;
}

/** One command as a collected contribution carries it: the data half plus the manifest's `id`. */
export type CliCommandEntry = CliCommandData & { id: string } & JsonObject;

/**
 * The command node the host located by the entry's key, with the summary already set as
 * its description. Opaque in the contract: the contributor types it with the `commander`
 * its own package depends on, so the contract pins no commander version.
 */
export type CliCommandProgram = Opaque<"Command">;

/**
 * What every host's message bundle guarantees: the locale the host resolved the invocation
 * into, as a bare string — the set of locales is the host's to define, not the contract's.
 * A command never resolves a locale and never reads an environment variable — it reads the
 * bundle it was handed. Each host fills the rest of its bundle with its own vocabulary;
 * the CLI's is its full `Messages`.
 */
export interface CliCommandMessages {
  language: string;
}

/** Where a command writes: what the stream means is the host's (the process's own, or a reply's). */
export interface CliCommandStream {
  write(text: string): void;
}

/** Who runs a command, as the host checked it (the server: the signed-in user and the run's context). */
export interface CliCommandCaller {
  userId: string;
  isAdmin: boolean;
  /** The caller's Project: the caller can see it. */
  projectId?: string;
  /** The caller's Session (an Agent's shell): a Session of `projectId`. */
  sessionId?: string;
  /** That Session's Agent. */
  agentId?: string;
}

/** A file a command exchanges with the terminal. */
export interface CliCommandFile {
  /** A plain file name, no directory: the terminal decides where it lands. */
  name: string;
  /** The bytes (opaque in the contract: a host object, not data the manifest check compares). */
  data: Opaque<"Uint8Array", Uint8Array>;
  mimeType?: string;
}

/**
 * What a command's code half may use from the host that runs it: the host's message
 * bundle, resolved once per invocation. The bundle's shape beyond `language` is the
 * host's to define — a contributor types it with the host whose slot it contributes to.
 *
 * Output goes through `stdout` / `stderr` and the exit code through `exit`: on the server, runs
 * of member commands are concurrent, so a command that writes the process's own streams or sets
 * `process.exitCode` there writes into the server's log instead (admin commands are still
 * captured from the process, as before). The rest is the server's: the checked caller, the files
 * the terminal sent, and the files handed back to it.
 */
export interface CliCommandContext<M extends CliCommandMessages = CliCommandMessages> {
  messages: M;
  stdout: CliCommandStream;
  stderr: CliCommandStream;
  /** This invocation's exit code (default 0; a thrown error is 1). Does not stop the command. */
  exit(code: number): void;
  /** Who runs it (the server host). */
  caller?: CliCommandCaller;
  /** A file the terminal sent for a `files.read` option, by the option's value as typed; undefined when none was. */
  input?(value: string): CliCommandFile | undefined;
  /** Hands a file to the terminal, which saves it under `files.write` (the server host). */
  output?(file: CliCommandFile): void;
}

/**
 * The code half one command binds: the value its class assigns to the `@Bind(entry.id)`
 * field. `register` fills in the node the host located for the entry's key — options,
 * arguments, action — and runs before the host parses argv.
 */
export interface CliCommandCode<M extends CliCommandMessages = CliCommandMessages> {
  register(command: CliCommandProgram, ctx: CliCommandContext<M>): void;
}

/** Whether a key is shaped the way dispatch reads it: lowercase `[a-z][a-z0-9-]*` segments joined by dots. Null when it is. */
export function cliCommandKeyFault(key: string): string | null {
  if (key === "") return "the key is empty";
  const segment = /^[a-z][a-z0-9-]*$/;
  for (const part of key.split(".")) {
    if (!segment.test(part)) {
      return `'${key}' is not a command path: dot-joined [a-z][a-z0-9-]* segments`;
    }
  }
  return null;
}

/**
 * The command an argv names among `commands` (one package's): the one with the longest key whose
 * every segment is one of the argv's leading words, up to its first option. Undefined when the
 * words name none in full — help, a group, or unknown words. The server authorizes by it and the
 * terminal finds the command's `files` by it, so both read the same answer.
 */
export function cliCommandNamedBy<C extends { key: string }>(
  commands: readonly C[],
  argv: readonly string[],
): C | undefined {
  const words: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("-")) break;
    words.push(arg);
  }
  let found: C | undefined;
  for (const cmd of commands) {
    const segments = cmd.key.split(".");
    if (segments.length > words.length) continue;
    if (!segments.every((segment, i) => segment === words[i])) continue;
    if (found === undefined || segments.length > found.key.split(".").length) found = cmd;
  }
  return found;
}
