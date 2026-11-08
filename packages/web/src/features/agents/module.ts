/** The Agents list and one Agent's settings. */
import { Bind, Module } from "@prismshadow/penguin-core/kernel";
import { AgentsPage } from "./agents-page";
import { AgentSettingsPage } from "./agent-settings-page";

@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "agents.list",
        key: "agents",
        path: "/agents",
        frame: "shell",
        nav: "main",
        admin: false,
        released: true,
        order: 20,
      },
      {
        id: "agents.settings",
        key: "agent-settings",
        path: "/agents/:agentId",
        frame: "shell",
        nav: "none",
        admin: false,
        released: true,
        order: 21,
      },
    ],
  },
})
export class AgentsModule {
  @Bind("agents.list") list = AgentsPage;
  @Bind("agents.settings") settings = AgentSettingsPage;
}
