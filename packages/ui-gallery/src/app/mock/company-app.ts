import type { WebPageContribution } from "@prismshadow/penguin-server/api";

export const COMPANY_APP_KEY = "company";

export function companyAppPage(): WebPageContribution {
  return {
    id: "agent-company.app",
    from: "AgentCompanyModule",
    key: COMPANY_APP_KEY,
    path: "/company",
    nav: "none",
    admin: false,
    renderer: {
      iframe: { src: `${import.meta.env.BASE_URL}company.html`, namespace: COMPANY_APP_KEY },
    },
    title: "Company",
    titleZh: "公司",
    icon: "building",
    app: { order: 5 },
  };
}
