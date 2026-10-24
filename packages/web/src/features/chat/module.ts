/** The chat page: the conversation, its draft and Session views. */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { ChatPage } from "./chat-page";

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
}
