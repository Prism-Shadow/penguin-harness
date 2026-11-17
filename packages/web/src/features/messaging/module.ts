import { mainPanelDefinition as mainPanelmessaging } from "./main-dock-panel";
/**
 * Messaging: the session list's binding entry and relay mark (session-row-action.tsx), and the
 * dock's messaging panel (messaging-dock-panel.tsx).
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { messagingRowAction } from "./session-row-action";
import { MessagingDockPanel } from "./messaging-dock-panel";

@Module({
  contributes: {
    "SessionListModule.rowActions": [{ id: "messaging.binding", order: 10 }],
    "DockModule.panels": [
      {
        id: "messaging.panel",
        kind: "messaging",
        title: "Remote control",
        titleZh: "远程控制",
        icon: "paperPlane",
        order: 50,
      },
    ],
  },
})
export class MessagingModule {
  @Bind("messaging.binding") binding = messagingRowAction;
  @Bind("messaging.panel") panel = { mainDefinitions: [mainPanelmessaging] };
}
