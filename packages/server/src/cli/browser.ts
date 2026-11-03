/**
 * The server's browser CLI command, as a contribution: one `@Component` whose
 * `contributes["BrowserModule.commands"]` entry is the command's data half (its key and one-line
 * summary) and whose `@Bind(entry.id)` field is its code half. `BrowserModule` owns the slot and
 * collects it — the command moved here from the CLI package with its output rendering and
 * message file, because the browser it drives lives in the server's process.
 *
 * The host boots this module once per invocation, turns the key into its command node, writes
 * the summary as the node's description, then calls the bound register with that node.
 */
import { Bind, Component, Interface, Module, Provide } from "@prismshadow/penguin-core/kernel";
import type {
  ClassCtx,
  IfaceTable,
  ManifestTable,
  Resources,
  Slot,
} from "@prismshadow/penguin-core/kernel";
import { bootModules, moduleDefOf } from "@prismshadow/penguin-core/kernel";
import type {
  CliCommandCode,
  CliCommandData,
  CliCommandProgram,
  CliCommandSummary,
} from "@prismshadow/penguin-core/cli";
import type { Messages } from "./i18n.js";
import type { Command } from "commander";
import table from "../ifaces.json" with { type: "json" };
import { registerBrowserCommand } from "./commands/browser.js";

/** The node the host located for a key, typed with this package's commander. */
const node = (command: CliCommandProgram): Command => command as Command;

/** `penguin browser`. */
@Component({
  contributes: {
    "BrowserModule.commands": [
      {
        id: "browser.cli",
        key: "browser",
        summary: {
          en: "Drive the agent browser: status, tabs, page actions, screenshots, CDP",
          zh: "驱动 Agent 浏览器：状态、标签页、页面操作、截图、CDP",
        } satisfies CliCommandSummary,
      },
    ],
  },
})
export class BrowserCommand {
  @Bind("browser.cli") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerBrowserCommand(node(command), ctx.messages);
      },
    };
  }
}

/** One collected command: its data half and the code half its class bound. */
export interface BrowserCommandEntry {
  readonly id: string;
  readonly key: string;
  readonly summary: CliCommandSummary;
  readonly code: CliCommandCode;
}

/** The collector's face: the browser module's commands, in contribution order. */
@Interface()
export abstract class BrowserCommands {
  abstract list(): readonly BrowserCommandEntry[];
}

/** The slot `BrowserModule` owns: a command's key and summary, and the code half it binds. */
export interface BrowserCommandsSlots {
  commands: Slot<CliCommandData, CliCommandCode<Messages>>;
}

/** Owns the `commands` slot; its children are the browser's commands. */
@Module({
  children: [BrowserCommand],
})
export class BrowserModule {
  @Provide() browserCommands!: BrowserCommands;
  setup({ contributions }: ClassCtx) {
    // The kernel checked each entry against the slot's data type at boot, and resolved
    // every code half by its id.
    const commands: BrowserCommandEntry[] = (contributions.commands ?? []).map((c) => ({
      id: c.id,
      key: c.data.key as string,
      summary: c.data.summary as unknown as CliCommandSummary,
      code: c.code as CliCommandCode,
    }));
    this.browserCommands = { list: () => commands };
  }
}

/** The commands hold no live resources, so the registry holds nothing. */
const noResources: Resources = {
  register: () => () => {},
  claim: () => undefined,
};

/** Boots `BrowserModule` against this package's generated table and returns what it collected. */
export async function bootBrowserCommands(): Promise<readonly BrowserCommandEntry[]> {
  const ifaces = table as unknown as IfaceTable & { modules: ManifestTable };
  const root = moduleDefOf(BrowserModule, { manifests: ifaces.modules });
  const tree = await bootModules(root, { ifaces, resources: noResources });
  try {
    return tree.api<BrowserCommands>("BrowserModule", "browserCommands").list();
  } finally {
    tree.dispose();
  }
}
