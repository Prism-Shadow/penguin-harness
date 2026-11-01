/**
 * The CLI command contribution contract: how a package contributes commands to the
 * `penguin` CLI, in the same two halves every other contribution has.
 *
 * A command is ONE module: a `@Module` class whose `contributes["cli.commands"]` entry is
 * its data half and whose own `register` method is its code half. The binding between the
 * two is the module table the package's build generates (`ifaces.json` beside its
 * `package.json`) — the same payload every other slot rides — and the package's default
 * export names the classes (`satisfies Plugin`), the same `Plugin` shape the server's
 * plugin host boots.
 *
 * The DATA half is read WITHOUT executing the package: the generated table's manifest of
 * the listed class carries the entry (the key `a.b.c` answers `penguin a b c ARGS`, and
 * the one-line summary in each language). Help and completion read the data half only.
 * The CLI package's own classes are read in process — its bundle is the running host, the
 * meta is already on the classes, identical keys (`Symbol.for`), no table read needed.
 *
 * The CODE half runs only when a dispatch names the class's key: the host imports the
 * package's module-list unit (a plugin's entry; the server's `./cli/serve`; its own
 * declaration in process), resolves the class whose meta owns the entry, instantiates it,
 * and calls its `register` with the program, the context and THE ENTRY AS READ — so help,
 * the registered description and the dispatch key answer one declaration, in whatever
 * language `CliContext` resolved.
 */
import type { ModuleClass } from "../kernel/decorators.js";
import { metaOf } from "../kernel/decorators.js";
import type { JsonObject } from "../kernel/json.js";

/** The manifest slot command contributions live under: `contributes: { "cli.commands": […] }`. */
export const CLI_COMMANDS_SLOT = "cli.commands";

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

/**
 * The code half a command's `register` module exports, named by the entry's `id` in the
 * package unit's register map: `{ register: { [id]: fn } }`. The map is explicit — one
 * line per entry, checkable against the generated table by eye and by the generator —
 * and the register receives the entry as the data half declared it, so the description
 * a command registers answers the same declaration help printed.
 */
export type CliCommandRegister = (
  program: CliCommandProgram,
  ctx: CliContext,
  entry: CliCommandEntry,
) => void | Promise<void>;

/** One command package's code half: a register map keyed by entry id. */
export interface CliCommandRegisters {
  register: Record<string, CliCommandRegister>;
}

/**
 * The `cli.commands` entries a @Module class collects (its data half), or undefined for
 * an undecorated class or a class without the slot. A @Module class is the COLLECTOR of
 * the declaration — pure data, no code half of its own; the code half is the register
 * map the package unit exports, keyed by entry id. Whatever the host read from the
 * package's generated table, the class's own meta answers for the same class by name —
 * two copies of this module cannot disagree, because the meta lives on the class under
 * `Symbol.for` keys.
 *
 * A class's entries also carry their manifest-declared `id`s; a package's ids and keys
 * are each unique among its valid entries (validated on discovery).
 */
export function moduleCliCommandEntries(cls: ModuleClass): readonly CliCommandEntry[] | undefined {
  const contributed = metaOf(cls)?.contributes?.[CLI_COMMANDS_SLOT];
  return Array.isArray(contributed) ? (contributed as readonly CliCommandEntry[]) : undefined;
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

/**
 * The (possibly existing) node a key's chain names on the host's program, found or built
 * one segment at a time — the one place dotted keys become nested nodes, so an
 * intermediate node a real command created is the same node help lists (`server` and
 * `server.status` from one package never collide) and a subcommand's module finds its
 * parent whether or not the parent's module ran first. Opaque in the contract: what comes
 * back is the host's program node, cast by the caller to its own program type.
 */
export function commandOnChain(program: CliCommandProgram, key: string): CliCommandProgram {
  type Node = {
    commands: { name(): string }[];
    command(name: string): { name(): string };
  };
  let node = program as unknown as Node;
  for (const segment of key.split(".")) {
    let child = node.commands.find((one) => one.name() === segment);
    if (child === undefined) child = node.command(segment);
    node = child as unknown as Node;
  }
  return node as unknown as CliCommandProgram;
}
