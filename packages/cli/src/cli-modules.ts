/**
 * The commands of the CLI modules this build ships. A shipped plugin's `./cli` export (core's
 * `CliModule`) carries command classes, the table its build generated for them and its own
 * message groups; the CLI boots each module once per invocation, in a tree of its own, and
 * adds its commands after the CLI's own.
 *
 * `ShippedCommandsModule` owns the slot those classes contribute to. Per module it is the root
 * of the tree, the module's classes are extra children, each paired with its manifest from the
 * module's own table, and the tree is checked against the CLI's table with the module's folded
 * in — the CLI's entries standing on a key both carry, as the server folds a plugin's table. The
 * CLI's own commands never come through here: they contribute to `CliCommandsModule.commands`,
 * whose classes the generated `cli-commands.gen.ts` lists, and a shipped command contributes to
 * this slot instead, so neither list picks up the other's.
 *
 * What a module adds is checked before it reaches the program; what fails is left out with one
 * warning on stderr, and the rest of the CLI runs. A module that does not boot contributes
 * nothing. A command whose key is malformed, or whose first word is already a command — the
 * CLI's own, or one an earlier module added — is dropped: a module adds commands, it never
 * extends or replaces one the CLI has. Each register receives the host's bundle with the
 * module's message groups for the invocation's locale added, the host's groups standing.
 *
 * Which modules ship is fixed by the build: `cli-modules.gen.ts` lists every plugin dependency
 * of this package (`@penguinharness/*`) whose package.json exports `./cli`
 * (scripts/gen-cli-modules.mjs), and the build bundles them. The CLI never loads plugin code at runtime — a plugin installed on a server later is the
 * server's to run (plugin-cli-commands.ts).
 */
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
import type { BuiltinCommand } from "./cli-commands.js";
/** The generated list: every plugin dependency of this package that exports `./cli`, by name. */
import { shippedCliModules } from "./cli-modules.gen.js";
import table from "./ifaces.json" with { type: "json" };

/** A CLI module the build ships, with the package it came from (its warnings name it). */
export interface ShippedCliModule {
  readonly package: string;
  readonly module: CliModule;
}

/**
 * The CLI modules this build ships: the shipped plugins' (generated, in package-name order), then
 * `penguin browser`'s, which lives in the server package until it moves into its plugin — the
 * generated list picks it up there, and this entry goes.
 */
export const SHIPPED_CLI_MODULES: readonly ShippedCliModule[] = [
  ...shippedCliModules,
  { package: "@prismshadow/penguin-server", module: browserCliModule },
];

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

/** Owns the `commands` slot a shipped module's classes contribute to; the root of each module's tree. */
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
async function bootModule(module: CliModule): Promise<readonly ShippedCommand[]> {
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

/** The bundle a module's register receives: the host's, with the module's groups for its locale added. */
function bundleFor(module: CliModule, host: CliHostMessages): CliHostMessages {
  const own = host.language === "zh" ? module.messages?.zh : module.messages?.en;
  return own === undefined ? host : { ...own, ...host };
}

const warn = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/**
 * The commands of `modules`, ready for the program after `own` (the commands already on it):
 * each module booted alone, its commands checked, and each code half wrapped so its register
 * receives the module's messages beside the host's.
 */
export async function bootShippedCommands(
  modules: readonly ShippedCliModule[],
  own: readonly { readonly key: string }[],
  t: Messages,
): Promise<readonly BuiltinCommand[]> {
  const taken = new Set(own.map((command) => command.key.split(".")[0]!));
  const out: BuiltinCommand[] = [];
  for (const { package: pkg, module } of modules) {
    let commands: readonly ShippedCommand[];
    try {
      commands = await bootModule(module);
    } catch (err) {
      warn(t.cliModule.failed(pkg, err instanceof Error ? err.message : String(err)));
      continue;
    }
    const keys = new Set<string>();
    for (const command of commands) {
      const head = command.key.split(".")[0]!;
      const clash = taken.has(head) ? head : keys.has(command.key) ? command.key : null;
      const reason =
        cliCommandKeyFault(command.key) ?? (clash === null ? null : t.cliModule.taken(clash));
      if (reason !== null) {
        warn(t.cliModule.dropped(pkg, command.key, reason));
        continue;
      }
      keys.add(command.key);
      out.push({
        id: command.id,
        key: command.key,
        summary: command.summary,
        code: {
          register: (node, ctx) =>
            command.code.register(node, { ...ctx, messages: bundleFor(module, ctx.messages) }),
        },
      });
    }
    // A module's own commands may share a first word; the next module's may not.
    for (const key of keys) taken.add(key.split(".")[0]!);
  }
  return out;
}
