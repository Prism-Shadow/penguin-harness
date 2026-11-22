/**
 * The App Center: the Project's home screen of the system apps and the workbench shortcuts, pinned
 * in the nav by default and lit there on the system apps' pages too.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { AppCenterPage } from "./app-center-page";

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
  },
})
export class AppCenterModule {
  @Bind("app-center.page") page = AppCenterPage;
}
