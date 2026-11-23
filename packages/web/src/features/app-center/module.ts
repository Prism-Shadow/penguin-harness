/**
 * The App Center: the Project's home screen of the system apps and the workbench shortcuts, one of
 * the nav's three fixed entries, lit there on the system apps' pages too, and the carrier of their
 * update dots (lib/system-app-notes.ts). It also holds the windows of the apps opened from it, over
 * the page area so they outlive the page. Plugin iframe apps also use this layer and their own full-screen page.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { AppCenterPage } from "./app-center-page";
import { AppCenterWindows } from "./app-center-windows";
import { SystemAppPage } from "./system-app-page";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "app-center.page",
        key: "apps",
        path: "/apps",
        frame: "shell",
        nav: "main",
        admin: false,
        released: true,
        order: 25,
        title: "App Center",
        titleZh: "应用中心",
        icon: "tiles",
      },
      {
        // Beside an Agent workbench's full page (/app/:projectId/:agentId/:workbenchId), which
        // its static segment outranks: no Agent but the system Agent has this id.
        id: "app-center.system-app",
        key: "system-app",
        path: "/app/:projectId/system_agent/:appKey",
        frame: "bare",
        nav: "none",
        admin: false,
        released: true,
        order: 112,
      },
    ],
    "WebAppModule.layers": [{ id: "app-center.windows", order: 40, area: "page" }],
  },
})
export class AppCenterModule {
  @Bind("app-center.page") page = AppCenterPage;
  @Bind("app-center.windows") windows = AppCenterWindows;
  @Bind("app-center.system-app") systemApp = SystemAppPage;
}
