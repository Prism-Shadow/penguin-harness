import type { ReactNode } from "react";
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { navNoteFor, useUpdateBadges } from "../../lib/use-update-badges";
import type { NavBadge } from "../../lib/sidebar-contributions";

const pageBadge = (path: string): NavBadge => ({
  useNote: () => navNoteFor(useUpdateBadges(), path),
});
/** Main AppLayout previously owned this eager hook. Keep one signed-in owner as a slot provider. */
function MainUpdateBadgesOwner({ children }: { children: ReactNode }) {
  useUpdateBadges(true);
  return children;
}

@Module({
  contributes: {
    "WebAppModule.sessionProviders": [{ id: "main.badges-owner", order: 20 }],
    "SidebarModule.navBadges": [
      { id: "main.agents-badge", anchor: "agents", order: 0 },
      { id: "main.models-badge", anchor: "models", order: 0 },
      { id: "main.plugins-badge", anchor: "plugins", order: 0 },
      { id: "main.usage-badge", anchor: "usage", order: 0 },
      { id: "main.account-badge", anchor: "account", order: 0 },
      { id: "main.menu-badge", anchor: "menu", order: 0 },
    ],
  },
})
export class MainSidebarBadgesModule {
  @Bind("main.badges-owner") owner = MainUpdateBadgesOwner;
  @Bind("main.agents-badge") agents = pageBadge("/agents");
  @Bind("main.models-badge") models = pageBadge("/models");
  @Bind("main.plugins-badge") plugins = pageBadge("/plugins");
  @Bind("main.usage-badge") usage = pageBadge("/usage");
  @Bind("main.account-badge") account: NavBadge = {
    useNote: () => useUpdateBadges().softwareNote,
  };
  @Bind("main.menu-badge") menu: NavBadge = { useNote: () => useUpdateBadges().softwareNote };
}
