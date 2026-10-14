import { supportBackend } from "./backend.js";
import { supportPage } from "./page.js";
export { SUPPORT_AGENT_ID, SUPPORT_AGENTS_MD } from "./agent.js";

export const SUPPORT_WORKBENCH_FILES: Record<string, string> = {
  "workbenches/support/package.json": JSON.stringify(
    {
      name: "PenguinHarness Support",
      version: "1.0.0",
      type: "module",
      penguin: {
        modules: [
          {
            name: "Workbench",
            requires: {
              host: { iface: "@prismshadow/penguin-server#WorkbenchHost", from: "Host" },
            },
            provides: { main: "@prismshadow/penguin-server#WorkbenchMain" },
            contributes: {
              "WebModule.sessionTabs": [
                {
                  id: "support.main",
                  key: "support",
                  title: "Support",
                  titleZh: "客服工作台",
                  renderer: { iframe: { src: "ui/index.html" } },
                },
              ],
            },
          },
        ],
      },
    },
    null,
    2,
  ),
  "workbenches/support/index.ts": supportBackend,
  "workbenches/support/ui/index.html": supportPage,
};
