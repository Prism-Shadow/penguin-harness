/**
 * The App Center: the Project's home screen of the system apps and the workbench shortcuts, pinned
 * in the nav by default and lit there on the system apps' pages too, and the windows of the apps
 * opened from it, over the page area so they outlive the page.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { AppCenterPage } from "./app-center-page";
import { AppCenterWindows } from "./app-center-windows";

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
    ],
    "WebAppModule.layers": [{ id: "app-center.windows", order: 40, area: "page" }],
  },
})
export class AppCenterModule {
  @Bind("app-center.page") page = AppCenterPage;
  @Bind("app-center.windows") windows = AppCenterWindows;
}
