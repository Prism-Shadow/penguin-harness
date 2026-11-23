/**
 * The sidebar module: the navigation column and its folded rail, filled from its slots
 * (iface.ts), each contribution following its module's server-module gate (gated.ts). The shell `@Use`s what it provides to mount both; the column's New chat entries
 * open the chat module's drafts.
 */
import { Module, Provide, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";

import type { ChatDrafts } from "../../features/chat";
import type { Sidebar } from "./iface";
import { sidebarDeps, useColumnStateOf, type SidebarDeps } from "./deps";

import { badgesOf, composeModes, composeNotes, modesOf, sectionsOf } from "./modes";
import { gatedBadges, gatedModes, gatedSections } from "./gated";
import { Sidebar as SidebarColumn } from "./sidebar";
import { CollapsedRail } from "./rail";

@Module()
export class SidebarModule {
  @Provide() sidebar!: Sidebar;
  @Use() drafts!: ChatDrafts;
  setup({ contributions }: ClassCtx) {
    const modes = modesOf(gatedModes(contributions.modes ?? []));
    const badges = badgesOf(gatedBadges(contributions.navBadges ?? []));
    const deps: SidebarDeps = {
      sections: sectionsOf(gatedSections(contributions.sections ?? [])),
      modes,
      badges,
      useModes: composeModes(modes),
      useNotes: composeNotes(badges),
      drafts: this.drafts,
    };
    this.sidebar = {
      Column: sidebarDeps.provide(deps, SidebarColumn),
      Rail: sidebarDeps.provide(deps, CollapsedRail),
      useColumnState: () => useColumnStateOf(deps),
    };
  }
}
