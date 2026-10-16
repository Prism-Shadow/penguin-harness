/**
 * The CLI command contribution contract: how a package contributes commands to the
 * `penguin` CLI, in the same two halves every other contribution has.
 *
 * The DATA half is manifest data — entries under the `cli.commands` slot of a module's
 * `contributes`: the key a command is dispatched by (`a.b.c` answers `penguin a b c ARGS`)
 * and its one-line summary in each language. It is read WITHOUT executing the package:
 * a plugin's table is read the way the server's plugin host reads it, a builtin package's
 * declaration module is imported directly, and nothing else loads until a dispatch names
 * one of the package's keys. Help and completion read the data half only.
 *
 * The CODE half is the package entry's `registerCliCommands` export, imported only on a
 * dispatch hit. It registers the package's commands on the host's program (commander's
 * `Command`) and does nothing else at registration time; everything a command may then
 * reach for lives on the `CliContext` it is handed — the one host interface a contributor
 * may depend on.
 */
import type { JsonObject } from "../kernel/json.js";

/** The manifest slot command contributions live under: `contributes: { "cli.commands": […] }`. */
export const CLI_COMMANDS_SLOT = "cli.commands";

/** The export the CLI looks for on a package's entry when a dispatch names one of its keys. */
export const CLI_REGISTER_EXPORT = "registerCliCommands";

/** A command's one-line summary, one per language — what help and completion print. */
export interface CliCommandSummary {
  en: string;
  zh: string;
}

/**
 * The data half of one contributed command. In a module's `contributes` table each entry
 * also carries the manifest's own `id`; a package's ids and keys are each unique among its
 * valid entries.
 */
export interface CliCommandContribution {
  /** The contribution's id, unique within the package (the manifest entry's `id`). */
  id: string;
  /** `a.b.c` — the leading argv segments this command answers (`penguin a b c ARGS`); lowercase segments, `[a-z][a-z0-9-]*`, joined by dots. */
  key: string;
  /** The one-line summary shown by help and completion, per language. */
  summary: CliCommandSummary;
  /**
   * Declares this key's subtree open to other packages' contributions (the owner of
   * `server` opens `server.*`). Absent means closed: a registration under another
   * package's key is invalid — ignored by dispatch and reported by review.
   */
  subtree?: "open";
}

/** A contributed command's summary data as it appears in a manifest: the entry plus its id. */
export type CliCommandEntry = CliCommandContribution & JsonObject;

/**
 * The host's command program — commander's `Command`. Opaque in the contract: the host
 * passes the real object, and a contributor types the parameter with the commander its
 * own package declares, so the contract pins no commander version.
 */
export type CliCommandProgram = object;

/** One JSON request against the resolved server; auth is the host's — a contributor never handles a token. */
export interface CliApiClient {
  /** The resolved connection's base URL (no trailing slash). */
  readonly baseUrl: string;
  /** Performs one JSON request and returns its decoded body; a non-2xx answer throws. */
  request(method: string, path: string, body?: unknown): Promise<unknown>;
}

/** The remembered login, as a contributor may read it — never the token itself. */
export interface CliLoginSession {
  readonly server: string;
  readonly userId: string;
  readonly expiresAt?: string;
}

/**
 * Everything a contributed command may reach on the host: the resolved language, the
 * invocation's data root, the output and table helpers, the API client (connection
 * resolution, auto-start included) and the remembered login session. The one host
 * interface a contributor may depend on.
 */
export interface CliContext {
  /** The resolved UI language (`PENGUIN_LANG`, defaulting to English). */
  language: "en" | "zh";
  /** This invocation's data root, resolved `--root` > `PENGUIN_HOME` > `~/.penguin/data`. */
  root: string;
  /** Writes one line to stdout. */
  write(text: string): void;
  /** Writes one line to stderr. */
  writeErr(text: string): void;
  /** Renders the fixed-width table the CLI's own listing commands use. */
  renderTable(header: string[], rows: string[][]): string;
  /** Resolves the server connection (attaching to a live one, else auto-starting) and returns the request client. */
  connect(): Promise<CliApiClient>;
  /** The remembered login session of this data root, or null when none is remembered. */
  readSession(): CliLoginSession | null;
}

/** The code half: registers the package's commands on the host's program. */
export type CliCommandRegister = (
  program: CliCommandProgram,
  ctx: CliContext,
) => void | Promise<void>;

/** A package's entry, as the CLI imports it on a dispatch hit. */
export interface CliCommandPackage {
  registerCliCommands: CliCommandRegister;
}

/** Whether a key is shaped the way dispatch reads it: lowercase `[a-z][a-z0-9-]*` segments, joined by dots. */
export function cliCommandKeyFault(key: string): string | null {
  if (key === "") return "the key is empty";
  const segment = /^[a-z][a-z0-9-]*$/;
  for (const part of key.split(".")) {
    if (!segment.test(part))
      return `'${key}' is not a command path: dot-joined [a-z][a-z0-9-]* segments`;
  }
  return null;
}
