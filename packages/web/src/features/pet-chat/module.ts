import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { PetChatWindow } from "./chat-window";
import { PetChatPage } from "./embed-page";

/**
 * The pet's chat: the floating window (a layer, so it survives navigation) and the bare page
 * that window frames. Both are the app's own chat, bound to the Project's platform Agent.
 */
@Module({
  contributes: {
    "WebAppModule.layers": [{ id: "pet-chat.layer", order: 45 }],
    "WebAppModule.pages": [
      {
        id: "pet-chat.page",
        key: "pet-chat",
        path: "/pet-chat/:sessionId",
        frame: "bare",
        nav: "none",
        admin: false,
        released: true,
        order: 120,
      },
    ],
  },
})
export class PetChatModule {
  @Bind("pet-chat.layer") layer = PetChatWindow;
  @Bind("pet-chat.page") page = PetChatPage;
}
