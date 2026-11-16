import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { PlatformUiLayer } from "./layer";

/**
 * The bridge's page half as one app layer: it registers this tab, holds the poll, and owns
 * the picker overlay. A module of its own because the capability is not the pet's — any
 * surface that wants to hand the Agent the screen mounts this once.
 */
@Module({
  contributes: {
    "WebAppModule.layers": [{ id: "platform-ui.layer", order: 35 }],
  },
})
export class PlatformUiWebModule {
  @Bind("platform-ui.layer") layer = PlatformUiLayer;
}
