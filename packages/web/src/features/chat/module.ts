import { mainPanelDefinition as mainPanelmemory } from "./main-memory-panel";
import { mainPanelDefinition as mainPanelagents } from "./main-agents-panel";
/**
 * The chat page: the conversation, its draft and Session views; its drafts for
 * the surfaces that start and list them (iface.ts); and the two dock panels that show the
 * conversation itself: its subagents and its memory (panels/).
 */
import { Bind, Module, Provide } from "@prismshadow/penguin-core/kernel";
import { ChatPage } from "./chat-page";
import { chatDrafts } from "./chat-drafts";
import { AgentsPanel } from "./panels/agents-panel";
import { MemoryPanel } from "./panels/memory-panel";
import type { ChatDrafts } from "./iface";

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
  @Bind("chat.page") page = ChatPage;
  @Bind("chat.agents-panel") agentsPanel = { mainDefinitions: [mainPanelagents] };
  @Bind("chat.memory-panel") memoryPanel = { mainDefinitions: [mainPanelmemory] };
  @Provide() drafts: ChatDrafts = chatDrafts;
}
