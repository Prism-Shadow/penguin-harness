/**
 * The Agent's workbench pages as the whole app: one page, outside the shell like the terminal
 * (with and without a tab key). Everywhere else a workbench opens in the App Center's window,
 * from the App Center or the sidebar's app list.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { WorkbenchAppPage } from "./workbench-app-page";

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
  },
})
export class WorkbenchesModule {
  @Bind("workbenches.app") app = WorkbenchAppPage;
  @Bind("workbenches.app-tab") appTab = WorkbenchAppPage;
}
