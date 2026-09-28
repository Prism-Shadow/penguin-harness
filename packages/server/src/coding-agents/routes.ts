import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Hono } from "hono";
import type { AppEnv } from "../auth/middleware.js";
import { codingAgentsRoutes } from "../http/routes/coding-agents.js";
import type { BuiltinAgents } from "../mechanisms/builtin-agents.js";
import type { CodingAgents } from "../mechanisms/coding-agents.js";

/** The coding-agents route group: agent definitions, built-in agents and ACP session driving. */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "codingAgents.routes",
        prefix: "/api/coding-agents",
        auth: "user",
        order: 260,
      },
    ],
  },
})
export class CodingAgentsRoutes {
  @Use() private readonly codingAgents!: CodingAgents;
  @Use() private readonly builtinAgents!: BuiltinAgents;
  @Bind("codingAgents.routes") codingAgentsRoutes!: Hono<AppEnv>;

  setup() {
    this.codingAgentsRoutes = codingAgentsRoutes({
      codingAgents: this.codingAgents,
      builtinAgents: this.builtinAgents,
    });
  }
}
