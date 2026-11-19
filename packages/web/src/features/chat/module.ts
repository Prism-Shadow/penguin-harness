import { mainPanelDefinition as mainPanelmemory } from "./main-memory-panel";
import { mainPanelDefinition as mainPanelagents } from "./main-agents-panel";
/**
 * The chat page: the conversation, its draft and Session views, with the tabs
 * other modules contribute beside the conversation (`sessionTabs`, iface.ts) and the named
 * renderers for the Workspace files a reply links (`fileRenderers`); what other modules move when
 * a conversation takes a new id (`sessionHandovers`) and the rows they add to a web link's menu
 * (`linkActions`); its drafts for the surfaces that start and list them; and the two dock panels
 * that show the conversation itself: its subagents and its memory (panels/).
 */
import type { ComponentType } from "react";
import {
  Bind,
  Module,
  Provide,
  type ClassCtx,
  type Contributed,
} from "@prismshadow/penguin-core/kernel";
import type { LinkAction, Ordered, SessionHandover } from "@prismshadow/penguin-web-plugin";

import { ChatPage } from "./chat-page";
import { chatDrafts } from "./chat-drafts";
import type { Chat, ChatDrafts } from "./iface";
import { chatDeps, fileRenderersOf, sessionTabsOf } from "./deps";
import { setLinkActions } from "./link-actions";
import { setSessionHandovers } from "./session-handover";

/** A slot's contributions by `order`. */
const byOrder = (list: readonly Contributed[] | undefined): Contributed[] =>
  [...(list ?? [])].sort(
    (a, b) => (a.data as unknown as Ordered).order - (b.data as unknown as Ordered).order,
  );

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "chat.page",
        key: "chat",
        path: "/chat/:sessionId?",
        frame: "shell",
        nav: "none",
        admin: false,
        released: true,
        order: 10,
      },
    ],
    "DockModule.panels": [
      {
        id: "chat.agents-panel",
        kind: "agents",
        title: "Agents panel",
        titleZh: "智能体面板",
        icon: "robotPair",
        order: 10,
      },
      {
        id: "chat.memory-panel",
        kind: "memory",
        title: "Memory",
        titleZh: "记忆",
        icon: "brain",
        order: 30,
      },
    ],
  },
})
export class ChatModule {
  @Provide() chat!: Chat;
  @Bind("chat.page") page!: ComponentType;
  @Bind("chat.agents-panel") agentsPanel = { mainDefinitions: [mainPanelagents] };
  @Bind("chat.memory-panel") memoryPanel = { mainDefinitions: [mainPanelmemory] };
  @Provide() drafts: ChatDrafts = chatDrafts;
  setup({ contributions }: ClassCtx) {
    setSessionHandovers(
      byOrder(contributions.sessionHandovers).map((c) => c.code as SessionHandover),
    );
    setLinkActions(
      byOrder(contributions.linkActions).map((c) => ({
        action: c.code as LinkAction,
        from: c.from,
      })),
    );
    this.page = chatDeps.provide(
      {
        sessionTabs: sessionTabsOf(contributions.sessionTabs ?? []),
        fileRenderers: fileRenderersOf(contributions.fileRenderers ?? []),
      },
      ChatPage,
    );
    this.chat = {};
  }
}
