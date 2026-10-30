/** Company mode: one page, /org/*, whose nested routes are company's own (org-routes.tsx). */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { OrgRoutes } from "./org-routes";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "company.org",
        key: "org",
        path: "/org/*",
        frame: "shell",
        nav: "none",
        admin: false,
        released: true,
        order: 120,
      },
    ],
  },
})
export class CompanyModule {
  @Bind("company.org") org = OrgRoutes;
}
