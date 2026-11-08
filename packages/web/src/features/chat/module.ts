/**
 * The chat page: the conversation, its draft and Session views; and its drafts
 * for the surfaces that start and list them (iface.ts).
 */
import { Bind, Module, Provide } from "@prismshadow/penguin-core/kernel";
import { ChatPage } from "./chat-page";
import { chatDrafts } from "./chat-drafts";
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
  },
})
export class ChatModule {
  @Bind("chat.page") page = ChatPage;
  @Provide() drafts: ChatDrafts = chatDrafts;
}
