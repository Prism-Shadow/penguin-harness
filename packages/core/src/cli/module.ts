/**
 * A shipped plugin's CLI module: what a plugin package's `./cli` subpath default-exports when
 * its commands run in the CLI's own process. The CLI's build lists every plugin dependency of
 * the CLI package (`@penguinharness/*`) that exports `./cli`; at startup the CLI boots each
 * listed module in a tree of its own and adds its commands after the CLI's own.
 *
 * The command classes are written like any other command: a `@Component` whose `contributes`
 * entry under `ShippedCommandsModule.commands` (the CLI's slot for these) is the data half — a
 * `CliCommandData` — and whose `@Bind(entry.id)` field is the `CliCommandCode`. The host pairs
 * each class with its manifest from the module's own table, so a module carries the table its
 * build generated over its CLI sources; and the register receives the host's bundle with the
 * module's own message groups added, in the locale the host resolved.
 *
 * This is the build-time path, fixed by the CLI's build. A plugin installed on a server later
 * contributes commands to the server instead (`PluginCliCommandsProvider.commands`), which the
 * server runs: the CLI never loads plugin code at runtime.
 */
import type { ModuleClass } from "../kernel/decorators.js";

/** The generated table a module's classes are booted against: its interfaces, types and manifests. */
export interface CliModuleTable {
  readonly ifaces: object;
  readonly types: object;
  readonly modules: object;
}

/** What a shipped plugin's `./cli` subpath default-exports. */
export interface CliModule {
  /** The command classes: `@Component`s contributing to `ShippedCommandsModule.commands`. */
  readonly modules: readonly ModuleClass[];
  /** The package's own generated table over its CLI sources (not the server table of its `.` entry). */
  readonly ifaces: CliModuleTable;
  /**
   * The message groups the commands read, per language. The host adds the invocation's to the
   * bundle a register receives; a group the host's bundle already has stays the host's.
   */
  readonly messages?: { readonly en: object; readonly zh: object };
}
