import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import type { Hono } from "hono";
import { endpointOf } from "../http/app.js";
import type { Clock, Config, Paths } from "../hmr/capabilities.js";
import { memoryRoutes } from "../http/routes/memory.js";
import { benchmarksRoutes } from "../http/routes/benchmarks.js";
import { agentSkillsRoutes } from "../http/routes/skills.js";
import { agentArchiveRoutes } from "../http/routes/agent-archive.js";
import { agentTracesRoutes } from "../http/routes/agent-traces.js";
import { agentApiRoutes } from "../http/routes/agent-api.js";
import { agentAvatarRoutes } from "../http/routes/agent-avatar.js";
import type { AgentApi } from "@prismshadow/penguin-library-agent-api";
import type {
  AgentConfig,
  AgentLifecycle,
  Benchmarks,
  Memory,
  Snapshots,
} from "../mechanisms/agents.js";
import type { Access, ProjectConfigStore } from "@prismshadow/penguin-library-project";
import type { Settings } from "@prismshadow/penguin-library-setting";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import type { TraceIndex, TraceIndexStore, Traces } from "@prismshadow/penguin-library-trace";
import type { Workbenches } from "../mechanisms/workbenches.js";

/**
 * The Agent-scoped route groups: memory, skills, the API tab's settings and keys, the Agent's
 * own avatar, export and import, traces — and benchmarks, which are Project-level peers of an Agent but read through the same
 * services.
 */
@Component({
  contributes: {
    "AgentAuthPermissionProvider.roles": [
      { id: "role.agent.read", parents: ["readonly"] },
      { id: "role.agent.maintain", children: ["agent.read"], parents: ["general@self"] },
      { id: "role.agent.all", children: ["agent.maintain"], parents: ["system-maintainer"] },
      { id: "role.memory.read", parents: ["readonly"] },
      { id: "role.memory.maintain", children: ["memory.read"], parents: ["general@self"] },
      { id: "role.memory.all", children: ["memory.maintain"], parents: ["system-maintainer"] },
      { id: "role.skill.read", parents: ["readonly"] },
      { id: "role.skill.maintain", children: ["skill.read"] },
      { id: "role.skill.all", children: ["skill.maintain"], parents: ["system-maintainer"] },
      { id: "role.trace.read", parents: ["readonly"] },
      { id: "role.trace.maintain", children: ["trace.read"] },
      { id: "role.trace.all", children: ["trace.maintain"], parents: ["system-maintainer"] },
      { id: "role.benchmark.read", parents: ["readonly"] },
      { id: "role.benchmark.maintain", children: ["benchmark.read"] },
      {
        id: "role.benchmark.all",
        children: ["benchmark.maintain"],
        parents: ["system-maintainer"],
      },
    ],
    "HttpModule.routes": [
      {
        id: "benchmark.list",
        method: "GET",
        prefix: "/api/projects/:projectId/benchmarks",
        auth: "user",
        role: "benchmark.read",
        order: 165,
      },
      {
        id: "benchmark.create",
        method: "POST",
        prefix: "/api/projects/:projectId/benchmarks",
        auth: "user",
        role: "benchmark.maintain",
        order: 165,
      },
      {
        id: "benchmark.delete",
        method: "DELETE",
        prefix: "/api/projects/:projectId/benchmarks/:benchmarkId",
        auth: "user",
        role: "benchmark.all",
        order: 165,
      },
      {
        id: "benchmark.importArchive",
        method: "POST",
        prefix: "/api/projects/:projectId/benchmarks/archive",
        auth: "user",
        role: "benchmark.maintain",
        order: 165,
      },
      {
        id: "benchmark.exportArchive",
        method: "GET",
        prefix: "/api/projects/:projectId/benchmarks/:benchmarkId/archive",
        auth: "user",
        role: "benchmark.read",
        order: 165,
      },
      {
        id: "benchmark.listCases",
        method: "GET",
        prefix: "/api/projects/:projectId/benchmarks/:benchmarkId/cases",
        auth: "user",
        role: "benchmark.read",
        order: 165,
      },
      {
        id: "benchmark.listCaseFiles",
        method: "GET",
        prefix: "/api/projects/:projectId/benchmarks/:benchmarkId/cases/:caseId/files",
        auth: "user",
        role: "benchmark.read",
        order: 165,
      },
      {
        id: "benchmark.readCaseFile",
        method: "GET",
        prefix: "/api/projects/:projectId/benchmarks/:benchmarkId/cases/:caseId/files/content",
        auth: "user",
        role: "benchmark.read",
        order: 165,
      },
      {
        id: "benchmark.listRubricFiles",
        method: "GET",
        prefix: "/api/projects/:projectId/benchmarks/:benchmarkId/cases/:caseId/rubric/files",
        auth: "user",
        role: "benchmark.read",
        order: 165,
      },
      {
        id: "benchmark.readRubricFile",
        method: "GET",
        prefix:
          "/api/projects/:projectId/benchmarks/:benchmarkId/cases/:caseId/rubric/files/content",
        auth: "user",
        role: "benchmark.read",
        order: 165,
      },
      {
        id: "memory.get",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/memory",
        auth: "user",
        role: "memory.read",
        order: 190,
      },
      {
        id: "memory.templatePlaceholder",
        method: "POST",
        prefix: "/api/projects/:projectId/agents/:agentId/memory/template-placeholder",
        auth: "user",
        role: "memory.maintain",
        order: 190,
      },
      {
        id: "memory.listFiles",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/memory/scopes/:scopeKey/files",
        auth: "user",
        role: "memory.read",
        order: 190,
      },
      {
        id: "memory.readFile",
        method: "GET",
        prefix:
          "/api/projects/:projectId/agents/:agentId/memory/scopes/:scopeKey/files/:filePath{.+}",
        auth: "user",
        role: "memory.read",
        order: 190,
      },
      {
        id: "memory.export",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/memory/scopes/:scopeKey/export",
        auth: "user",
        role: "memory.read",
        order: 190,
      },
      {
        id: "memory.import",
        method: "POST",
        prefix: "/api/projects/:projectId/agents/:agentId/memory/scopes/:scopeKey/import",
        auth: "user",
        role: "memory.maintain",
        order: 190,
      },
      {
        id: "memory.deleteFile",
        method: "DELETE",
        prefix:
          "/api/projects/:projectId/agents/:agentId/memory/scopes/:scopeKey/files/:filePath{.+}",
        auth: "user",
        role: "memory.all",
        order: 190,
      },
      {
        id: "skill.list",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/skills",
        auth: "user",
        role: "skill.read",
        order: 220,
      },
      {
        id: "skill.templatePlaceholder",
        method: "POST",
        prefix: "/api/projects/:projectId/agents/:agentId/skills/template-placeholder",
        auth: "user",
        role: "skill.maintain",
        order: 220,
      },
      {
        id: "skill.importArchive",
        method: "POST",
        prefix: "/api/projects/:projectId/agents/:agentId/skills/archive",
        auth: "user",
        role: "skill.maintain",
        order: 220,
      },
      {
        id: "skill.exportArchive",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/skills/:name/archive",
        auth: "user",
        role: "skill.read",
        order: 220,
      },
      {
        id: "skill.getIcon",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/skills/:name/icon",
        auth: "user",
        role: "skill.read",
        order: 220,
      },
      {
        id: "skill.delete",
        method: "DELETE",
        prefix: "/api/projects/:projectId/agents/:agentId/skills/:name",
        auth: "user",
        role: "skill.all",
        order: 220,
      },
      {
        id: "agent.api.get",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/api",
        auth: "user",
        role: "agent.read",
        order: 225,
      },
      {
        id: "agent.api.update",
        method: "PUT",
        prefix: "/api/projects/:projectId/agents/:agentId/api",
        auth: "user",
        role: "agent.all",
        order: 225,
      },
      {
        id: "agent.api.createKey",
        method: "POST",
        prefix: "/api/projects/:projectId/agents/:agentId/api/keys",
        auth: "user",
        role: "agent.all",
        order: 225,
      },
      {
        id: "agent.api.deleteKey",
        method: "DELETE",
        prefix: "/api/projects/:projectId/agents/:agentId/api/keys/:keyId",
        auth: "user",
        role: "agent.all",
        order: 225,
      },
      {
        id: "agent.avatar.get",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/avatar",
        auth: "user",
        role: "agent.read",
        order: 228,
      },
      {
        id: "agent.avatar.update",
        method: "PUT",
        prefix: "/api/projects/:projectId/agents/:agentId/avatar",
        auth: "user",
        role: "agent.maintain",
        order: 228,
      },
      {
        id: "agent.archive.export",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/archive",
        auth: "user",
        role: "agent.read",
        order: 230,
      },
      {
        id: "agent.archive.import",
        method: "POST",
        prefix: "/api/projects/:projectId/agents/import",
        auth: "user",
        role: "agent.maintain",
        order: 230,
      },
      {
        id: "trace.list",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/traces",
        auth: "user",
        role: "trace.read",
        order: 240,
      },
      {
        id: "trace.get",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/traces/:sessionId/:index",
        auth: "user",
        role: "trace.read",
        order: 240,
      },
      {
        id: "trace.getAnalysis",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/traces/:sessionId/:index/analysis",
        auth: "user",
        role: "trace.read",
        order: 240,
      },
      {
        id: "trace.download",
        method: "GET",
        prefix: "/api/projects/:projectId/agents/:agentId/traces/:sessionId/:index/download",
        auth: "user",
        role: "trace.read",
        order: 240,
      },
      {
        id: "trace.import",
        method: "POST",
        prefix: "/api/projects/:projectId/agents/:agentId/traces/import",
        auth: "user",
        role: "trace.maintain",
        order: 240,
      },
    ],
  },
})
export class AgentRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly paths!: Paths;
  @Use() private readonly access!: Access;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly memory!: Memory;
  @Use() private readonly snapshots!: Snapshots;
  @Use() private readonly benchmarks!: Benchmarks;
  @Use() private readonly traces!: Traces;
  @Use() private readonly agentApi!: AgentApi;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly clock!: Clock;
  @Use() private readonly settings!: Settings;
  @Use() private readonly workbenches!: Workbenches;
  @Use() private readonly agents!: AgentLifecycle;
  @Use() private readonly traceIndex!: TraceIndex;
  @Use() private readonly traceStore!: TraceIndexStore;
  @Use() private readonly sessions!: SessionIndex;
  @Bind("benchmark.list") benchmarkListRoute!: Hono<AppEnv>;
  @Bind("benchmark.create") benchmarkCreateRoute!: Hono<AppEnv>;
  @Bind("benchmark.delete") benchmarkDeleteRoute!: Hono<AppEnv>;
  @Bind("benchmark.importArchive") benchmarkImportArchiveRoute!: Hono<AppEnv>;
  @Bind("benchmark.exportArchive") benchmarkExportArchiveRoute!: Hono<AppEnv>;
  @Bind("benchmark.listCases") benchmarkListCasesRoute!: Hono<AppEnv>;
  @Bind("benchmark.listCaseFiles") benchmarkListCaseFilesRoute!: Hono<AppEnv>;
  @Bind("benchmark.readCaseFile") benchmarkReadCaseFileRoute!: Hono<AppEnv>;
  @Bind("benchmark.listRubricFiles") benchmarkListRubricFilesRoute!: Hono<AppEnv>;
  @Bind("benchmark.readRubricFile") benchmarkReadRubricFileRoute!: Hono<AppEnv>;
  @Bind("memory.get") memoryGetRoute!: Hono<AppEnv>;
  @Bind("memory.templatePlaceholder") memoryTemplatePlaceholderRoute!: Hono<AppEnv>;
  @Bind("memory.listFiles") memoryListFilesRoute!: Hono<AppEnv>;
  @Bind("memory.readFile") memoryReadFileRoute!: Hono<AppEnv>;
  @Bind("memory.export") memoryExportRoute!: Hono<AppEnv>;
  @Bind("memory.import") memoryImportRoute!: Hono<AppEnv>;
  @Bind("memory.deleteFile") memoryDeleteFileRoute!: Hono<AppEnv>;
  @Bind("skill.list") skillListRoute!: Hono<AppEnv>;
  @Bind("skill.templatePlaceholder") skillTemplatePlaceholderRoute!: Hono<AppEnv>;
  @Bind("skill.importArchive") skillImportArchiveRoute!: Hono<AppEnv>;
  @Bind("skill.exportArchive") skillExportArchiveRoute!: Hono<AppEnv>;
  @Bind("skill.getIcon") skillGetIconRoute!: Hono<AppEnv>;
  @Bind("skill.delete") skillDeleteRoute!: Hono<AppEnv>;
  @Bind("agent.api.get") apiGetRoute!: Hono<AppEnv>;
  @Bind("agent.api.update") apiUpdateRoute!: Hono<AppEnv>;
  @Bind("agent.api.createKey") apiCreateKeyRoute!: Hono<AppEnv>;
  @Bind("agent.api.deleteKey") apiDeleteKeyRoute!: Hono<AppEnv>;
  @Bind("agent.avatar.get") avatarGetRoute!: Hono<AppEnv>;
  @Bind("agent.avatar.update") avatarUpdateRoute!: Hono<AppEnv>;
  @Bind("agent.archive.export") archiveExportRoute!: Hono<AppEnv>;
  @Bind("agent.archive.import") archiveImportRoute!: Hono<AppEnv>;
  @Bind("trace.list") traceListRoute!: Hono<AppEnv>;
  @Bind("trace.get") traceGetRoute!: Hono<AppEnv>;
  @Bind("trace.getAnalysis") traceGetAnalysisRoute!: Hono<AppEnv>;
  @Bind("trace.download") traceDownloadRoute!: Hono<AppEnv>;
  @Bind("trace.import") traceImportRoute!: Hono<AppEnv>;

  setup() {
    const access = this.access;
    const agentConfigService = this.agentConfig;
    const mGroup = memoryRoutes({ memoryService: this.memory, access });
    this.memoryGetRoute = endpointOf(mGroup, "GET", "/");
    this.memoryTemplatePlaceholderRoute = endpointOf(mGroup, "POST", "/template-placeholder");
    this.memoryListFilesRoute = endpointOf(mGroup, "GET", "/scopes/:scopeKey/files");
    this.memoryReadFileRoute = endpointOf(mGroup, "GET", "/scopes/:scopeKey/files/:filePath{.+}");
    this.memoryExportRoute = endpointOf(mGroup, "GET", "/scopes/:scopeKey/export");
    this.memoryImportRoute = endpointOf(mGroup, "POST", "/scopes/:scopeKey/import");
    this.memoryDeleteFileRoute = endpointOf(
      mGroup,
      "DELETE",
      "/scopes/:scopeKey/files/:filePath{.+}",
    );
    const bGroup = benchmarksRoutes({ benchmarks: this.benchmarks, access });
    this.benchmarkListRoute = endpointOf(bGroup, "GET", "/");
    this.benchmarkCreateRoute = endpointOf(bGroup, "POST", "/");
    this.benchmarkDeleteRoute = endpointOf(bGroup, "DELETE", "/:benchmarkId");
    this.benchmarkImportArchiveRoute = endpointOf(bGroup, "POST", "/archive");
    this.benchmarkExportArchiveRoute = endpointOf(bGroup, "GET", "/:benchmarkId/archive");
    this.benchmarkListCasesRoute = endpointOf(bGroup, "GET", "/:benchmarkId/cases");
    this.benchmarkListCaseFilesRoute = endpointOf(
      bGroup,
      "GET",
      "/:benchmarkId/cases/:caseId/files",
    );
    this.benchmarkReadCaseFileRoute = endpointOf(
      bGroup,
      "GET",
      "/:benchmarkId/cases/:caseId/files/content",
    );
    this.benchmarkListRubricFilesRoute = endpointOf(
      bGroup,
      "GET",
      "/:benchmarkId/cases/:caseId/rubric/files",
    );
    this.benchmarkReadRubricFileRoute = endpointOf(
      bGroup,
      "GET",
      "/:benchmarkId/cases/:caseId/rubric/files/content",
    );
    const sGroup = agentSkillsRoutes({ agentConfigService, config: this.config, access });
    this.skillListRoute = endpointOf(sGroup, "GET", "/");
    this.skillTemplatePlaceholderRoute = endpointOf(sGroup, "POST", "/template-placeholder");
    this.skillImportArchiveRoute = endpointOf(sGroup, "POST", "/archive");
    this.skillExportArchiveRoute = endpointOf(sGroup, "GET", "/:name/archive");
    this.skillGetIconRoute = endpointOf(sGroup, "GET", "/:name/icon");
    this.skillDeleteRoute = endpointOf(sGroup, "DELETE", "/:name");
    const clock = this.clock;
    const apiGroup = agentApiRoutes({
      agentApi: this.agentApi,
      projectConfig: this.projectConfig,
      agentConfigService,
      access,
      settings: this.settings,
      now: () => clock.now(),
    });
    this.apiGetRoute = endpointOf(apiGroup, "GET", "/");
    this.apiUpdateRoute = endpointOf(apiGroup, "PUT", "/");
    this.apiCreateKeyRoute = endpointOf(apiGroup, "POST", "/keys");
    this.apiDeleteKeyRoute = endpointOf(apiGroup, "DELETE", "/keys/:keyId");
    const avGroup = agentAvatarRoutes({
      root: this.paths.root,
      agentConfigService,
      access,
    });
    this.avatarGetRoute = endpointOf(avGroup, "GET", "/");
    this.avatarUpdateRoute = endpointOf(avGroup, "PUT", "/");
    const arGroup = agentArchiveRoutes({
      root: this.paths.root,
      access,
      agentConfig: agentConfigService,
      agents: this.agents,
      snapshots: this.snapshots,
      traces: this.traces,
      workbenches: this.workbenches,
      traceIndex: this.traceIndex,
      traceStore: this.traceStore,
      sessions: this.sessions,
      now: () => clock.now(),
    });
    this.archiveExportRoute = endpointOf(arGroup, "GET", "/:agentId/archive");
    this.archiveImportRoute = endpointOf(arGroup, "POST", "/import");
    const tGroup = agentTracesRoutes({
      agentConfigService,
      access,
      traceService: this.traces,
    });
    this.traceListRoute = endpointOf(tGroup, "GET", "/");
    this.traceGetRoute = endpointOf(tGroup, "GET", "/:sessionId/:index");
    this.traceGetAnalysisRoute = endpointOf(tGroup, "GET", "/:sessionId/:index/analysis");
    this.traceDownloadRoute = endpointOf(tGroup, "GET", "/:sessionId/:index/download");
    this.traceImportRoute = endpointOf(tGroup, "POST", "/import");
  }
}
