/**
 * The session list: the sidebar's development-mode section (section.tsx), on the chat module's
 * drafts, with the row extensions other modules contribute to its `rowActions` slot (iface.ts).
 */
import { Bind, Module, Provide, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";

import type { SidebarSection } from "../../lib/sidebar-contributions";
import type { ChatDrafts } from "../chat";
import type { SessionList } from "./iface";
import { sessionListDeps } from "./deps";
import { composeMarks, rowExtensionsOf } from "./row-actions";
import { MainSessionListSection } from "./main-sidebar-fragments";

@Module({
  contributes: {
    "SidebarModule.sections": [
      { id: "session-list.section", mode: "dev", place: "body", order: 30 },
    ],
  },
})
export class SessionListModule {
  @Provide() sessionList!: SessionList;
  @Use() drafts!: ChatDrafts;
  @Bind("session-list.section") section!: SidebarSection;
  setup({ contributions }: ClassCtx) {
    const rows = rowExtensionsOf(contributions.rowActions ?? []);
    const deps = { drafts: this.drafts, rows, useRowMarks: composeMarks(rows.marks) };
    this.section = {
      // main sidebar owns evolved list state; the slot carries its live renderer.
      Full: sessionListDeps.provide(deps, MainSessionListSection),
    };
    this.sessionList = {};
  }
}
