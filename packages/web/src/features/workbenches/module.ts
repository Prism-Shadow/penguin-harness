/**
 * The Agent's workflow pages: as tabs beside the chat (session-tab.tsx), and one page as the whole
 * app, outside the shell like the terminal (with and without a tab).
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { WorkbenchAppPage } from "./workbench-app-page";
import { WorkbenchSessionTab } from "./session-tab";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "workbenches.app",
        key: "workbench-app",
        path: "/app/:projectId/:agentId/:workbenchId",
        frame: "bare",
        nav: "none",
        admin: false,
        released: true,
        order: 110,
      },
      {
        id: "workbenches.app-tab",
        key: "workbench-app-tab",
        path: "/app/:projectId/:agentId/:workbenchId/:tabKey",
        frame: "bare",
        nav: "none",
        admin: false,
        released: true,
        order: 111,
      },
    ],
    "ChatModule.sessionTabs": [{ id: "workbenches.tabs", order: 10 }],
  },
})
export class WorkbenchesModule {
  @Bind("workbenches.app") app = WorkbenchAppPage;
  @Bind("workbenches.app-tab") appTab = WorkbenchAppPage;
  @Bind("workbenches.tabs") tabs = WorkbenchSessionTab;
}
