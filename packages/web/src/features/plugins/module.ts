/**
 * The plugin market, a system app (an App Center tile, lib/system-apps.ts), and each plugin's own
 * page under it (`/plugins/<name>`), which keeps the App Center lit as the market does.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { PluginsPage } from "./plugins-page";
import { PluginPage } from "./plugin-page";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "plugins.list",
        key: "plugins",
        path: "/plugins",
        frame: "shell",
        nav: "none",
        admin: false,
        released: true,
        order: 40,
        title: "Plugins",
        titleZh: "插件市场",
        icon: "puzzle",
        app: { order: 20 },
      },
      {
        id: "plugins.detail",
        key: "plugins-detail",
        path: "/plugins/:pluginName",
        frame: "shell",
        nav: "none",
        admin: false,
        released: true,
        order: 41,
      },
    ],
  },
})
export class PluginsModule {
  @Bind("plugins.list") list = PluginsPage;
  @Bind("plugins.detail") detail = PluginPage;
}
