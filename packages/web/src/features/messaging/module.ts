/** Messaging: the session list's binding entry and relay mark (session-row-action.tsx). */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { messagingRowAction } from "./session-row-action";

@Module({
  contributes: {
    "SessionListModule.rowActions": [{ id: "messaging.binding", order: 10 }],
  },
})
export class MessagingModule {
  @Bind("messaging.binding") binding = messagingRowAction;
}
