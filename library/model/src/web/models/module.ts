/**
 * The models page, a system app (an App Center tile, lib/system-apps.ts), the pinned group's
 * balance on the sidebar's account row, and the Project's Default model settings dialog with the
 * first-run guide before it, mounted beside every page.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import type { NavBadge } from "@prismshadow/penguin-web/internal";
import { ModelsPage } from "./models-page";
import { PinnedBalanceBadge } from "./group-balance";
import { FirstWorkbenchLayer } from "./first-workbench-layer";
import { DefaultModelsLayer } from "./default-models-layer";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "models.page",
        key: "models",
        path: "/models",
        frame: "shell",
        nav: "none",
        admin: false,
        released: true,
        order: 30,
        title: "Models",
        titleZh: "模型库",
        icon: "chip",
        app: { order: 10 },
      },
    ],
    "SidebarModule.navBadges": [{ id: "models.balance", anchor: "account", order: 20 }],
    "WebAppModule.layers": [
      { id: "models.defaults", order: 27 },
      { id: "models.first-workbench", order: 28 },
    ],
  },
})
export class ModelsModule {
  @Bind("models.first-workbench") firstWorkbench = FirstWorkbenchLayer;
  @Bind("models.page") page = ModelsPage;
  @Bind("models.balance") balance: NavBadge = { Mark: PinnedBalanceBadge };
  @Bind("models.defaults") defaults = DefaultModelsLayer;
}
