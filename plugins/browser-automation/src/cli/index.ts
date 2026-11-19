/**
 * `penguin browser` — the plugin's CLI half (`./cli`), the CLI module the CLI's build compiles in
 * (rfcs/PRFC-0024-cli-modules.md, "Shipped plugins' CLI modules"). One `@Component` contributes the
 * command to the CLI's `ShippedCommandsModule.commands`: the entry is its data half (its key and
 * one-line summary), the `@Bind(entry.id)` field its code half. The default export hands the CLI
 * the class, the table it boots against (`cli-ifaces.json`, generated over src/cli alone, so the
 * server table never carries this module) and the browser's own message group.
 *
 * The code reaches the host only through the core contract, the CLI face
 * (`@prismshadow/penguin-library-cli`) and the API's types (`@prismshadow/penguin-server/api`,
 * erased), and runs in the caller's process: stdin, `--file`, `--save` and `-o` read and write
 * the caller's directory.
 */
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type {
  CliCommandCode,
  CliCommandProgram,
  CliCommandSummary,
  CliModule,
} from "@prismshadow/penguin-core/cli";
import type { Command } from "commander";
import table from "../../cli-ifaces.json" with { type: "json" };
import { registerBrowserCommand } from "./browser.js";
import { browserEn, browserZh, type BrowserMessages } from "./browser.messages.js";

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
const browserCliModule = {
  modules: [BrowserCommand],
  ifaces: table,
  messages: { en: browserEn, zh: browserZh },
} satisfies CliModule;

export default browserCliModule;
