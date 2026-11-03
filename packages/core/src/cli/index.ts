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

/** A command's one-line summary, one per language — what help prints. */
export interface CliCommandSummary {
  en: string;
  zh: string;
}

/** The data half of one command: the slot's data type. */
export interface CliCommandData {
  /** `a.b.c` — the leading argv segments this command answers; lowercase `[a-z][a-z0-9-]*` segments joined by dots. */
  key: string;
  /** The one-line summary help prints, per language. */
  summary: CliCommandSummary;
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

/**
 * What a command's code half may use from the host that runs it: the host's message
 * bundle, resolved once per invocation. The bundle's shape beyond `language` is the
 * host's to define — a contributor types it with the host whose slot it contributes to.
 */
export interface CliCommandContext<M extends CliCommandMessages = CliCommandMessages> {
  messages: M;
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
