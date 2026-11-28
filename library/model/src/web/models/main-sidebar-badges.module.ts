import type { ReactNode } from "react";
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import {
  navNoteFor,
  useUpdateBadges,
  joinedNote,
  useSystemAppNotes,
  useAuth,
  type NavBadge,
} from "@prismshadow/penguin-web/internal";
/** Main AppLayout previously owned this eager hook. Keep one signed-in owner as a slot provider. */
function MainUpdateBadgesOwner({ children }: { children: ReactNode }) {
  // The administrator's owner also reads the server module requests that wait (the Plugins dot).
  useUpdateBadges(true, useAuth().user?.isAdmin === true);
  return children;
}

/**
 * The dots on the sidebar's anchors (06 「角标」): Agents' kernel trail on its row; the system apps'
 * trails (Plugins, Models and the Cost Center, which have no rows of their own) on the App
 * Center's row, as one dot whose hint joins their sentences, and from there on each app's tile
 * (lib/system-app-notes.ts); the software update on the account row; and every trail on the
 * phone's drawer button.
 */
@Module({
  contributes: {
    "WebAppModule.sessionProviders": [{ id: "main.badges-owner", order: 20 }],
    "SidebarModule.navBadges": [
      { id: "main.agents-badge", anchor: "agents", order: 0 },
      { id: "main.apps-badge", anchor: "apps", order: 0 },
      { id: "main.account-badge", anchor: "account", order: 0 },
      { id: "main.menu-badge", anchor: "menu", order: 0 },
    ],
  },
})
export class MainSidebarBadgesModule {
  @Bind("main.badges-owner") owner = MainUpdateBadgesOwner;
  @Bind("main.agents-badge") agents: NavBadge = {
    useNote: () => navNoteFor(useUpdateBadges(), "/agents"),
  };
  @Bind("main.apps-badge") apps: NavBadge = {
    useNote: () => joinedNote(useSystemAppNotes().values()),
  };
  @Bind("main.account-badge") account: NavBadge = {
    useNote: () => useUpdateBadges().softwareNote,
  };
  // The drawer button's hint names any waiting trail (software, the kernel, plugins, model
  // presets, unexpected errors) — `note` is the combined case; `softwareNote` says software only.
  @Bind("main.menu-badge") menu: NavBadge = { useNote: () => useUpdateBadges().note };
}
