/** The usage page, a system app (an App Center tile, lib/system-apps.ts). */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { UsagePage } from "./usage-page";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "usage.page",
        key: "usage",
        path: "/usage",
        frame: "shell",
        nav: "none",
        admin: false,
        released: true,
        order: 60,
        title: "Cost Center",
        titleZh: "成本中心",
        icon: "barChart",
        app: { order: 40 },
      },
    ],
  },
})
export class UsageModule {
  @Bind("usage.page") page = UsagePage;
}
