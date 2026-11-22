/**
 * `penguin storage` — the plugin's CLI half (`./cli`), the CLI module the CLI's build compiles in
 * (rfcs/PRFC-0024-cli-modules.md, "Shipped plugins' CLI modules"). One `@Component` contributes the
 * command to the CLI's `ShippedCommandsModule.commands`: the entry is its data half (its key and
 * one-line summary), the `@Bind(entry.id)` field its code half. The default export hands the CLI
 * the class, the table it boots against (`cli-ifaces.json`, generated over src/cli alone, so the
 * server table never carries this module) and the command's own message group.
 *
 * The code reaches the host only through the core contract, the CLI face
 * (`@prismshadow/penguin-library-cli`) and the plugin's own wire types (../types.ts).
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
import { registerStorageCommand } from "./storage.js";
import { storageEn, storageZh, type StorageMessages } from "./storage.messages.js";

/** The node the host located for a key, typed with this package's commander. */
const node = (command: CliCommandProgram): Command => command as Command;

/** `penguin storage`. */
@Component({
  contributes: {
    "ShippedCommandsModule.commands": [
      {
        id: "storage.cli",
        key: "storage",
        summary: {
          en: "Show what the data root holds, and clean what can be regenerated",
          zh: "查看数据根目录占用的空间，清理可以重新生成的内容",
        } satisfies CliCommandSummary,
      },
    ],
  },
})
export class StorageCommand {
  @Bind("storage.cli") command!: CliCommandCode<StorageMessages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerStorageCommand(node(command), ctx.messages);
      },
    };
  }
}

/** The storage CLI module: the command class, the table it is booted against, its messages. */
const storageCliModule = {
  modules: [StorageCommand],
  ifaces: table,
  messages: { en: storageEn, zh: storageZh },
} satisfies CliModule;

export default storageCliModule;

// What a caller checks the command's output against.
export { storageEn, storageZh, type StorageMessages } from "./storage.messages.js";
export { formatSize, localMinute, renderReview, renderUsage } from "./storage-output.js";
