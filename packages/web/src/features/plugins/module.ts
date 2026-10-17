/** The plugins page; package details open in its modal. */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { PluginsPage } from "./plugins-page";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "plugins.list",
        key: "plugins",
        path: "/plugins",
        frame: "shell",
        nav: "main",
        admin: false,
        released: true,
        order: 40,
      },
    ],
  },
})
export class PluginsModule {
  @Bind("plugins.list") list = PluginsPage;
}
