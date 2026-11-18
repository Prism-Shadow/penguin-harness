/**
 * @penguinharness/pet — a small companion the web app opens as a page, with `penguin pet`
 * commands and its state in the server's shared settings store.
 *
 * One module, three contributions, one state behind them:
 *
 *   - `WebModule.pages`: a page the web app renders as an iframe whose document is this
 *     package's own `ui/widget.html`, served by the server's GET /api/plugins/<package>/ui/*
 *     once the plugin is loaded. `nav: "none"`: reachable by its URL (`/pet`) — the page is
 *     her stage; she walks about it, stands where you drop her, and answers the pointer.
 *   - `PluginCliCommandsProvider.commands`: the `pet` command. Its data half is here (the key
 *     and the summary help prints); its code half is the `@Bind` field, `registerPetCommands`
 *     (cli-commands.ts), which the server runs in-process. The server hands a run the locale
 *     it resolved and nothing else, so the state reaches the commands through this module:
 *     `setup` builds a state channel over the settings store and the bound code half closes
 *     over it.
 *   - `HttpModule.routes`: the pet's own state routes (state-routes.ts), GET and PATCH on
 *     `/api/plugins/@penguinharness/pet/state` — the same document, over HTTP, with the
 *     user's cookie.
 *
 * The state itself lives server-side under key `plugin-state:@penguinharness/pet` in the
 * shared settings store, shaped by the pet's two facets (pet-state.ts): every face of the
 * pet — the commands, her page — sees one document.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/plugin";
import type { CliCommandCode } from "@prismshadow/penguin-core/cli";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import { Hono } from "hono";
import { registerPetCommands } from "./cli-commands.js";
import { petStateChannel } from "./settings.js";
import type { PetStateChannel, SettingsStore } from "./settings.js";
import { petStateRoutes } from "./state-routes.js";

const PACKAGE_NAME = "@penguinharness/pet";

@Component({
  contributes: {
    "WebModule.pages": [
      {
        id: "pet.page",
        key: "pet",
        path: "/pet",
        nav: "none",
        admin: false,
        title: "Pet",
        titleZh: "宠物",
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
    "HttpModule.routes": [
      {
        id: "PetStateRoutes.routes",
        prefix: "/api/plugins/@penguinharness/pet/state",
        auth: "user",
        // Beside the ui/ group on the same tree; their patterns never overlap.
        order: 69,
      },
    ],
  },
})
export class Pet {
  /** The `pet` command's code half: the node the server located, the locale it resolved. */
  @Bind("pet.cmd")
  pet: CliCommandCode = {
    // An arrow on purpose: the state channel exists from `setup` on, and a run's register
    // happens long after — the closure reaches this module's channel, not a host's.
    register: (command, ctx) => {
      registerPetCommands(
        command,
        this.state,
        ctx.messages.language === "zh" ? "zh" : "en",
      );
    },
  };

  /** The pet's own state routes, built in `setup` over the settings-backed channel. */
  @Bind("PetStateRoutes.routes")
  routes!: Hono;

  /** The server's settings store, as settings.ts declares it. */
  @Use() private readonly settings!: SettingsStore;

  /** The state channel every face of this module shares; exists from `setup` on. */
  private state!: PetStateChannel;

  setup() {
    this.state = petStateChannel(this.settings, PACKAGE_NAME);
    const state = this.state;
    this.routes = petStateRoutes({ state });
  }
}

const plugin: Plugin = { modules: [Pet] };
export default plugin;
