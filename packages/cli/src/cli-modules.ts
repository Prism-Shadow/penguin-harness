/**
 * The commands of the CLI modules this build ships. A shipped plugin's `./cli` export (core's
 * `CliModule`) carries command classes, the table its build generated for them and its own
 * message groups; the CLI boots each module once per invocation, in a tree of its own, and adds
 * its commands after the CLI's own.
 *
 * `ShippedCommandsModule` owns the slot those classes contribute to. Per module it is the root
 * of the tree, the module's classes are extra children, each paired with its manifest from the
 * module's own table, and the tree is checked against the CLI's table with the module's folded
 * in — the CLI's entries standing on a key both carry, as the server folds a plugin's table. The
 * CLI's own commands never come through here: they contribute to `CliCommandsModule.commands`,
 * whose classes the generated `cli-commands.gen.ts` lists, and a shipped command contributes to
 * this slot instead, so neither list picks up the other's.
 *
 * Nothing a shipped module does can stop the CLI. What fails is left out with one warning on
 * stderr naming the module's package, and the rest of the CLI runs:
 *
 * - a module whose evaluation throws (each is imported on its own, when its turn comes) or whose
 *   classes do not boot contributes nothing;
 * - a command whose key is malformed, repeats a key of its module, or names at any level a command
 *   or alias already on the program — the CLI's own, or one an earlier module added — is dropped
 *   before it reaches the program: a module adds commands, it never extends or replaces one;
 * - a command whose register throws is taken off the program again, with the empty groups its
 *   key created for it.
 *
 * Each register receives the host's bundle with the module's message groups for the invocation's
 * locale added. A group the host already has stays the host's, with a warning.
 *
 * Which modules ship is fixed by the build: `cli-modules.gen.ts` lists every plugin dependency of
 * this package (`@penguinharness/*`) whose package.json exports `./cli`
 * (scripts/gen-cli-modules.mjs), and the build bundles them. The CLI never loads plugin code at
 * runtime — a plugin installed on a server later is the server's to run (plugin-cli-commands.ts).
 */
import type { Command } from "commander";
import {
  Interface,
  Module,
  Provide,
  bootModules,
  moduleDefOf,
} from "@prismshadow/penguin-core/kernel";
import type {
  ClassCtx,
  IfaceTable,
  ManifestTable,
  Resources,
  Slot,
} from "@prismshadow/penguin-core/kernel";
import { cliCommandKeyFault } from "@prismshadow/penguin-core/cli";
import type {
  CliCommandCode,
  CliCommandData,
  CliCommandSummary,
  CliModule,
} from "@prismshadow/penguin-core/cli";
import { browserCliModule } from "@prismshadow/penguin-server/cli";
import type { CliHostMessages, Messages } from "@prismshadow/penguin-server/cli";
/** The generated list: every plugin dependency of this package that exports `./cli`, by name. */
import { shippedCliModules as generated } from "./cli-modules.gen.js";
import table from "./ifaces.json" with { type: "json" };

/** A CLI module the build ships: the package it came from (its warnings name it), and its import. */
export interface ShippedCliModule {
  readonly package: string;
  /** Evaluates the module's `./cli` export; a throw there is that module's alone. */
  readonly load: () => Promise<CliModule>;
}

/**
 * The CLI modules this build ships: the shipped plugins' (generated, in package-name order), then
 * `penguin browser`'s, which lives in the server package until it moves into its plugin — the
 * generated list picks it up there, and this entry goes.
 */
export function shippedCliModules(): readonly ShippedCliModule[] {
  return [
    ...generated,
    { package: "@prismshadow/penguin-server", load: async () => browserCliModule },
  ];
}

/** One collected command: its data half and the code half its class bound. */
export interface ShippedCommand {
  readonly id: string;
  readonly key: string;
  readonly summary: CliCommandSummary;
  readonly code: CliCommandCode;
}

/** The collector's face: one module's commands, in contribution order. */
@Interface()
export abstract class ShippedCommands {
  abstract list(): readonly ShippedCommand[];
}

/** The slot `ShippedCommandsModule` owns: a command's key and summary, and the code half it binds. */
export interface ShippedCommandsSlots {
  commands: Slot<CliCommandData, CliCommandCode>;
}

/** Owns the slot a shipped module's classes contribute to: the root of each module's tree. */
@Module()
export class ShippedCommandsModule {
  @Provide() shippedCommands!: ShippedCommands;
  setup({ contributions }: ClassCtx) {
    // The kernel checked each entry against the slot's data type at boot, and resolved
    // every code half by its id.
    const commands: ShippedCommand[] = (contributions.commands ?? []).map((c) => ({
      id: c.id,
      key: c.data.key as string,
      summary: c.data.summary as unknown as CliCommandSummary,
      code: c.code as CliCommandCode,
    }));
    this.shippedCommands = { list: () => commands };
  }
}

type Table = IfaceTable & { modules: ManifestTable };

/** The commands hold no live resources, so the registry holds nothing. */
const noResources: Resources = {
  register: () => () => {},
  claim: () => undefined,
};

/** Boots one module in a tree of its own and returns what its classes contributed. */
export async function bootCliModule(module: CliModule): Promise<readonly ShippedCommand[]> {
  const host = table as unknown as Table;
  // An unbuilt package's table may be empty: its classes then fail as missing from it, by name.
  const own = module.ifaces as Partial<Table>;
  const root = moduleDefOf(ShippedCommandsModule, {
    manifests: host.modules,
    extra: module.modules.map((cls) => moduleDefOf(cls, { manifests: own.modules ?? {} })),
  });
  const ifaces: IfaceTable = {
    ifaces: { ...own.ifaces, ...host.ifaces },
    types: { ...own.types, ...host.types },
  };
  const tree = await bootModules(root, { ifaces, resources: noResources });
  try {
    return tree.api<ShippedCommands>("ShippedCommandsModule", "shippedCommands").list();
  } finally {
    tree.dispose();
  }
}

/** A command as the CLI's loop takes it: its key, its summary and the code half it registers. */
interface ProgramCommand {
  readonly key: string;
  readonly summary: CliCommandSummary;
  readonly code: CliCommandCode<Messages>;
}

const warn = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A child of `parent` answering to `word`, by name or by alias. */
const answering = (parent: Command, word: string): Command | undefined =>
  parent.commands.find((c) => c.name() === word || c.aliases().includes(word));

/**
 * The segment of `key` that names a command or alias already on the program where the key would
 * put a new one, or null. At the top, `help` counts as taken (commander's own), and a first word
 * one of `mine` (this module's own top-level commands) may be extended.
 */
function clashOf(program: Command, key: string, mine: ReadonlySet<string>): string | null {
  const [head, ...rest] = key.split(".");
  if (!mine.has(head!) && (head === "help" || answering(program, head!) !== undefined))
    return head!;
  let at = answering(program, head!);
  for (const segment of rest) {
    if (at === undefined) return null;
    const byName = at.commands.find((c) => c.name() === segment);
    if (byName === undefined && answering(at, segment) !== undefined) return segment;
    at = byName;
  }
  return null;
}

/** Takes a node off the program, with each group above it that was made for it and is now empty. */
function unregister(node: Command): void {
  let at: Command = node;
  for (let parent = at.parent; parent !== null; parent = at.parent) {
    const siblings = parent.commands as Command[];
    siblings.splice(siblings.indexOf(at), 1);
    // A group commandAt made on the way has no description and, once emptied, nothing left.
    if (parent.parent === null || parent.commands.length > 0 || parent.description() !== "") break;
    at = parent;
  }
}

/** The bundle a module's register receives: the host's, with the module's groups for its locale added. */
function bundleFor(module: CliModule, host: CliHostMessages): CliHostMessages {
  const own = host.language === "zh" ? module.messages?.zh : module.messages?.en;
  return own === undefined ? host : { ...own, ...host };
}

/** The module's message groups that the host's bundle also has (the host's stand). */
function sharedGroups(module: CliModule, host: Messages): string[] {
  const names = new Set([
    ...Object.keys(module.messages?.en ?? {}),
    ...Object.keys(module.messages?.zh ?? {}),
  ]);
  return [...names].filter((name) => Object.hasOwn(host, name));
}

/**
 * The commands for the program, in order: `own` (the CLI's and the server package's), then each
 * shipped module's. The caller registers each command before asking for the next, so every
 * shipped command is checked against the program as it then stands — names and aliases of
 * everything registered before it. Each shipped code half is wrapped: its register receives the
 * module's messages beside the host's, and a throw from it takes its node off the program.
 */
export async function* withShippedCommands(
  own: readonly ProgramCommand[],
  program: Command,
  t: Messages,
  modules: readonly ShippedCliModule[] = shippedCliModules(),
): AsyncGenerator<ProgramCommand> {
  yield* own;
  for (const { package: pkg, load } of modules) {
    let module: CliModule;
    let commands: readonly ShippedCommand[];
    try {
      module = await load();
      commands = await bootCliModule(module);
    } catch (err) {
      warn(t.cliModule.failed(pkg, errorText(err)));
      continue;
    }
    for (const group of sharedGroups(module, t)) warn(t.cliModule.groupTaken(pkg, group));
    const mine = new Set<string>();
    const keys = new Set<string>();
    for (const command of commands) {
      const clash = keys.has(command.key) ? command.key : clashOf(program, command.key, mine);
      const reason =
        cliCommandKeyFault(command.key) ?? (clash === null ? null : t.cliModule.taken(clash));
      if (reason !== null) {
        warn(t.cliModule.dropped(pkg, command.key, reason));
        continue;
      }
      keys.add(command.key);
      yield {
        key: command.key,
        summary: command.summary,
        code: {
          register: (node, ctx) => {
            try {
              command.code.register(node, { ...ctx, messages: bundleFor(module, ctx.messages) });
            } catch (err) {
              unregister(node as unknown as Command);
              warn(t.cliModule.dropped(pkg, command.key, errorText(err)));
            }
          },
        },
      };
      // Registered by now: a first word on the program that was not taken before is this module's.
      const head = command.key.split(".")[0]!;
      if (answering(program, head) !== undefined) mine.add(head);
    }
  }
}
