/**
 * `penguin browser` as a CLI module — the shape a shipped plugin's `./cli` export has
 * (rfcs/PRFC-0024-cli-modules.md, "Shipped plugins' CLI modules"). One `@Component` contributes
 * the command to the CLI's `ShippedCommandsModule.commands`: the entry is its data half (its key
 * and one-line summary), the `@Bind(entry.id)` field its code half. `browserCliModule` hands the
 * CLI the class, the table it boots against and the browser's own message group.
 *
 * The module still lives in the server package, and the CLI lists it by hand after the shipped
 * plugins' modules. Its code reaches the host only through the core contract and the CLI face
 * (`@prismshadow/penguin-library-cli`), so it moves into its plugin as it is; there the package's
 * own CLI table stands in for this package's, and the CLI's generated list picks it up.
 */
import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type {
  CliCommandCode,
  CliCommandProgram,
  CliCommandSummary,
  CliModule,
} from "@prismshadow/penguin-core/cli";
import type { Command } from "commander";
import table from "../ifaces.json" with { type: "json" };
import { registerBrowserCommand } from "./commands/browser.js";
import { browserEn, browserZh, type BrowserMessages } from "./commands/browser.messages.js";

/** The node the host located for a key, typed with this package's commander. */
const node = (command: CliCommandProgram): Command => command as Command;

/** `penguin browser`. */
@Component({
  contributes: {
    "ShippedCommandsModule.commands": [
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
  @Bind("browser.cli") command!: CliCommandCode<BrowserMessages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerBrowserCommand(node(command), ctx.messages);
      },
    };
  }
}

/** The browser's CLI module: the command class, the table it is booted against, its messages. */
export const browserCliModule = {
  modules: [BrowserCommand],
  ifaces: table,
  messages: { en: browserEn, zh: browserZh },
} satisfies CliModule;
