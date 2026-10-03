/**
 * Company mode: one page, /org/*, whose nested routes are company's own (org-routes.tsx); the
 * company state's provider, mounted for the signed-in session; and the handler that fans the
 * scheduler's events out to it.
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { OrgRoutes } from "./org-routes";
import { CompanyProvider, companyUserEvents } from "./company-state";

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
    "WebAppModule.sessionProviders": [{ id: "company.provider", order: 10 }],
    "SessionsModule.userEvents": [{ id: "company.events", order: 10 }],
  },
})
export class CompanyModule {
  @Bind("company.org") org = OrgRoutes;
  @Bind("company.provider") provider = CompanyProvider;
  @Bind("company.events") events = companyUserEvents;
}
