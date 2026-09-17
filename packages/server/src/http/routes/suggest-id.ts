/**
 * Semantic id proposals for every create dialog that names an object with a semantic id:
 *   POST /api/projects/:p/suggest-id   { name, kind, taken? } → { id, source, reason? }
 *
 * `kind` is `project`, `agent`, `benchmark`, `org` or `channel`. The proposal itself is the
 * shared one (services/semantic-id-suggest.ts): the default model of the Project in the path,
 * then the ASCII slug of the name, then a dated placeholder. What differs by kind is decided
 * here, beside the permission each kind's create route demands:
 *
 * | kind        | who may ask                              | id shape                           | avoided on top of `taken`             |
 * | ----------- | ---------------------------------------- | ---------------------------------- | ------------------------------------- |
 * | `project`   | a member of `:p`                         | admin: plain; else `<username>-…`  | every Project row and data-root entry |
 * | `agent`     | a member of `:p`                         | snake_case                         | the Project's Agent rows and folders  |
 * | `benchmark` | the owner of `:p`                        | kebab-case                         | the Project's Benchmark folders       |
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
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { SemanticIdKind } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { Log } from "../../hmr/capabilities.js";
import type { AgentLifecycle, Benchmarks } from "../../mechanisms/agents.js";
import type { Errors } from "../../mechanisms/observability.js";
import type { Access, ProjectConfigStore, ProjectLifecycle } from "../../mechanisms/projects.js";
import type { Settings } from "../../mechanisms/settings.js";
import type { OrgService } from "../../runtime/organization/service.js";
import type { UtilityCompletion } from "../../services/project-config-service.js";
import { SEMANTIC_ID_RULES, projectIdRule } from "../../services/semantic-id.js";
import { suggestSemanticId } from "../../services/semantic-id-suggest.js";
import { HttpError } from "../errors.js";
import {
  optionalStringArray,
  readJson,
  requireEnum,
  requireString,
  requireValidId,
} from "../validate.js";

const KINDS: readonly SemanticIdKind[] = ["project", "agent", "benchmark", "org", "channel"];

/** What this route group reaches — declared here, at the consumer. */
export interface SuggestIdRouteDeps {
  access: Pick<Access, "requireProjectAccess" | "requireProjectOwner">;
  projects: Pick<ProjectLifecycle, "takenProjectIds">;
  agents: Pick<AgentLifecycle, "takenAgentIds">;
  benchmarks: Pick<Benchmarks, "takenIds">;
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
    const kind = requireEnum(body, "kind", KINDS);
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

    // Writing a Benchmark is Project management — owner only, as its create route demands.
    if (kind === "benchmark") deps.access.requireProjectOwner(user.userId, projectId);
    const reserved =
      kind === "project"
        ? await deps.projects.takenProjectIds()
        : kind === "agent"
          ? await deps.agents.takenAgentIds(projectId)
          : await deps.benchmarks.takenIds(projectId);
    const res = await suggestSemanticId(
      { completeOnce: deps.completeOnce, recordFailure: deps.recordFailure },
      projectId,
      {
        name,
        kind,
        rule: kind === "project" ? projectIdRule(user) : SEMANTIC_ID_RULES[kind],
        taken: taken ?? [],
        reserved,
      },
    );
    return c.json(res);
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "SuggestIdRoutes.routes",
        prefix: "/api/projects/:projectId/suggest-id",
        auth: "user",
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
  @Use() private readonly benchmarks!: Benchmarks;
  @Use() private readonly orgService!: OrgService;
  @Use() private readonly settings!: Settings;
  @Use() private readonly errors!: Errors;
  @Use() private readonly log!: Log;
  @Bind("SuggestIdRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = suggestIdRoutes({
      access: this.access,
      projects: this.projects,
      agents: this.agents,
      benchmarks: this.benchmarks,
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
    });
  }
}
