/**
 * The CLI's own commands, as contributions: one `@Component` per command, whose
 * `contributes["CliCommandsModule.commands"]` entry is the command's data half (its key and
 * one-line summary) and whose `@Bind(entry.id)` field is its code half. `CliCommandsModule`
 * owns the slot and collects them.
 *
 * The component classes themselves live next to the code they register — each command file
 * in `commands/` carries its own class, and the server package contributes its resource
 * commands the same way. `cli-commands.gen.ts` is the generated table of those classes: it
 * is produced from the source scan, so there is no central list to maintain by hand.
 *
 * This table is fixed by the build. The CLI bundle a push carries is the same code that
 * starts the server, so the CLI process and the server process see the same commands. A
 * plugin's commands are not here: they are contributions to the server's tree, and the CLI
 * lists and runs them through the server (plugin-cli-commands.ts).
 *
 * The host boots this module once per invocation, turns each key into its command node,
 * writes the summary as the node's description, then calls the bound register with that
 * node. A register never names its own path.
 */
import {
  Bind,
  bootModules,
  Component,
  Interface,
  moduleDefOf,
  Module,
  Provide,
} from "@prismshadow/penguin-core/kernel";
import type {
  ClassCtx,
  IfaceTable,
  ManifestTable,
  Resources,
  Slot,
} from "@prismshadow/penguin-core/kernel";
import type {
  CliCommandCode,
  CliCommandData,
  CliCommandSummary,
} from "@prismshadow/penguin-core/cli";
import type { Messages } from "@prismshadow/penguin-server/cli";
/**
 * The generated component table: the CLI's own command classes (by relative path) plus the
 * five resource commands contributed by the server package (through its `cli` subpath).
 */
import { cliCommandComponents } from "./cli-commands.gen.js";
import table from "./ifaces.json" with { type: "json" };

/** One collected command: its data half and the code half its class bound. */
export interface BuiltinCommand {
  readonly id: string;
  readonly key: string;
  readonly summary: CliCommandSummary;
  readonly code: CliCommandCode<Messages>;
}

/** The collector's face: the CLI's commands, in contribution order (the order help lists them in). */
@Interface()
export abstract class CliCommands {
  abstract list(): readonly BuiltinCommand[];
}

/** The slot `CliCommandsModule` owns: a command's key and summary, and the code half it binds. */
export interface CliCommandsSlots {
  commands: Slot<CliCommandData, CliCommandCode<Messages>>;
}

/** Owns the `commands` slot; its contributors are the command classes of the generated table. */
@Module()
export class CliCommandsModule {
  @Provide() cliCommands!: CliCommands;
  setup({ contributions }: ClassCtx) {
    // The kernel checked each entry against the slot's data type at boot, and resolved
    // every code half by its id.
    const commands: BuiltinCommand[] = (contributions.commands ?? []).map((c) => ({
      id: c.id,
      key: c.data.key as string,
      summary: c.data.summary as unknown as CliCommandSummary,
      code: c.code as CliCommandCode<Messages>,
    }));
    this.cliCommands = { list: () => commands };
  }
}

/** The commands hold no live resources, so the registry holds nothing. */
const noResources: Resources = {
  register: () => () => {},
  claim: () => undefined,
};

/** Boots `CliCommandsModule` against this package's generated table and returns what it collected. */
export async function bootBuiltinCommands(): Promise<readonly BuiltinCommand[]> {
  const ifaces = table as unknown as IfaceTable & { modules: ManifestTable };
  const root = moduleDefOf(CliCommandsModule, {
    manifests: ifaces.modules,
    extra: cliCommandComponents.map((c) => moduleDefOf(c, { manifests: ifaces.modules })),
  });
  const tree = await bootModules(root, { ifaces, resources: noResources });
  try {
    return tree.api<CliCommands>("CliCommandsModule", "cliCommands").list();
  } finally {
    tree.dispose();
  }
}
