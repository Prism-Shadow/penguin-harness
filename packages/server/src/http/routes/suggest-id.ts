/**
 * Semantic id proposals for every create dialog that names an object with a semantic id:
 *   POST /api/projects/:p/suggest-id   { name, kind, taken? } → { id, source, reason? }
 *
 * `kind` is `project`, `agent`, `org` or `channel`, or a kind a server module contributes
 * (`SemanticIdModule.kinds`, services/semantic-id-kinds.ts) — the Evaluation Center's `benchmark`
 * is one. The proposal itself is the shared one (services/semantic-id-suggest.ts): the default
 * model of the Project in the path, then the ASCII slug of the name, then a dated placeholder.
 * What differs by kind is decided here, beside the permission each kind's create route demands:
 *
 * | kind        | who may ask                              | id shape                           | avoided on top of `taken`             |
 * | ----------- | ---------------------------------------- | ---------------------------------- | ------------------------------------- |
 * | `project`   | a member of `:p`                         | admin: plain; else `<username>-…`  | every Project row and data-root entry |
 * | `agent`     | a member of `:p`                         | snake_case                         | the Project's Agent rows and folders  |
 * | contributed | a member, or the owner (`access`)        | kebab-case                         | what the kind's `takenIds` names      |
 * | `org`       | a member of `:p`, company mode on        | `co_…`                             | nothing (the dialog's list)           |
 * | `channel`   | a member of `:p`, company mode on        | `ch_…`                             | nothing (the dialog's list)           |
 *
 * A Project is not inside a Project, but its dialog is opened from one, and that Project's
 * default model is the model the user has configured: the path names it. Anyone signed in
 * may create a Project, so membership of the Project whose model is spent is the only gate.
 * The ids avoided are the names the kind's create route refuses with 409, read as names only —
 * not the list views, which skip a folder with no config that the create route still refuses,
 * and open every Agent and Benchmark to answer. For a Project that is every id on the server.
 * None of them reaches the prompt, only the collision suffix. `org` and `channel` delegate to
 * the organization service, recorded as the organization's.
 */
import type {
  Access,
  ProjectConfigStore,
  ProjectLifecycle,
  UtilityCompletion,
} from "@prismshadow/penguin-library-project";
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import type { Log } from "../../hmr/capabilities.js";
import type { AgentLifecycle } from "../../mechanisms/agents.js";
import type { Errors } from "@prismshadow/penguin-library-observability";
import type { Settings } from "@prismshadow/penguin-library-setting";
import type { OrgService } from "../../runtime/organization/service.js";
import { SEMANTIC_ID_RULES, contributedIdRule, projectIdRule } from "../../services/semantic-id.js";
import { HOST_ID_KINDS } from "../../services/semantic-id-kinds.js";
import type { SemanticIdKinds } from "../../services/semantic-id-kinds.js";
import { suggestSemanticId } from "../../services/semantic-id-suggest.js";
import { HttpError } from "../errors.js";
import {
  optionalStringArray,
  readJson,
  requireEnum,
  requireString,
  requireValidId,
} from "../validate.js";

/** What this route group reaches — declared here, at the consumer. */
export interface SuggestIdRouteDeps {
  access: Pick<Access, "requireProjectAccess" | "requireProjectOwner">;
  projects: Pick<ProjectLifecycle, "takenProjectIds">;
  agents: Pick<AgentLifecycle, "takenAgentIds">;
  /** The kinds server modules contribute. */
  kinds: Pick<SemanticIdKinds, "find" | "names">;
  orgService: Pick<OrgService, "suggestId">;
  settings: Pick<Settings, "getCompanyMode">;
  completeOnce: (projectId: string, prompt: string) => Promise<UtilityCompletion>;
  /** One model dead end of a Project, Agent or Benchmark proposal, for the log and the errors panel. */
  recordFailure: (projectId: string, detail: string) => void;
}

export function suggestIdRoutes(deps: SuggestIdRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const user = c.var.user;
    deps.access.requireProjectAccess(user.userId, projectId);
    const body = await readJson(c);
    // The mission or a description may stand in for a name nobody typed yet.
    const name = requireString(body, "name", { minLen: 1, maxLen: 4000 });
    const kind: string = requireEnum(body, "kind", [...HOST_ID_KINDS, ...deps.kinds.names()]);
    const taken = optionalStringArray(body, "taken");

    if (kind === "org" || kind === "channel") {
      if (!deps.settings.getCompanyMode()) {
        throw new HttpError(404, "company_mode_off", "Company mode is turned off on this server.");
      }
      return c.json(
        await deps.orgService.suggestId(projectId, {
          name,
          kind,
          ...(taken !== undefined ? { taken } : {}),
        }),
      );
    }

    const contributed = kind === "project" || kind === "agent" ? null : deps.kinds.find(kind);
    // A contributed kind asks whoever its create route admits: the owner, when that route is
    // Project management (as a Benchmark's is).
    if (contributed?.access === "owner") deps.access.requireProjectOwner(user.userId, projectId);
    const reserved =
      kind === "project"
        ? await deps.projects.takenProjectIds()
        : kind === "agent"
          ? await deps.agents.takenAgentIds(projectId)
          : await contributed!.takenIds(projectId);
    const res = await suggestSemanticId(
      { completeOnce: deps.completeOnce, recordFailure: deps.recordFailure },
      projectId,
      {
        name,
        kind,
        rule:
          kind === "project"
            ? projectIdRule(user)
            : kind === "agent"
              ? SEMANTIC_ID_RULES.agent
              : contributedIdRule(kind),
        taken: taken ?? [],
        reserved,
      },
    );
    return c.json(res);
  });

  return app;
}

import { endpointOf } from "../app.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "project.suggestId",
        method: "POST",
        prefix: "/api/projects/:projectId/suggest-id",
        auth: "user",
        role: "project.read",
        order: 146,
      },
    ],
  },
})
export class SuggestIdRoutes {
  @Use() private readonly access!: Access;
  @Use() private readonly projects!: ProjectLifecycle;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly agents!: AgentLifecycle;
  @Use() private readonly kinds!: SemanticIdKinds;
  @Use() private readonly orgService!: OrgService;
  @Use() private readonly settings!: Settings;
  @Use() private readonly errors!: Errors;
  @Use() private readonly log!: Log;
  @Bind("project.suggestId") routes!: Hono<AppEnv>;
  setup() {
    this.routes = endpointOf(
      suggestIdRoutes({
        access: this.access,
        projects: this.projects,
        agents: this.agents,
        kinds: this.kinds,
        orgService: this.orgService,
        settings: this.settings,
        completeOnce: (projectId, prompt) => this.projectConfig.completeOnce(projectId, prompt),
        recordFailure: (projectId, detail) => {
          this.log.line(`id suggestion fell back for ${projectId}: ${detail}`);
          this.errors.record({
            source: "id_suggest",
            code: "id_suggest_failed",
            kind: "expected",
            ctx: { projectId },
            err: new Error(detail),
          });
        },
      }),
      "POST",
      "/",
    );
  }
}
