/**
 * Company mode: one page, /org/*, whose nested routes are company's own (org-routes.tsx); the
 * home redirect, `/` and every unmatched path, since home depends on the mode; the company
 * state's provider, mounted for the signed-in session; the handler that fans the scheduler's
 * events out to it; the sidebar's company work mode with its four sections
 * (sidebar-mode.tsx); and the unread count on the contributed proposals page's row
 * (proposals-badge.tsx).
 */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { OrgRoutes } from "./org-routes";
import { HomeRedirect } from "./home-redirect";
import { CompanyProvider, companyUserEvents } from "./company-state";
import { companyChannels, companyDesks, companyMode, companySwitcher } from "./sidebar-mode";

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
      {
        id: "company.home",
        key: "home",
        path: "*",
        frame: "shell",
        nav: "none",
        admin: false,
        released: true,
        order: 130,
      },
    ],
    "WebAppModule.sessionProviders": [{ id: "company.provider", order: 10 }],
    "SessionsModule.userEvents": [{ id: "company.events", order: 10 }],
    "SidebarModule.modes": [
      {
        id: "company.mode",
        key: "company",
        title: "Company",
        titleZh: "公司",
        icon: "building",
        order: 10,
      },
    ],
    "SidebarModule.sections": [
      { id: "company.switcher", mode: "company", place: "header", order: 10 },
      { id: "company.channels", mode: "company", place: "body", order: 20 },
      { id: "company.desks", mode: "company", place: "body", order: 30 },
    ],
  },
})
export class CompanyModule {
  @Bind("company.org") org = OrgRoutes;
  @Bind("company.home") home = HomeRedirect;
  @Bind("company.provider") provider = CompanyProvider;
  @Bind("company.events") events = companyUserEvents;
  @Bind("company.mode") mode = companyMode;
  @Bind("company.switcher") switcher = companySwitcher;
  @Bind("company.channels") channels = companyChannels;
  @Bind("company.desks") desks = companyDesks;
}
