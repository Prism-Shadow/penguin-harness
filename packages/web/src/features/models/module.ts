/** The models page, and the pinned group's balance on the sidebar's account row. */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import type { NavBadge } from "../../lib/sidebar-contributions";
import { ModelsPage } from "./models-page";
import { PinnedBalanceBadge } from "./group-balance";

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
  },
})
export class ModelsModule {
  @Bind("models.page") page = ModelsPage;
  @Bind("models.balance") balance: NavBadge = { Mark: PinnedBalanceBadge };
}
