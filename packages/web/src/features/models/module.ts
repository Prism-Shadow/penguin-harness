/**
 * The models page, the pinned group's balance on the sidebar's account row, and the Project's
 * Default model settings dialog with the first-run guide before it, mounted beside every page.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import type { NavBadge } from "../../lib/sidebar-contributions";
import { ModelsPage } from "./models-page";
import { PinnedBalanceBadge } from "./group-balance";
import { DefaultModelsLayer } from "./default-models-layer";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "models.page",
        key: "models",
        path: "/models",
        frame: "shell",
        nav: "main",
        admin: false,
        released: true,
        order: 30,
        title: "Models",
        titleZh: "模型库",
        icon: "chip",
      },
    ],
    "SidebarModule.navBadges": [{ id: "models.balance", anchor: "account", order: 20 }],
    "WebAppModule.layers": [{ id: "models.defaults", order: 27 }],
  },
})
export class ModelsModule {
  @Bind("models.page") page = ModelsPage;
  @Bind("models.balance") balance: NavBadge = { Mark: PinnedBalanceBadge };
  @Bind("models.defaults") defaults = DefaultModelsLayer;
}
