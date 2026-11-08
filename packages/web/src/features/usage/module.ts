/** The usage page. */
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
        nav: "main",
        admin: false,
        released: true,
        order: 60,
        title: "Cost Center",
        titleZh: "成本中心",
        icon: "barChart",
      },
    ],
  },
})
export class UsageModule {
  @Bind("usage.page") page = UsagePage;
}
