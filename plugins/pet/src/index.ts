/**
 * @penguinharness/pet — a small companion the web app docks as a widget, with `penguin pet`
 * commands and its state in the server's shared store.
 *
 * One module, two contributions, one state behind them:
 *
 *   - `WebModule.widgets`: a small always-visible widget whose iframe document is this
 *     package's own `ui/widget.html`, served by the server's GET /api/plugins/<package>/ui/*
 *     once the plugin is loaded. The web app reads the slot from GET /api/contributions and
 *     docks it beside the status bar.
 *   - `PluginCliCommandsProvider.commands`: the `pet` command. Its data half is here (the key
 *     and the summary help prints); its code half is the `@Bind` field, `registerPetCommands`
 *     (cli-commands.ts), which the server runs in-process and which reaches the state through
 *     the host's state channel.
 *
 * The state itself lives server-side under key `plugin-state:<package>` in the shared
 * settings store (server: widgets.ts), shaped by the pet's two facets (server: pet-state.ts);
 * the widget reads and writes it over the plugin state routes with the user's cookie, the
 * commands through the channel — every face of the pet sees one document.
 */
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type { CliCommandCode } from "@prismshadow/penguin-core/cli";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import type { PluginCliCommandHost } from "@prismshadow/penguin-server/plugin";
import { registerPetCommands } from "./cli-commands.js";

@Component({
  contributes: {
    "WebModule.widgets": [
      {
        id: "pet.widget",
        key: "pet",
        title: "Pet",
        titleZh: "宠物",
        size: "small",
        // Where the server serves this package's `ui/`: the package name, as package.json
        // spells it. Written out in full — a manifest is data, read without running this file.
        renderer: {
          iframe: {
            src: "/api/plugins/@penguinharness/pet/ui/widget.html",
            namespace: "pet",
          },
        },
      },
    ],
    "PluginCliCommandsProvider.commands": [
      {
        id: "pet.cmd",
        key: "pet",
        summary: {
          en: "Feed, name and look after the pet",
          zh: "喂食、起名，照看宠物",
        },
      },
    ],
  },
})
export class Pet {
  /** The `pet` command's code half: the node the server located, the state channel beside. */
  @Bind("pet.cmd")
  pet: CliCommandCode<PluginCliCommandHost> = {
    register(command, ctx) {
      registerPetCommands(command, ctx.messages);
    },
  };
}

const plugin: Plugin = { modules: [Pet] };
export default plugin;
