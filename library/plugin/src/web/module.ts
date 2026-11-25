/**
 * The plugins page, a system app (an App Center tile, lib/system-apps.ts); package details open
 * in its modal.
 */
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
        nav: "none",
        admin: false,
        released: true,
        order: 40,
        title: "Plugins",
        titleZh: "插件市场",
        icon: "puzzle",
        app: { order: 20 },
      },
    ],
  },
})
export class PluginsModule {
  @Bind("plugins.list") list = PluginsPage;
}
