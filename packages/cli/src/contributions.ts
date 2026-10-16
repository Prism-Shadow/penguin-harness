/**
 * The CLI host's command contribution surface: discovery, ownership and dispatch.
 *
 * DISCOVERY collects the `cli.commands` data halves from the resolved module set — the
 * server package's declaration module (builtin, imported for its data alone), the CLI
 * package's own table, and the plugin closure of the data root, each package's generated
 * table read the way the server's plugin host reads it. Nothing here imports a command's
 * code: help and completion answer from the data halves alone, and the code half loads
 * only when a dispatch names one of its keys (registerPackageCommands).
 *
 * OWNERSHIP rules what a package may register. The key's root segment decides: the host
 * reserves help, version, exec, update, auth and plugin for itself, another package's key
 * owns its subtree unless the owner declared it open (the server package opens
 * `server.*`), and a package's own duplicate keys are malformed. An invalid registration
 * is ignored — it never reaches help or dispatch — and kept for `penguin plugin check` to
 * report. Two packages registering the SAME key is not an error: both stay, and the
 * invocation is the moment that says which one (the ambiguity report, exit code 2).
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import {
  CLI_COMMANDS_SLOT,
  CLI_REGISTER_EXPORT,
  cliCommandKeyFault,
  type CliCommandEntry,
  type CliContext,
} from "@prismshadow/penguin-core/plugin";
import { OWN_CLI_PACKAGE, ownCliEntries, registerOwnCliCommand } from "./own-commands.js";

/** The server package: the builtin whose declaration module the host reads on every start. */
export const SERVER_PACKAGE = "@prismshadow/penguin-server";

/** The root segments the host keeps for itself; no package may contribute under them. */
export const RESERVED_ROOTS = ["help", "version", "exec", "update", "auth", "plugin"] as const;

/** One valid command as the host sees it: the package that registered it, and its data. */
export interface CliDiscovered {
  /** The registering package's npm name. */
  readonly pkg: string;
  readonly entry: CliCommandEntry;
}

/** Why a registration is invalid — rendered by `penguin plugin check`. */
export type InvalidReason =
  | { readonly kind: "reserved"; readonly root: string }
  | { readonly kind: "foreign-subtree"; readonly prefix: string; readonly owner: string }
  | { readonly kind: "duplicate" }
  | { readonly kind: "malformed"; readonly detail: string };

/** An invalid registration: ignored by dispatch and help, reported by review. */
export interface InvalidRegistration {
  readonly pkg: string;
  readonly id: string;
  readonly key: string;
  readonly reason: InvalidReason;
}

/** The discovery a start collects: the valid commands, the invalid registrations, and the resolved plugin packages. */
export interface CliDiscovery {
  /** Every valid entry, in registration order (host reserved commands are not here). */
  readonly commands: readonly CliDiscovered[];
  readonly invalid: readonly InvalidRegistration[];
  /** Keys two or more packages registered — dispatched as ambiguous, listed by review. */
  readonly ambiguous: readonly string[];
  /** Every plugin package the closure resolved, its declared name → its directory (skills live there) and its entry file (the code half). */
  readonly pluginPackages: ReadonlyMap<string, { dir: string; entry: string }>;
  /** Faults that made a source unreadable (a builtin that would not load); review reports them too. */
  readonly faults: readonly string[];
}

/** A command summary in the given language — what help and completion print. */
export function cliSummary(entry: CliCommandEntry, language: "en" | "zh"): string {
  const text = entry.summary[language];
  return typeof text === "string" ? text : entry.summary.en;
}

/** The unscoped name of a package: `@scope/name` → `name`, a bare name stays itself. */
export function packageShortName(pkg: string): string {
  const at = pkg.lastIndexOf("/");
  return at === -1 ? pkg : pkg.slice(at + 1);
}

/**
 * One entry's shape, checked before anything else: a non-empty id, a dot-joined key of
 * lowercase `[a-z][a-z0-9-]*` segments, and a summary in each language.
 */
function entryFault(entry: CliCommandEntry): string | null {
  if (typeof entry.id !== "string" || entry.id === "") return "the manifest entry has no id";
  // The key is checked as the string it must already be: String(undefined) would read as
  // a command named "undefined" and slip through the segment check below.
  if (typeof entry.key !== "string" || entry.key === "") return "the manifest entry has no key";
  const keyFault = cliCommandKeyFault(entry.key);
  if (keyFault !== null) return keyFault;
  const summary = entry.summary;
  if (
    typeof summary !== "object" ||
    summary === null ||
    typeof (summary as { en?: unknown }).en !== "string" ||
    typeof (summary as { zh?: unknown }).zh !== "string"
  ) {
    return `'${entry.key}' has no summary in each language`;
  }
  return null;
}

/** The result of validation: what dispatches, and what review reports. */
export interface Validation {
  readonly commands: readonly CliDiscovered[];
  readonly invalid: readonly InvalidRegistration[];
  readonly ambiguous: readonly string[];
}

/**
 * Validates one package's raw entries together with the other packages' VALID keys:
 * malformed entries and a package's own duplicate keys drop out, reserved roots and
 * another package's closed subtree are refused, and the same key from two packages stays
 * (ambiguity is an invocation-time report, not a registration-time error). The order of
 * `commands` is the packages' registration order, entries in each package's own order.
 */
export function validateCliCommands(
  perPackage: ReadonlyMap<string, readonly CliCommandEntry[]>,
): Validation {
  const commands: CliDiscovered[] = [];
  const invalid: InvalidRegistration[] = [];
  // First pass, per package: shape, and the package's own duplicate keys.
  const shaped = new Map<string, CliCommandEntry[]>();
  for (const [pkg, entries] of perPackage) {
    const kept: CliCommandEntry[] = [];
    const byKey = new Map<string, CliCommandEntry[]>();
    for (const entry of entries) {
      const fault = entryFault(entry);
      if (fault !== null) {
        invalid.push({
          pkg,
          id: String((entry as { id?: unknown }).id ?? ""),
          key: String((entry as { key?: unknown }).key ?? ""),
          reason: { kind: "malformed", detail: fault },
        });
        continue;
      }
      const same = byKey.get(entry.key) ?? [];
      byKey.set(entry.key, same);
      same.push(entry);
    }
    for (const [key, same] of byKey) {
      if (same.length > 1) {
        // A package registering one key twice is malformed: neither registers, so `penguin
        // exec <pkg> …` stays unambiguous — it can only ever name one command of the package.
        for (const entry of same) {
          invalid.push({ pkg, id: entry.id, key, reason: { kind: "duplicate" } });
        }
        continue;
      }
      kept.push(same[0]!);
    }
    shaped.set(pkg, kept);
  }

  // The valid keys each package owns, after the per-package pass — subtree ownership reads
  // these, so a duplicate or malformed entry owns nothing.
  const owners = new Map<string, Set<string>>();
  for (const [pkg, entries] of shaped) {
    const keys = new Set<string>();
    for (const entry of entries) {
      if (RESERVED_ROOTS.includes(entry.key.split(".")[0]! as (typeof RESERVED_ROOTS)[number])) {
        invalid.push({
          pkg,
          id: entry.id,
          key: entry.key,
          reason: { kind: "reserved", root: entry.key.split(".")[0]! },
        });
        continue;
      }
      keys.add(entry.key);
    }
    owners.set(pkg, keys);
  }

  // Cross-package subtree ownership: a proper prefix another package owns must be open
  // there — under EVERY foreign owner, when more than one owns the prefix.
  for (const [pkg, entries] of shaped) {
    for (const entry of entries) {
      if (invalid.some((i) => i.pkg === pkg && i.id === entry.id)) continue; // already refused
      const segments = entry.key.split(".");
      for (let take = segments.length - 1; take >= 1; take--) {
        const prefix = segments.slice(0, take).join(".");
        const foreignOwners = [...owners.entries()].filter(
          ([owner, keys]) => owner !== pkg && keys.has(prefix),
        );
        if (foreignOwners.length === 0) continue;
        const allOpen = foreignOwners.every(
          ([owner]) =>
            shaped.get(owner)!.find((candidate) => candidate.key === prefix)?.subtree === "open",
        );
        if (!allOpen) {
          const [owner] = foreignOwners[0]!;
          invalid.push({
            pkg,
            id: entry.id,
            key: entry.key,
            reason: { kind: "foreign-subtree", prefix, owner },
          });
          break;
        }
      }
    }
  }

  // What survived, in package order; then the ambiguous keys (two packages, same key).
  for (const [pkg, entries] of shaped) {
    for (const entry of entries) {
      if (!invalid.some((i) => i.pkg === pkg && i.id === entry.id)) commands.push({ pkg, entry });
    }
  }
  const byKey = new Map<string, Set<string>>();
  for (const cmd of commands) {
    const packages = byKey.get(cmd.entry.key) ?? new Set<string>();
    packages.add(cmd.pkg);
    byKey.set(cmd.entry.key, packages);
  }
  const ambiguous = [...byKey.entries()].filter(([, pkgs]) => pkgs.size > 1).map(([key]) => key);
  return { commands, invalid, ambiguous };
}

/** Whether a key matches argv: the key's segments are argv's leading segments. */
export function keyMatches(key: string, argv: readonly string[]): boolean {
  const segments = key.split(".");
  if (argv.length < segments.length) return false;
  return segments.every((segment, index) => argv[index] === segment);
}

/** Every valid entry whose key matches argv (a key that is a PREFIX of argv matches too — that overlap is the ambiguity case). */
export function matchingCommands(
  commands: readonly CliDiscovered[],
  argv: readonly string[],
): CliDiscovered[] {
  return commands.filter((cmd) => keyMatches(cmd.entry.key, argv));
}

/** The packages among the matches — the count decides: one executes, two or more are ambiguous. */
export function matchingPackages(matches: readonly CliDiscovered[]): string[] {
  const pkgs: string[] = [];
  for (const match of matches) if (!pkgs.includes(match.pkg)) pkgs.push(match.pkg);
  return pkgs;
}

/**
 * Collects the `cli.commands` data halves from the resolved module set. The builtin
 * server package's declarations import (data alone — the module pulls nothing but the
 * kernel decorators); the CLI's own table is read in-process; the plugin closure is read
 * from the data root with the server's own resolver, each package's generated table
 * imported NEVER — a broken plugin cannot break help. An unreadable source is a fault,
 * not a failure: the rest still dispatches, and review reports it.
 */
/**
 * A plugin's identity for the CLI's surfaces: the name its own package.json declares —
 * what `penguin exec` documents, and what a path-listed dev-checkout plugin still has —
 * falling back to the specifier it was listed by when the package declares no name.
 */
async function packageNameAt(manifestPath: string, fallback: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: unknown };
    return typeof pkg.name === "string" && pkg.name !== "" ? pkg.name : fallback;
  } catch {
    return fallback; // an unreadable manifest leaves the specifier, which still dispatches
  }
}

export async function discoverCliCommands(opts: { root: string }): Promise<CliDiscovery> {
  const perPackage = new Map<string, CliCommandEntry[]>();
  const pluginPackages = new Map<string, { dir: string; entry: string }>();
  const faults: string[] = [];

  perPackage.set(OWN_CLI_PACKAGE, ownCliEntries());

  try {
    const { serverCliCommands } = await import("@prismshadow/penguin-server/cli/manifest");
    perPackage.set(SERVER_PACKAGE, [...serverCliCommands()]);
  } catch (err) {
    // A server package older than this contribution point (an install mid-upgrade) ships
    // no commands: the host still comes up, the missing group is review's to report.
    faults.push(
      `the server package's command declarations could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  try {
    const { pluginBases, committedAssetsDir, readPluginClosure, resolvePlugin, readPackageTable } =
      await import("@prismshadow/penguin-server/plugin/loader");
    const bases = pluginBases(opts.root, await committedAssetsDir(opts.root));
    for (const specifier of await readPluginClosure(opts.root)) {
      const resolved = resolvePlugin(specifier, bases);
      if (resolved === null) continue; // unresolvable here: the server's own load reports it
      const table = await readPackageTable(resolved.file);
      if (table === null) continue;
      const pkg = await packageNameAt(table.where, specifier);
      // Every resolved package, contributing or not: review scans a non-contributing
      // plugin's skills just the same, and the entry is what a dispatch would import.
      pluginPackages.set(pkg, {
        dir: path.dirname(table.where),
        entry: resolved.file,
      });
      const entries: CliCommandEntry[] = [];
      for (const manifest of Object.values(table.manifests)) {
        const contributed = manifest.contributes?.[CLI_COMMANDS_SLOT];
        if (Array.isArray(contributed)) {
          entries.push(...(contributed as unknown as CliCommandEntry[]));
        }
      }
      if (entries.length > 0) perPackage.set(pkg, entries);
    }
  } catch (err) {
    faults.push(
      `the plugin closure could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const validation = validateCliCommands(perPackage);
  return {
    commands: validation.commands,
    invalid: validation.invalid,
    ambiguous: validation.ambiguous,
    pluginPackages,
    faults,
  };
}

/**
 * Loads one package's code half and registers it: the lazy command modules for the CLI's
 * own keys (`undefined` = every one of them — what `penguin exec <own package>` with no
 * further words registers), the server package's register, or the plugin's entry — the
 * contract's `registerCliCommands`. Called only on a dispatch hit, so a package's code
 * first runs when one of its commands is actually named.
 */
export async function registerPackageCommands(
  discovery: CliDiscovery,
  pkg: string,
  key: string | undefined,
  program: Command,
  ctx: CliContext,
): Promise<void> {
  if (pkg === OWN_CLI_PACKAGE) {
    await registerOwnCliCommand(key, program, ctx);
    return;
  }
  if (pkg === SERVER_PACKAGE) {
    const { registerCliCommands } = await import("@prismshadow/penguin-server/cli/serve");
    registerCliCommands(program, ctx);
    return;
  }
  const entry = discovery.pluginPackages.get(pkg)?.entry;
  if (entry === undefined) throw new Error(`no entry file resolved for ${pkg}`);
  const mod = (await import(pathToFileURL(entry).href)) as Record<string, unknown>;
  const register = mod[CLI_REGISTER_EXPORT];
  if (typeof register !== "function") {
    throw new Error(`${pkg} contributes commands but exports no ${CLI_REGISTER_EXPORT}`);
  }
  await (register as (program: Command, ctx: CliContext) => void | Promise<void>)(program, ctx);
}
