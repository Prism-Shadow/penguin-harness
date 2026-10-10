/**
 * Every endpoint the Web App calls (`packages/web/src/api/endpoints.ts`), answered from the
 * demo store. Reads answer the fixtures; writes mutate them where the app shows the result
 * (a renamed Session, a saved model table, a new schedule) and answer `demo_read_only` where
 * the operation would need a machine, a registry or a provider behind it. Each handler's
 * return is annotated with the contract type it stands for, so a DTO change fails here
 * before it fails in the app.
 *
 * Grouped as endpoints.ts groups them, in its order.
 */
import type {
  AdminUserCreateResponse,
  AdminUsersResponse,
  AgentApiKeyCreateResponse,
  AgentApiKeyInfo,
  AgentApiResponse,
  AgentApiSettings,
  AgentConfigResponse,
  AgentCreateResponse,
  AgentHooksResponse,
  AgentKernelUpdateResponse,
  AgentPluginsInstallResponse,
  AgentSchedulesConfigDto,
  AgentSkillsConfigDto,
  AgentSkillsResponse,
  AgentsResponse,
  AgentVaultConfigDto,
  ApprovalMode,
  AuthResponse,
  BenchmarkCasesResponse,
  BrowserBackendResponse,
  BrowserExtensionPairingResponse,
  BrowserExtensionsResponse,
  BuiltinBrowserHistoryResponse,
  BuiltinBrowserImportSourcesResponse,
  BuiltinBrowserSettings,
  BuiltinBrowserStatus,
  BenchmarkCreateResponse,
  BenchmarksResponse,
  CaseMaterial,
  ChatDefaultsDto,
  CommandPolicyDto,
  DefaultModelResponse,
  DesktopTrayStatusResponse,
  DesktopUpdateStatusResponse,
  DirectorySkillsResponse,
  DirListResponse,
  EndpointModelListResponse,
  FilesStatResponse,
  GoalResponse,
  InstallResponse,
  InstalledPluginsResponse,
  MachinesResponse,
  MachinesUseResponse,
  McpServerTestResponse,
  MemberAddResponse,
  MembersResponse,
  MemoryFileResponse,
  MemoryFilesResponse,
  MemoryImportResponse,
  MemoryOverviewResponse,
  MemoryScopeExport,
  MeResponse,
  LanguageIndexResponse,
  MessagesResponse,
  MessagingBindingsResponse,
  ModelBalanceResponse,
  ModelProtocolDetectResponse,
  ModelsResponse,
  PresetSyncResponse,
  ProviderConnectionDto,
  ProviderConnectionUpdate,
  ModelTestResponse,
  ModelVisionDetectResponse,
  OrganizationsResponse,
  PluginConfigActionResponse,
  PluginConfigResponse,
  PluginFilesResponse,
  PluginIndexResponse,
  PluginLibraryResponse,
  PluginReadmeResponse,
  PrefsResponse,
  ProjectSchedulesResponse,
  ProjectsResponse,
  ProjectUpdateResponse,
  ProxyProbeResponse,
  ProxyProbeTargetsResponse,
  RestartResponse,
  RetryNowResponse,
  ScheduleItem,
  SchedulesResponse,
  SemanticIdSuggestResponse,
  ServerSettingsResponse,
  SessionCategory,
  SessionCategoryCounts,
  SessionContextResponse,
  SessionCreateResponse,
  SessionForkResponse,
  SessionInfo,
  SessionProcessesResponse,
  SessionResponse,
  SessionTracesResponse,
  SshHostResponse,
  SubagentMessageResponse,
  TaskCreateResponse,
  TraceAnalysisResponse,
  TraceEventsResponse,
  TraceImportResponse,
  UpdateCheckResponse,
  UpdateJobStatus,
  UpdateProfileResponse,
  UsageErrorsClearResponse,
  UsageErrorsPage,
  UsageGranularity,
  UsageGroupBy,
  UsageModelTotals,
  UsageResponse,
  UserInfo,
  VaultResponse,
  VersionHistoryResponse,
  VersionResponse,
  WorkflowInfo,
  WorkspaceFilesResponse,
  WorkspaceSearchResponse,
} from "@prismshadow/penguin-server/api";
// The catalog decides which groups publish a balance, as it does on the server.
import { catalogEntryFor, providerInfo } from "../../../../core/dist/state/model-catalog.js";
import { READ_ONLY } from "./errors";
import { amspTryStream, dayKey, effectiveOf } from "./fixtures";
import type { UsageDay } from "./fixtures";
import { IDS } from "./ids";
import { empty, fail, json, raw, Router } from "./router";
import type { RequestContext } from "./router";
import type { DemoStore } from "./store";
import { payloadOf } from "./types";
import type { OmniMessage } from "./types";

type Ctx = RequestContext;

const record = (body: unknown): Record<string, unknown> =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};

const str = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

/** Function declarations rather than arrows: only those narrow control flow as `never` calls. */
function readOnly(what: string): never {
  return fail(409, READ_ONLY, `The gallery's demo cannot ${what}; it has no server behind it.`);
}

function notFound(what: string): never {
  return fail(404, "not_found", `${what} not found.`);
}

/** The cost of a Token bucket at the demo's default rates (USD per million). */
function costOf(day: Pick<UsageDay, "cacheRead" | "cacheWrite" | "output" | "provider">): number {
  const rate =
    day.provider === "anthropic"
      ? { cacheRead: 0.2, cacheWrite: 2.5, output: 10 }
      : { cacheRead: 0.0057, cacheWrite: 0.2857, output: 1.1429 };
  return (
    (day.cacheRead * rate.cacheRead + day.cacheWrite * rate.cacheWrite + day.output * rate.output) /
    1_000_000
  );
}

export const router = new Router();

// ---------------------------------------------------------------------------------------------
// Auth & user
// ---------------------------------------------------------------------------------------------

router
  .public("/api/auth/login", "/api/auth/logout", "/api/install", "/api/version")
  .post("/api/auth/login", ({ store, body }): AuthResponse => {
    const { userId, password } = record(body);
    if (str(password).length === 0) fail(401, "invalid_credentials", "Wrong user id or password.");
    if (userId !== undefined && userId !== store.f.user.userId) {
      fail(401, "invalid_credentials", "Wrong user id or password.");
    }
    store.signedIn = true;
    return { user: store.f.user };
  })
  .post("/api/auth/logout", ({ store }) => {
    store.signedIn = false;
    return empty();
  })
  .get("/api/install", (): InstallResponse => ({ installId: "gallery-demo" }))
  .get("/api/me", ({ store }): MeResponse => ({ user: store.f.user, ...store.f.me }))
  .put("/api/me/password", () => empty())
  .put("/api/me/profile", ({ store, body }): UpdateProfileResponse => {
    const patch = record(body);
    const user: UserInfo = { ...store.f.user };
    if (patch.displayName === null) delete user.displayName;
    else if (typeof patch.displayName === "string") user.displayName = patch.displayName;
    if (patch.avatar === null) delete user.avatar;
    else if (typeof patch.avatar === "string") user.avatar = patch.avatar;
    store.f.user = user;
    return { user };
  })
  .get("/api/me/prefs", ({ store }): PrefsResponse => ({ prefs: store.f.prefs }))
  .put("/api/me/prefs", ({ store, body }): PrefsResponse => {
    store.f.prefs = { ...store.f.prefs, ...record(body) };
    return { prefs: store.f.prefs };
  });

// ---------------------------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------------------------

router
  .get("/api/admin/users", ({ store }): AdminUsersResponse => ({ users: store.f.users }))
  .post("/api/admin/users", ({ store, body }): unknown => {
    const userId = str(record(body).userId, "new-user");
    const user: UserInfo = {
      userId,
      isAdmin: false,
      passwordIsInitial: true,
      createdAt: new Date().toISOString(),
    };
    store.f.users.push(user);
    return json({ user } satisfies AdminUserCreateResponse, 201);
  })
  .post("/api/admin/users/:userId/password", () => empty())
  .delete("/api/admin/users/:userId", ({ store, params }) => {
    store.f.users = store.f.users.filter((u) => u.userId !== params.userId);
    return empty();
  })
  .get("/api/admin/settings", ({ store }): ServerSettingsResponse => ({
    settings: store.f.serverSettings,
  }))
  .put("/api/admin/settings", ({ store, body }): ServerSettingsResponse => {
    store.f.serverSettings = { ...store.f.serverSettings, ...record(body) };
    return { settings: store.f.serverSettings };
  })
  .get("/api/admin/plugin-config", ({ store }): PluginConfigResponse => ({
    plugins: store.f.pluginConfig,
  }))
  .put("/api/admin/plugin-config", ({ store, body }): PluginConfigResponse => {
    const { name, values } = record(body);
    const entry = store.f.pluginConfig.find((p) => p.name === name);
    if (entry) entry.values = { ...entry.values, ...record(values) };
    return { plugins: store.f.pluginConfig };
  })
  .post("/api/admin/plugin-config/action", ({ store }): PluginConfigActionResponse => ({
    ok: true,
    message: "The sandbox confined the command as configured.",
    messageZh: "沙箱按配置隔离了命令。",
    plugins: store.f.pluginConfig,
  }))
  .get(
    "/api/admin/settings/proxy-probe",
    ({ store }): ProxyProbeTargetsResponse => store.f.probeTargets,
  )
  .post("/api/admin/settings/proxy-probe/:provider", ({ store, params }): ProxyProbeResponse => {
    const target = store.f.probeTargets.targets.find((t) => t.provider === params.provider);
    if (!target) notFound("Probe target");
    return { probe: { ...target, outcome: "reachable", ms: 180 + target.url.length, status: 401 } };
  });

// ---------------------------------------------------------------------------------------------
// Projects & members
// ---------------------------------------------------------------------------------------------

router
  .get("/api/projects", ({ store }): ProjectsResponse => ({ projects: [store.f.project] }))
  .post("/api/projects", (): unknown => readOnly("create a Project"))
  .patch("/api/projects/:projectId", ({ store, body }): ProjectUpdateResponse => {
    store.f.project.name = str(record(body).name, store.f.project.name);
    return { project: store.f.project };
  })
  .delete("/api/projects/:projectId", () => readOnly("delete the Project"))
  .get("/api/projects/:projectId/members", ({ store }): MembersResponse => ({
    members: store.f.members,
  }))
  .post("/api/projects/:projectId/members", ({ store, body }): unknown => {
    const member = {
      userId: str(record(body).userId, "guest"),
      role: "member" as const,
      createdAt: new Date().toISOString(),
    };
    store.f.members.push(member);
    return json({ member } satisfies MemberAddResponse, 201);
  })
  .delete("/api/projects/:projectId/members/:userId", ({ store, params }) => {
    store.f.members = store.f.members.filter((m) => m.userId !== params.userId);
    return empty();
  })
  .get(
    "/api/projects/:projectId/chat-defaults",
    ({ store }): ChatDefaultsDto => store.f.chatDefaults,
  )
  .put("/api/projects/:projectId/chat-defaults", ({ store, body }): ChatDefaultsDto => {
    const { sandbox } = store.f.chatDefaults;
    store.f.chatDefaults = {
      ...(record(body) as ChatDefaultsDto),
      ...(sandbox ? { sandbox } : {}),
    };
    return store.f.chatDefaults;
  })
  .get(
    "/api/projects/:projectId/command-policy",
    ({ store }): CommandPolicyDto => store.f.commandPolicy,
  )
  .put("/api/projects/:projectId/command-policy", ({ store, body }): CommandPolicyDto => {
    const { enabled, rules } = record(body);
    store.f.commandPolicy = {
      ...store.f.commandPolicy,
      enabled: typeof enabled === "boolean" ? enabled : store.f.commandPolicy.enabled,
      rules: Array.isArray(rules)
        ? (rules as CommandPolicyDto["rules"]).map((r) => ({ ...r, enabled: r.enabled !== false }))
        : store.f.commandPolicy.rules,
    };
    return store.f.commandPolicy;
  });

// ---------------------------------------------------------------------------------------------
// Models and provider keys
// ---------------------------------------------------------------------------------------------

/** A key as GET /models shows it. */
const maskKey = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;

/** One group's connection after an update, as the server stores it (omitted fields kept); any group takes a protocol. */
function updatedConnection(
  current: ProviderConnectionDto | undefined,
  update: ProviderConnectionUpdate,
): ProviderConnectionDto {
  const next: ProviderConnectionDto = { ...(current ?? {}) };
  if (update.baseUrl === null || update.baseUrl === "") delete next.baseUrl;
  else if (typeof update.baseUrl === "string") next.baseUrl = update.baseUrl;
  if (update.clientType === null || update.clientType === "") delete next.clientType;
  else if (typeof update.clientType === "string") next.clientType = update.clientType;
  if (update.clearApiKey === true) {
    delete next.apiKeyMasked;
    delete next.createdAt;
  }
  if (typeof update.apiKey === "string" && update.apiKey !== "") {
    next.apiKeyMasked = maskKey(update.apiKey);
    next.createdAt = new Date().toISOString();
  }
  return next;
}

/** Writes group connections, then re-resolves every model's effective connection. */
function writeProviders(store: DemoStore, updates: Record<string, ProviderConnectionUpdate>): void {
  const providers = { ...store.f.models.providers };
  for (const [id, update] of Object.entries(updates)) {
    const next = updatedConnection(providers[id], update);
    if (Object.keys(next).length > 0) providers[id] = next;
    else delete providers[id];
  }
  store.f.models.providers = providers;
  refreshEffective(store);
}

function refreshEffective(store: DemoStore): void {
  const { providers } = store.f.models;
  store.f.models.models = store.f.models.models.map((m) => ({
    ...m,
    effective: effectiveOf(m, providers),
  }));
}

router
  .get("/api/projects/:projectId/models", ({ store }): ModelsResponse => store.f.models)
  .put("/api/projects/:projectId/models", ({ store, body }): ModelsResponse => {
    const { defaultModel, visionModel, models, providers } = record(body) as Partial<{
      defaultModel: ModelsResponse["defaultModel"];
      visionModel: ModelsResponse["visionModel"];
      models: Array<Record<string, unknown>>;
      providers: Record<string, ProviderConnectionUpdate>;
    }>;
    if (Array.isArray(models)) {
      store.f.models.models = models.map((entry) => {
        const existing = store.f.models.models.find(
          (m) => m.provider === entry.provider && m.modelId === entry.modelId,
        );
        const { apiKey, clearApiKey, baseUrl, renamedFrom, discount, ...rest } = entry;
        const credential = { ...(existing?.credential ?? {}) };
        if (typeof apiKey === "string" && apiKey !== "") {
          credential.apiKeyMasked = maskKey(apiKey);
          credential.createdAt = new Date().toISOString();
        }
        if (clearApiKey === true) delete credential.apiKeyMasked;
        if (typeof baseUrl === "string") credential.baseUrl = baseUrl;
        if (baseUrl === null) delete credential.baseUrl;
        void renamedFrom;
        const next = {
          ...(existing ?? {}),
          ...(rest as Partial<ModelsResponse["models"][number]>),
          provider: str(entry.provider),
          modelId: str(entry.modelId),
          isDefault:
            defaultModel?.provider === entry.provider && defaultModel?.modelId === entry.modelId,
        } as ModelsResponse["models"][number];
        if (Object.keys(credential).length > 0) next.credential = credential;
        else delete next.credential;
        if (typeof discount === "number") next.discount = discount;
        else if (discount === null) delete next.discount;
        return next;
      });
    }
    if (defaultModel) store.f.models.defaultModel = defaultModel;
    if (visionModel) store.f.models.visionModel = visionModel;
    writeProviders(store, providers ?? {});
    store.f.models.updatedAt = new Date().toISOString();
    return store.f.models;
  })
  .put(
    "/api/projects/:projectId/models/providers/:provider",
    ({ store, params, body }): ModelsResponse => {
      writeProviders(store, { [str(params.provider)]: record(body) as ProviderConnectionUpdate });
      store.f.models.updatedAt = new Date().toISOString();
      return store.f.models;
    },
  )
  // The demo table already holds every preset: an add finds nothing, and a restore resets
  // the built-in models where they stand (the demo's own edits are not tracked, so nothing
  // visible moves).
  .post("/api/projects/:projectId/models/sync-presets", ({ store, body }): PresetSyncResponse => {
    const restore = record(body).mode === "restore";
    const builtIn = store.f.models.models.filter(
      (m) => catalogEntryFor(m.provider, m.modelId) !== undefined,
    ).length;
    return { ...store.f.models, added: 0, restored: restore ? builtIn : 0 };
  })
  .put("/api/projects/:projectId/models/default", ({ store, body }): DefaultModelResponse => {
    const { provider, modelId } = record(body);
    const ref = { provider: str(provider), modelId: str(modelId) };
    store.f.models.defaultModel = ref;
    for (const m of store.f.models.models) {
      m.isDefault = m.provider === ref.provider && m.modelId === ref.modelId;
    }
    return { defaultModel: ref };
  })
  .get("/api/projects/:projectId/models/balance", ({ store, query }): ModelBalanceResponse => {
    const provider = query.get("provider") ?? "";
    const fetchedAt = new Date().toISOString();
    const info = providerInfo(provider);
    if (info?.balance === undefined) {
      const message = `The ${provider} group publishes no balance.`;
      return { ok: false, provider, error: "unsupported", message, fetchedAt };
    }
    // The group's own key, as the server reads it; a key set on one model does not count.
    const keyed = store.f.models.providers[provider]?.apiKeyMasked !== undefined;
    if (!keyed) {
      const message = `The ${info.label} group stores no API key.`;
      return { ok: false, provider, error: "no_key", message, fetchedAt };
    }
    return { ok: true, provider, amount: "110.00", currency: "CNY", fetchedAt };
  })
  .post("/api/projects/:projectId/models/test", (): ModelTestResponse => ({
    ok: true,
    latencyMs: 640,
    ttftMs: 410,
    tps: 62.5,
  }))
  .post("/api/projects/:projectId/models/detect", ({ body }): ModelProtocolDetectResponse => {
    const baseUrl = str(record(body).baseUrl, "https://example.invalid");
    return {
      detected: "openai-chat",
      baseUrl: baseUrl.replace(/\/+$/, ""),
      probes: [
        {
          clientType: "openai-responses",
          url: `${baseUrl}/responses`,
          outcome: "route_missing",
          status: 404,
        },
        {
          clientType: "ant-messages",
          url: `${baseUrl}/messages`,
          outcome: "route_missing",
          status: 404,
        },
        {
          clientType: "openai-chat",
          url: `${baseUrl}/chat/completions`,
          outcome: "served",
          status: 401,
        },
      ],
    };
  })
  .post("/api/projects/:projectId/models/list", (): EndpointModelListResponse => ({
    ok: true,
    models: ["qwen3.8-27b-local", "qwen3.6-35b-a3b"],
  }))
  .post("/api/projects/:projectId/models/detect-vision", (): ModelVisionDetectResponse => ({
    outcome: "unsupported",
  }))
  .post("/api/projects/:projectId/model-oauth/start", () =>
    readOnly("open a provider authorization flow"),
  )
  .get("/api/projects/:projectId/model-oauth/:flowId", () => notFound("Authorization flow"))
  .post("/api/projects/:projectId/model-oauth/:flowId/code", () => notFound("Authorization flow"));

for (const route of ["platform-auth", "modelscope-auth"]) {
  router
    .post(`/api/projects/:projectId/${route}/start`, () => readOnly("start a key authorization"))
    .get(`/api/projects/:projectId/${route}/:flowId/status`, () =>
      fail(404, `${route.replace("-", "_")}_flow_not_found`, "No such flow."),
    )
    .post(`/api/projects/:projectId/${route}/:flowId/retry`, () =>
      fail(404, `${route.replace("-", "_")}_flow_not_found`, "No such flow."),
    )
    .post(`/api/projects/:projectId/${route}/:flowId/cancel`, () => ({ ok: true }));
}
router.post("/api/projects/:projectId/platform-auth/sync", ({ store }): unknown => ({
  ...store.f.models,
  added: 0,
  updated: 0,
}));

// ---------------------------------------------------------------------------------------------
// Vault, template placeholders, memory
// ---------------------------------------------------------------------------------------------

const agentOf = ({ store, params }: Ctx) => {
  const agent = store.f.agents.find((a) => a.agentId === params.agentId);
  if (!agent) notFound("Agent");
  return agent;
};
const configOf = (ctx: Ctx): AgentConfigResponse => {
  const config = ctx.store.f.agentConfigs[agentOf(ctx).agentId];
  if (!config) notFound("Agent config");
  return config;
};

router
  .get(
    "/api/projects/:projectId/agents/:agentId/vault",
    (ctx): VaultResponse => ctx.store.f.vault[agentOf(ctx).agentId] ?? { entries: [] },
  )
  .put("/api/projects/:projectId/agents/:agentId/vault", (ctx): VaultResponse => {
    const agentId = agentOf(ctx).agentId;
    const entries = record(ctx.body).entries;
    const previous = ctx.store.f.vault[agentId]?.entries ?? [];
    const next: VaultResponse = {
      entries: Array.isArray(entries)
        ? (entries as Array<{ key: string; value?: string }>).map((e) => ({
            key: e.key,
            valueMasked:
              typeof e.value === "string"
                ? `${e.value.slice(0, 3)}…${e.value.slice(-3)}`
                : (previous.find((p) => p.key === e.key)?.valueMasked ?? "***"),
          }))
        : previous,
    };
    ctx.store.f.vault[agentId] = next;
    return next;
  })
  .post(
    "/api/projects/:projectId/agents/:agentId/vault/template-placeholder",
    (ctx): AgentVaultConfigDto => {
      const config = configOf(ctx);
      config.config.vault = {
        ...config.config.vault,
        templateHasPlaceholder: true,
        legacySectionPresent: false,
      };
      return config.config.vault;
    },
  )
  .post(
    "/api/projects/:projectId/agents/:agentId/skills/template-placeholder",
    (ctx): AgentSkillsConfigDto => {
      const config = configOf(ctx);
      config.config.skills = {
        ...config.config.skills,
        templateHasPlaceholder: true,
        legacySectionPresent: false,
      };
      return config.config.skills;
    },
  )
  .post(
    "/api/projects/:projectId/agents/:agentId/schedules/template-placeholder",
    (ctx): AgentSchedulesConfigDto => {
      const config = configOf(ctx);
      config.config.schedules = { ...config.config.schedules, templateHasPlaceholder: true };
      return config.config.schedules;
    },
  );

const memoryOf = (ctx: Ctx) => {
  const memory = ctx.store.f.memory[agentOf(ctx).agentId];
  if (!memory) notFound("Memory");
  return memory;
};

router
  .get(
    "/api/projects/:projectId/agents/:agentId/memory",
    (ctx): MemoryOverviewResponse => memoryOf(ctx).overview,
  )
  .post(
    "/api/projects/:projectId/agents/:agentId/memory/template-placeholder",
    (ctx): MemoryOverviewResponse => {
      const memory = memoryOf(ctx);
      memory.overview.templateHasMemory = true;
      return memory.overview;
    },
  )
  .get(
    "/api/projects/:projectId/agents/:agentId/memory/scopes/:scopeKey/files",
    (ctx): MemoryFilesResponse => ({
      scopeKey: ctx.params.scopeKey!,
      files: memoryOf(ctx)
        .files.filter((f) => f.scopeKey === ctx.params.scopeKey)
        .map((f) => f.file),
    }),
  )
  .get(
    "/api/projects/:projectId/agents/:agentId/memory/scopes/:scopeKey/files/:name",
    (ctx): MemoryFileResponse => {
      const found = memoryOf(ctx).files.find(
        (f) => f.scopeKey === ctx.params.scopeKey && f.file.name === ctx.params.name,
      );
      if (!found) notFound("Memory file");
      return found;
    },
  )
  .delete("/api/projects/:projectId/agents/:agentId/memory/scopes/:scopeKey/files/:name", (ctx) => {
    const memory = memoryOf(ctx);
    memory.files = memory.files.filter(
      (f) => !(f.scopeKey === ctx.params.scopeKey && f.file.name === ctx.params.name),
    );
    const scope = memory.overview.scopes.find((s) => s.scopeKey === ctx.params.scopeKey);
    if (scope) scope.fileCount = memory.files.filter((f) => f.scopeKey === scope.scopeKey).length;
    return empty();
  })
  .get(
    "/api/projects/:projectId/agents/:agentId/memory/scopes/:scopeKey/export",
    (ctx): MemoryScopeExport => {
      const memory = memoryOf(ctx);
      const scope = memory.overview.scopes.find((s) => s.scopeKey === ctx.params.scopeKey);
      if (!scope) notFound("Memory scope");
      return {
        format: "penguin-memory-scope",
        version: 1,
        scopeKey: scope.scopeKey,
        kind: scope.kind,
        ...(scope.workspacePath ? { workspacePath: scope.workspacePath } : {}),
        exportedAt: new Date().toISOString(),
        index: scope.hasIndex ? "# Memory\n" : null,
        files: memory.files
          .filter((f) => f.scopeKey === scope.scopeKey)
          .map((f) => ({ name: f.file.name, content: f.content })),
      };
    },
  )
  .post(
    "/api/projects/:projectId/agents/:agentId/memory/scopes/:scopeKey/import",
    (ctx): MemoryImportResponse => ({
      scopeKey: ctx.params.scopeKey!,
      mode: "skip",
      added: [],
      overwritten: [],
      skipped: memoryOf(ctx)
        .files.filter((f) => f.scopeKey === ctx.params.scopeKey)
        .map((f) => f.file.name),
      removed: [],
      indexWritten: false,
    }),
  );

// ---------------------------------------------------------------------------------------------
// Agents and their config
// ---------------------------------------------------------------------------------------------

router
  .get("/api/projects/:projectId/agents", ({ store }): AgentsResponse => ({
    agents: store.f.agents,
  }))
  .post("/api/projects/:projectId/agents", ({ store, body }): unknown => {
    const { agentId, name, description } = record(body);
    const id = str(agentId, `agent-${store.f.agents.length + 1}`);
    if (store.f.agents.some((a) => a.agentId === id))
      fail(409, "agent_exists", "An Agent with that id exists.");
    const agent: AgentsResponse["agents"][number] = {
      agentId: id,
      name: str(name, id),
      ...(typeof description === "string" ? { description } : {}),
      createdAt: new Date().toISOString(),
      activeSessionCount: 0,
      sessionCount: 0,
      sessionActivity: Array.from({ length: 30 }, () => 0),
      toolCount: 4,
      version: 1,
      kernelOutdated: false,
      vaultKeyCount: 0,
      scheduleCount: 0,
      skillCount: 0,
      hookCount: 0,
      pluginUpdates: [],
      memoryCount: 0,
      apiEnabled: false,
    };
    store.f.agents.push(agent);
    const template = store.f.agentConfigs[IDS.agents.notes]!;
    store.f.agentConfigs[id] = {
      ...template,
      config: { ...template.config, name: agent.name, description: agent.description, version: 1 },
      stateDir: template.stateDir.replace(IDS.agents.notes, id),
      activeSessionCount: 0,
    };
    store.f.installed[id] = { skills: [], hooks: [] };
    store.f.vault[id] = { entries: [] };
    store.f.memory[id] = {
      overview: { ...store.f.memory[IDS.agents.notes]!.overview, scopes: [] },
      files: [],
    };
    return json({ agent } satisfies AgentCreateResponse, 201);
  })
  .get("/api/projects/:projectId/agents/:agentId/config", (ctx): AgentConfigResponse =>
    configOf(ctx),
  )
  .put("/api/projects/:projectId/agents/:agentId/config", (ctx): AgentConfigResponse => {
    const current = configOf(ctx);
    const { agentsMd, config } = record(ctx.body) as {
      agentsMd?: string;
      config?: Record<string, unknown>;
    };
    if (typeof agentsMd === "string") current.agentsMd = agentsMd;
    if (config) {
      const next = { ...current.config } as Record<string, unknown>;
      for (const [key, value] of Object.entries(config)) {
        const previous = next[key];
        next[key] =
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value) &&
          typeof previous === "object" &&
          previous !== null
            ? { ...(previous as Record<string, unknown>), ...(value as Record<string, unknown>) }
            : value;
      }
      current.config = next as unknown as AgentConfigResponse["config"];
      const agent = agentOf(ctx);
      if (typeof config.name === "string") agent.name = config.name;
      if (typeof config.description === "string") agent.description = config.description;
      agent.updatedAt = new Date().toISOString();
    }
    return current;
  })
  .post(
    "/api/projects/:projectId/agents/:agentId/config/mcp-test",
    ({ body }): McpServerTestResponse => ({
      ok: true,
      tools: [
        `mcp__${str(record(body).name, "server")}__read_file`,
        `mcp__${str(record(body).name, "server")}__list_directory`,
      ],
      latencyMs: 820,
    }),
  )
  .post("/api/projects/:projectId/agents/:agentId/config/reset", (ctx): AgentConfigResponse =>
    configOf(ctx),
  )
  .post(
    "/api/projects/:projectId/agents/:agentId/config/kernel-update",
    (ctx): AgentKernelUpdateResponse => {
      const config = configOf(ctx);
      config.config.kernelOutdated = false;
      config.config.kernelVersion = config.config.kernelLatest;
      agentOf(ctx).kernelOutdated = false;
      return {
        advanced: ["runtime", "tools"],
        kept: ["prompt"],
        kernelVersion: config.config.kernelLatest,
      };
    },
  )
  .delete("/api/projects/:projectId/agents/:agentId", (ctx) => {
    const agent = agentOf(ctx);
    if (agent.agentId === IDS.agents.docs)
      fail(409, "agent_builtin", "The docs Agent is the demo's; it stays.");
    ctx.store.f.agents = ctx.store.f.agents.filter((a) => a.agentId !== agent.agentId);
    return empty();
  });

// ---------------------------------------------------------------------------------------------
// An Agent's public API: its switches, approval mode and keys (the stream itself is not mocked)
// ---------------------------------------------------------------------------------------------

const API_APPROVAL_MODES: readonly ApprovalMode[] = [
  "allow-all",
  "deny-all",
  "read-only",
  "always-ask",
];

/** `n` random bytes as base64url, the alphabet the server's keys and key ids are written in. */
function base64url(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * The Agent's settings, as the server reads an Agent never configured: off, keyed, allow-all.
 * The store's own object: answers hand out a copy, as a server's JSON would, since the app keeps
 * what it is given and a later write here must not reach into its state.
 */
const apiOf = (ctx: Ctx): AgentApiSettings => {
  const agentId = agentOf(ctx).agentId;
  ctx.store.f.agentApi[agentId] ??= {
    enabled: false,
    open: false,
    approvalMode: "allow-all",
    keys: [],
  };
  return ctx.store.f.agentApi[agentId];
};

router
  .get("/api/projects/:projectId/agents/:agentId/api", (ctx): AgentApiResponse => ({
    api: structuredClone(apiOf(ctx)),
    serverEnabled: ctx.store.f.serverSettings.agentApiEnabled,
  }))
  .put("/api/projects/:projectId/agents/:agentId/api", (ctx): AgentApiResponse => {
    const settings = apiOf(ctx);
    const { enabled, open, approvalMode } = record(ctx.body);
    if (typeof enabled === "boolean") {
      settings.enabled = enabled;
      agentOf(ctx).apiEnabled = enabled;
    }
    if (typeof open === "boolean") settings.open = open;
    const mode = API_APPROVAL_MODES.find((m) => m === approvalMode);
    if (mode !== undefined) settings.approvalMode = mode;
    return {
      api: structuredClone(settings),
      serverEnabled: ctx.store.f.serverSettings.agentApiEnabled,
    };
  })
  .post("/api/projects/:projectId/agents/:agentId/api/keys", (ctx): unknown => {
    const settings = apiOf(ctx);
    const name = str(record(ctx.body).name).trim();
    if (name.length < 1 || name.length > 64) {
      fail(400, "bad_request", "A key's name is 1 to 64 characters.");
    }
    const secret = `penguin_${base64url(32)}`;
    const key: AgentApiKeyInfo = {
      keyId: base64url(12),
      name,
      prefix: secret.slice(0, 16),
      createdBy: ctx.store.f.user.userId,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    settings.keys.push(key);
    return json({ key: { ...key }, secret } satisfies AgentApiKeyCreateResponse, 201);
  })
  .delete("/api/projects/:projectId/agents/:agentId/api/keys/:keyId", (ctx) => {
    const settings = apiOf(ctx);
    const kept = settings.keys.filter((k) => k.keyId !== ctx.params.keyId);
    if (kept.length === settings.keys.length) fail(404, "key_not_found", "No such key.");
    settings.keys = kept;
    return empty();
  })
  // Try it: the stream a real run sends, scripted (fixtures.ts), whole in one body.
  .post("/api/projects/:projectId/agents/:agentId/api/try", (ctx) =>
    raw(
      amspTryStream(ctx.body, {
        agent: `${ctx.params.projectId}/${ctx.params.agentId}`,
        lang: ctx.store.lang,
        now: Date.now(),
      }),
      {
        "content-type": "text/event-stream; charset=utf-8",
      },
    ),
  );

// ---------------------------------------------------------------------------------------------
// Sessions: the list, directories, creation, the row
// ---------------------------------------------------------------------------------------------

const TEMP_WORKSPACE = /[/\\]workspaces[/\\][^/\\]+$/;
const isTemp = (workspace: string) => workspace === "" || TEMP_WORKSPACE.test(workspace);

/**
 * The server's rule: a company Session is in no category; otherwise archived first, then a
 * person's conversation is active and every other source background.
 */
function categoryOf(row: SessionInfo): SessionCategory | null {
  if (row.source === "company") return null;
  if (row.archived) return "archived";
  return row.source === undefined || row.source === "user" ? "active" : "background";
}

/** An organization's desk or ticket Session, by its owner, the durable `org` stamp or its source. */
const isOrgRow = (row: SessionInfo) =>
  (row.orgId ?? "") !== "" || row.client === "org" || row.source === "company";

function countsOf(rows: readonly SessionInfo[]): SessionCategoryCounts {
  const counts: SessionCategoryCounts = { active: 0, background: 0, archived: 0 };
  for (const row of rows) {
    const category = categoryOf(row);
    if (category !== null) counts[category] += 1;
  }
  return counts;
}

/** Newest creation first: the list's default order. */
const byCreated = (a: SessionInfo, b: SessionInfo) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;

/** `order=activity`: last activity first, ties by id — both by code point, as the server compares. */
function byActivity(
  a: Pick<SessionInfo, "lastActiveAt" | "sessionId">,
  b: Pick<SessionInfo, "lastActiveAt" | "sessionId">,
): number {
  if (a.lastActiveAt !== b.lastActiveAt) return a.lastActiveAt > b.lastActiveAt ? -1 : 1;
  return a.sessionId > b.sessionId ? -1 : a.sessionId < b.sessionId ? 1 : 0;
}

router
  .get("/api/projects/:projectId/agents/:agentId/sessions", (ctx): unknown => {
    const { store, params, query } = ctx;
    // `excludeOrg=1` asks for the user's own rows: an organization's Sessions leave the page
    // and the totals alike. A request for a category, a Workspace group or counts leaves the
    // company Sessions out too, which no category holds.
    const ownOnly = query.get("excludeOrg") === "1";
    const activity = query.get("order") === "activity";
    const category = query.get("category") as SessionCategory | null;
    const group = query.get("workspaceGroup");
    const classified = category !== null || group !== null || query.get("counts") === "1";
    const all = store.f.sessions
      .filter(
        (s) =>
          s.agentId === params.agentId &&
          !(ownOnly && isOrgRow(s)) &&
          !(classified && categoryOf(s) === null),
      )
      .sort(activity ? byActivity : byCreated);
    let rows = category ? all.filter((s) => categoryOf(s) === category) : all;
    if (group !== null) {
      rows = rows.filter((s) => (group === "temp" ? isTemp(s.workspace) : s.workspace === group));
    }
    // `before=<lastActiveAt>,<sessionId>`: the rows strictly below the last one the sidebar
    // holds, in activity order only.
    const before = query.get("before");
    if (before !== null) {
      if (!activity) fail(400, "bad_request", "before requires order=activity.");
      const comma = before.indexOf(",");
      const cursor = { lastActiveAt: before.slice(0, comma), sessionId: before.slice(comma + 1) };
      if (comma < 0 || !Number.isFinite(Date.parse(cursor.lastActiveAt)) || !cursor.sessionId)
        fail(400, "bad_request", "before must be <lastActiveAt>,<sessionId>.");
      rows = rows.filter((s) => byActivity(s, cursor) > 0);
    }
    const limit = Number(query.get("limit"));
    const offset = Number(query.get("offset")) || 0;
    const page = Number.isFinite(limit) && limit > 0 ? rows.slice(offset, offset + limit) : rows;
    const response: { sessions: SessionInfo[] } & Partial<
      Pick<
        import("@prismshadow/penguin-server/api").SessionsResponse,
        "counts" | "workspaceCounts" | "workspaceLatest"
      >
    > = { sessions: page };
    if (query.get("counts") === "1") {
      response.counts = countsOf(all);
      const byWorkspace: Record<string, SessionInfo[]> = {};
      for (const row of all) (byWorkspace[row.workspace] ??= []).push(row);
      response.workspaceCounts = Object.fromEntries(
        Object.entries(byWorkspace).map(([path, list]) => [path, countsOf(list)]),
      );
      // The newest CREATION per path, whatever order the page is in.
      response.workspaceLatest = Object.fromEntries(
        Object.entries(byWorkspace).map(([path, list]) => [
          path,
          list.reduce((latest, row) => (row.createdAt > latest ? row.createdAt : latest), ""),
        ]),
      );
    }
    return response;
  })
  .get("/api/projects/:projectId/dirs", ({ store, query }): DirListResponse => {
    const path = query.get("path") || "/home/demo";
    const listing = store.f.dirs[path] ?? { path, parent: "/home/demo", entries: [] };
    // The home request that builds the finder's sidebar also carries the machine's own places,
    // as the server's does: a Linux machine's root and one mounted disk.
    if (query.get("path") || query.get("places") !== "1") return listing;
    return {
      ...listing,
      platform: "linux",
      standardFolders: {},
      locations: [
        { path: "/", kind: "root" },
        { path: "/mnt/data", kind: "volume", label: "data" },
      ],
    };
  })
  .get("/api/projects/:projectId/machines/:machineId/dirs", ({ store, query }): DirListResponse => {
    const path = query.get("path") || "/home/demo";
    return store.f.dirs[path] ?? { path, parent: "/home/demo", entries: [] };
  })
  // Only the desktop app's own window may ask macOS for a folder, and the gallery is not one.
  .post("/api/projects/:projectId/dirs/access", () =>
    fail(
      403,
      "desktop_shell_only",
      "Asking macOS for a folder is available from the desktop app's own window.",
    ),
  )
  .get("/api/projects/:projectId/dir-skills", ({ query }): DirectorySkillsResponse => ({
    path: query.get("path") ?? "",
    skills: [],
  }))
  .post("/api/projects/:projectId/agents/:agentId/sessions", (ctx): unknown => {
    const agent = agentOf(ctx);
    const body = record(ctx.body) as Partial<SessionInfo>;
    const session = ctx.store.createSession(agent.agentId, body);
    return json({ session } satisfies SessionCreateResponse, 201);
  })
  .post("/api/sessions/:sessionId/fork", ({ store, params }): unknown => {
    const source = store.session(params.sessionId!);
    if (!source) notFound("Session");
    const session = store.createSession(source.agentId, {
      ...(source.title ? { title: `${source.title} (fork)` } : {}),
      workspace: source.workspace,
    });
    return json({ session } satisfies SessionForkResponse, 201);
  })
  .get("/api/sessions/:sessionId", ({ store, params }): SessionResponse => {
    const session = store.session(params.sessionId!);
    if (!session) notFound("Session");
    return {
      session: {
        ...session,
        tracePath: `/home/demo/.penguin/data/traces/${session.sessionId}/001.jsonl`,
      },
    };
  })
  .patch("/api/sessions/:sessionId", ({ store, params, body }): SessionResponse => {
    const session = store.patchSession(params.sessionId!, record(body) as Partial<SessionInfo>);
    if (!session) notFound("Session");
    return { session };
  })
  .delete("/api/sessions/:sessionId", ({ store, params }) => {
    if (!store.deleteSession(params.sessionId!)) notFound("Session");
    return empty();
  });

// ---------------------------------------------------------------------------------------------
// Messaging bindings: nothing bound in the demo; every write needs a platform behind it
// ---------------------------------------------------------------------------------------------

router.get("/api/sessions/:sessionId/messaging", (): MessagingBindingsResponse => ({
  bindings: [],
}));
for (const channel of ["feishu", "telegram", "qq", "wechat"]) {
  router
    .put(`/api/sessions/:sessionId/messaging/${channel}`, () =>
      readOnly("save a messaging binding"),
    )
    .post(`/api/sessions/:sessionId/messaging/${channel}/test`, () =>
      readOnly("test a messaging binding"),
    );
}
router
  .post("/api/sessions/:sessionId/messaging/:channel/state", () =>
    readOnly("connect a messaging channel"),
  )
  .post("/api/sessions/:sessionId/messaging/:channel/test-message", () =>
    readOnly("send a test message"),
  )
  .post("/api/sessions/:sessionId/messaging/qq/scan", () => readOnly("start a QQ scan"))
  .post("/api/sessions/:sessionId/messaging/qq/scan/poll", () => readOnly("poll a QQ scan"))
  .post("/api/sessions/:sessionId/messaging/qq/scan/cancel", () => empty())
  .post("/api/sessions/:sessionId/messaging/wechat/scan", () => readOnly("start a WeChat scan"))
  .post("/api/sessions/:sessionId/messaging/wechat/scan/poll", () => readOnly("poll a WeChat scan"))
  .post("/api/sessions/:sessionId/messaging/wechat/scan/verify", () => empty())
  .post("/api/sessions/:sessionId/messaging/wechat/scan/cancel", () => empty());

// ---------------------------------------------------------------------------------------------
// Messages, tasks, approvals, the run
// ---------------------------------------------------------------------------------------------

const transcriptOf = ({ store, params }: Ctx) => {
  const transcript = store.transcript(params.sessionId!);
  if (!transcript) notFound("Session");
  return transcript;
};

router
  .get("/api/sessions/:sessionId/messages", (ctx): MessagesResponse => {
    const transcript = transcriptOf(ctx);
    const live = ctx.store.liveTail(ctx.params.sessionId!);
    const windowed = ctx.query.has("tailLimit") || ctx.query.has("before");
    const before = ctx.query.get("before");
    const messages = before === null ? transcript.history : [];
    return {
      messages,
      ...(live && before === null ? { live } : {}),
      ...(windowed
        ? {
            page: {
              earlierTurns: 0,
              prior: {
                subagentTokens: 0,
                elapsedMs: 0,
                apiMs: 0,
                toolMs: 0,
                sessionTokens: 0,
                contextTokens: 0,
              },
            },
          }
        : {}),
    };
  })
  .post("/api/sessions/:sessionId/tasks", ({ store, params, body }): unknown => {
    const sessionId = params.sessionId!;
    const row = store.session(sessionId);
    if (!row) notFound("Session");
    const input = record(body).input;
    const text = Array.isArray(input)
      ? input
          .map((part) =>
            typeof part === "object" && part !== null && "text" in part
              ? str((part as { text: unknown }).text)
              : "",
          )
          .filter((t) => t !== "")
          .join("\n")
      : "";
    if (row.status !== "idle") {
      if (record(body).queueIfBusy === true) {
        row.pendingFollowUpCount += 1;
        return json({ sessionId, queued: true } satisfies TaskCreateResponse, 202);
      }
      fail(409, "session_busy", "A Task is already running.");
    }
    store.startTask(sessionId, text || "…");
    return json({ sessionId } satisfies TaskCreateResponse, 202);
  })
  .get("/api/sessions/:sessionId/goal", (): GoalResponse => ({ goal: null }))
  .post("/api/sessions/:sessionId/approvals/:toolCallId", ({ store, params, body }) => {
    const decision = record(body).decision === "deny" ? "deny" : "allow";
    if (!store.decide(params.sessionId!, params.toolCallId!, decision)) {
      fail(404, "approval_not_found", "No approval is pending for that call.");
    }
    return empty();
  })
  .post("/api/sessions/:sessionId/tool-calls/:toolCallId/background", ({ store, params }) => {
    if (!store.detachToolCall(params.sessionId!, params.toolCallId!)) {
      fail(404, "tool_call_not_found", "That call is not executing.");
    }
    return empty();
  })
  .post("/api/sessions/:sessionId/abort", ({ store, params }) => {
    store.abort(params.sessionId!);
    return empty();
  })
  .post("/api/sessions/:sessionId/retry-now", (): RetryNowResponse => ({ skipped: false }))
  .get("/api/sessions/:sessionId/processes", ({ store, params }): SessionProcessesResponse => {
    const row = store.session(params.sessionId!);
    return {
      processes: row?.backgroundTasks?.processes
        ? [
            {
              processId: "proc-links",
              pid: 48_112,
              cmd: "node scripts/check-links.mjs --all",
              cwd: IDS.workspace,
              startedAt: row.lastActiveAt,
              running: true,
            },
          ]
        : [],
    };
  })
  .post("/api/sessions/:sessionId/processes/:processId/kill", ({ store, params }) => {
    const row = store.session(params.sessionId!);
    if (row) delete row.backgroundTasks;
    return empty();
  })
  .delete("/api/sessions/:sessionId/processes/:processId", () => empty())
  .post("/api/sessions/:sessionId/steer", ({ store, params }) => {
    const row = store.session(params.sessionId!);
    if (!row || row.status === "idle") fail(409, "not_running", "No Task is running.");
    return empty(202);
  })
  .post(
    "/api/sessions/:sessionId/subagents/:childSessionId/message",
    (): SubagentMessageResponse => ({
      outcome: "steered",
    }),
  )
  .post("/api/sessions/:sessionId/subagents/:childSessionId/abort", () => empty())
  .delete("/api/sessions/:sessionId/steer/:steerId", () =>
    fail(409, "not_pending", "Already delivered."),
  )
  .delete("/api/sessions/:sessionId/follow-ups/:followUpId", () =>
    fail(409, "follow_up_started", "Already started."),
  )
  .post("/api/sessions/:sessionId/compact", ({ store, params }): unknown => {
    const sessionId = params.sessionId!;
    if (!store.session(sessionId)) notFound("Session");
    return json({ sessionId } satisfies TaskCreateResponse, 202);
  })
  // In-session model switch. The demo answers the way the server does for a Session that
  // never ran: the row moves inside the request (200 with the Session), so the picker works
  // without a compaction to stream.
  .post("/api/sessions/:sessionId/switch-model", ({ store, params, body }): SessionResponse => {
    const to = record(body);
    const session = store.patchSession(params.sessionId!, {
      ...(typeof to.provider === "string" ? { provider: to.provider } : {}),
      ...(typeof to.modelId === "string" ? { modelId: to.modelId } : {}),
    });
    if (!session) notFound("Session");
    return { session };
  })
  .get("/api/sessions/:sessionId/context", ({ store }): SessionContextResponse => store.f.context);

// ---------------------------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------------------------

/** What the server derives from a Trace file, derived here from the transcript the same way. */
function analyze(history: readonly OmniMessage[]): TraceAnalysisResponse {
  const ms = (m: OmniMessage) => Date.parse(m.timestamp);
  const requests: TraceAnalysisResponse["requests"] = [];
  const tasks: TraceAnalysisResponse["tasks"] = [];
  const toolCalls: TraceAnalysisResponse["toolCalls"] = [];
  const modelSegments: TraceAnalysisResponse["modelSegments"] = [];
  const toolSpans: TraceAnalysisResponse["toolSpans"] = [];
  const usageTrend: TraceAnalysisResponse["usageTrend"] = [];
  let taskIndex = -1;
  let openRequest: (typeof requests)[number] | null = null;
  let previous: OmniMessage | null = null;
  const calls = new Map<string, { index: number; span: (typeof toolSpans)[number] }>();
  history.forEach((message, i) => {
    const p = payloadOf(message);
    if (p === null) {
      // The session_meta record opens the file: it belongs to no turn and times nothing.
      previous = message;
      return;
    }
    if (p.type === "text" && p.role === "user") {
      taskIndex += 1;
      tasks.push({
        taskIndex,
        messageFrom: i,
        messageTo: i,
        startTs: "",
        endTs: message.timestamp,
        tokens: { cacheRead: 0, cacheWrite: 0, output: 0 },
        llmMs: 0,
        toolMs: 0,
      });
    }
    const task = tasks[tasks.length - 1];
    if (task) {
      task.messageTo = i;
      task.endTs = message.timestamp;
    }
    if (p.type === "request_begin") {
      openRequest = { beginTs: message.timestamp, taskIndex: Math.max(taskIndex, 0) };
      requests.push(openRequest);
      if (task && task.startTs === "") task.startTs = message.timestamp;
    } else if (p.type === "request_end" && openRequest) {
      const duration = ms(message) - Date.parse(openRequest.beginTs);
      openRequest.endTs = message.timestamp;
      openRequest.durationMs = duration;
      openRequest.activeMs = duration;
      openRequest.status = p.status;
      if (task) task.llmMs += duration;
      openRequest = null;
    } else if (
      p.type === "thinking" ||
      (p.type === "text" && p.role === "assistant") ||
      p.type === "tool_call"
    ) {
      const kind = p.type === "thinking" ? "thinking" : p.type === "text" ? "text" : "tool_call";
      modelSegments.push({
        kind,
        startTs: previous ? previous.timestamp : message.timestamp,
        endTs: message.timestamp,
        taskIndex: Math.max(taskIndex, 0),
        ...(p.type === "tool_call" ? { toolCallId: p.tool_call_id, name: p.name } : {}),
      });
      if (p.type === "tool_call") {
        const span = {
          toolCallId: p.tool_call_id,
          name: p.name,
          callTs: message.timestamp,
          taskIndex: Math.max(taskIndex, 0),
        };
        toolSpans.push(span);
        calls.set(p.tool_call_id, { index: toolCalls.length, span });
        toolCalls.push({ toolCallId: p.tool_call_id, name: p.name, startTs: message.timestamp });
      }
    } else if (p.type === "tool_call_output") {
      const call = calls.get(p.tool_call_id);
      if (call) {
        const started = Date.parse(call.span.callTs);
        call.span.outputTs = message.timestamp;
        call.span.stopReason = p.stop_reason ?? "completed";
        const entry = toolCalls[call.index]!;
        entry.endTs = message.timestamp;
        entry.durationMs = ms(message) - started;
        entry.stopReason = p.stop_reason ?? "completed";
        if (task) task.toolMs += ms(message) - started;
      }
    } else if (p.type === "approval_decision") {
      const call = calls.get(p.tool_call_id);
      if (call) {
        call.span.approvalTs = message.timestamp;
        call.span.decision = p.decision;
      }
    } else if (p.type === "token_usage") {
      usageTrend.push({
        ts: message.timestamp,
        requestTotal: p.request.total,
        sessionTotal: p.session.total,
      });
      if (task) {
        task.tokens = {
          cacheRead: p.request.cache_read,
          cacheWrite: p.request.cache_write,
          output: p.request.output,
        };
        task.context = { ...task.tokens };
        task.cost = costOf({ ...task.tokens, provider: "deepseek" });
      }
    }
    previous = message;
  });
  const elapsedMs = tasks.reduce(
    (sum, t) => sum + (t.startTs ? Math.max(0, Date.parse(t.endTs) - Date.parse(t.startTs)) : 0),
    0,
  );
  // The context ring's bound, read off the file's head session_meta as the server does.
  const head = history.find((m) => m.type === "session_meta")?.payload;
  const contextWindow =
    head !== undefined && "model_context_window" in head ? head.model_context_window : undefined;
  return {
    elapsedMs,
    ...(contextWindow !== undefined ? { modelContextWindow: contextWindow } : {}),
    apiMs: tasks.reduce((sum, t) => sum + t.llmMs, 0),
    toolMs: tasks.reduce((sum, t) => sum + t.toolMs, 0),
    cost: tasks.reduce((sum, t) => sum + (t.cost ?? 0), 0),
    requests,
    tasks,
    toolCalls,
    modelSegments,
    toolSpans,
    otherSpans: [],
    reconnectCount: 0,
    compactionCount: 0,
    usageTrend,
  };
}

const traceFile = (ctx: Ctx, sessionId: string) => {
  const transcript = ctx.store.transcript(sessionId);
  const row = ctx.store.session(sessionId);
  if (!transcript || !row) notFound("Trace");
  return { transcript, row };
};

const traceEvents = (ctx: Ctx, sessionId: string): TraceEventsResponse => {
  const { transcript } = traceFile(ctx, sessionId);
  const offset = Number(ctx.query.get("offset")) || 0;
  const limit = Number(ctx.query.get("limit")) || 200;
  return {
    events: transcript.history.slice(offset, offset + limit),
    offset,
    limit,
    total: transcript.history.length,
  };
};

const traceJsonl = (ctx: Ctx, sessionId: string) =>
  raw(
    traceFile(ctx, sessionId)
      .transcript.history.map((m) => JSON.stringify(m))
      .join("\n"),
    {
      "content-type": "application/x-ndjson",
      "content-disposition": `attachment; filename="${sessionId}-001.jsonl"`,
    },
  );

router
  .get("/api/sessions/:sessionId/traces", (ctx): SessionTracesResponse => {
    const { transcript, row } = traceFile(ctx, ctx.params.sessionId!);
    return {
      files: [
        {
          index: 1,
          date: dayKey(Date.parse(row.createdAt)),
          sizeBytes: JSON.stringify(transcript.history).length,
          mtime: row.lastActiveAt,
        },
      ],
    };
  })
  .get("/api/sessions/:sessionId/traces/:index", (ctx) => traceEvents(ctx, ctx.params.sessionId!))
  .get("/api/sessions/:sessionId/traces/:index/analysis", (ctx): TraceAnalysisResponse =>
    analyze(traceFile(ctx, ctx.params.sessionId!).transcript.history),
  )
  .get("/api/projects/:projectId/agents/:agentId/traces/:sessionId/:index", (ctx) =>
    traceEvents(ctx, ctx.params.sessionId!),
  )
  .get(
    "/api/projects/:projectId/agents/:agentId/traces/:sessionId/:index/analysis",
    (ctx): TraceAnalysisResponse =>
      analyze(traceFile(ctx, ctx.params.sessionId!).transcript.history),
  )
  .get("/api/projects/:projectId/agents/:agentId/traces/:sessionId/:index/download", (ctx) =>
    traceJsonl(ctx, ctx.params.sessionId!),
  )
  .post("/api/projects/:projectId/agents/:agentId/traces/import", (): unknown =>
    json(
      { sessionId: "s-imported", index: 1, date: dayKey(Date.now()) } satisfies TraceImportResponse,
      201,
    ),
  );

// ---------------------------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------------------------

function filterUsage(store: DemoStore, query: URLSearchParams, withModel: boolean): UsageDay[] {
  const from = query.get("from");
  const to = query.get("to");
  const agentId = query.get("agentId");
  const provider = query.get("provider");
  const modelId = query.get("modelId");
  return store.f.usage.filter(
    (day) =>
      (!from || day.date >= from) &&
      (!to || day.date <= to) &&
      (!agentId || day.agentId === agentId) &&
      (!withModel || !provider || (day.provider === provider && day.modelId === modelId)),
  );
}

const bucket = (day: UsageDay[]): UsageResponse["summary"]["today"] => ({
  total: day.reduce((s, d) => s + d.cacheRead + d.cacheWrite + d.output, 0),
  requests: day.reduce((s, d) => s + d.requests, 0),
  cost: day.reduce((s, d) => s + costOf(d), 0),
  hasUncosted: false,
});

/** The series bucket a day falls in at a granularity: the day, its ISO week's Monday, or its month. */
function bucketKey(date: string, granularity: UsageGranularity): string {
  if (granularity === "month") return date.slice(0, 7);
  if (granularity === "week") {
    const d = new Date(`${date}T00:00:00Z`);
    const weekday = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - weekday);
    return d.toISOString().slice(0, 10);
  }
  return date;
}

router
  .get("/api/projects/:projectId/usage/errors", ({ store, query }): UsageErrorsPage => {
    const kind = query.get("kind");
    const items = store.f.usageErrors.filter((e) => !kind || e.kind === kind);
    const offset = Number(query.get("offset")) || 0;
    const limit = Number(query.get("limit")) || items.length;
    return {
      items: items.slice(offset, offset + limit),
      total: items.reduce((n, e) => n + e.count, 0),
      rows: items.length,
    };
  })
  .delete("/api/projects/:projectId/usage/errors", ({ store }): UsageErrorsClearResponse => {
    const deleted = store.f.usageErrors.length;
    store.f.usageErrors = [];
    return { deleted };
  })
  .get("/api/projects/:projectId/usage/model-totals", ({ store }): UsageModelTotals => {
    const totals = new Map<string, UsageModelTotals["totals"][number]>();
    for (const day of store.f.usage) {
      const key = `${day.provider}/${day.modelId}`;
      const entry = totals.get(key) ?? {
        provider: day.provider,
        modelId: day.modelId,
        tokens: 0,
        requests: 0,
      };
      entry.tokens += day.cacheRead + day.cacheWrite + day.output;
      entry.requests += day.requests;
      totals.set(key, entry);
    }
    return { totals: [...totals.values()] };
  })
  .get("/api/projects/:projectId/usage", ({ store, query }): UsageResponse => {
    const groupBy = (query.get("groupBy") ?? "date") as UsageGroupBy;
    const granularity = (query.get("granularity") ?? "day") as UsageGranularity;
    const days = filterUsage(store, query, true);
    const today = dayKey(store.f.now);
    const weekAgo = dayKey(store.f.now - 7 * 86_400_000);
    const keyOf = (d: UsageDay) =>
      groupBy === "date"
        ? d.date
        : groupBy === "agent"
          ? d.agentId
          : groupBy === "model"
            ? d.modelId
            : d.sessionId;
    const groups = new Map<string, UsageResponse["groups"][number]>();
    for (const d of days) {
      const key = keyOf(d);
      const row = groups.get(key) ?? {
        key,
        ...(groupBy === "model" ? { provider: d.provider } : {}),
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
        total: 0,
        requests: 0,
        cost: 0,
        hasUncosted: false,
      };
      row.cacheRead += d.cacheRead;
      row.cacheWrite += d.cacheWrite;
      row.output += d.output;
      row.total += d.cacheRead + d.cacheWrite + d.output;
      row.requests += d.requests;
      row.cost = (row.cost ?? 0) + costOf(d);
      groups.set(key, row);
    }
    const buckets = new Map<string, UsageResponse["series"][number]>();
    const dates = [...new Set(days.map((d) => d.date))].sort();
    for (const date of dates) {
      const key = bucketKey(date, granularity);
      if (!buckets.has(key)) {
        buckets.set(key, {
          bucket: key,
          cacheRead: 0,
          cacheWrite: 0,
          output: 0,
          total: 0,
          cost: 0,
          requests: 0,
          completed: 0,
          denominator: 0,
        });
      }
    }
    const perAgent = new Map<string, UsageResponse["byAgentSeries"][number]>();
    const perModel = new Map<string, UsageResponse["byModelSeries"][number]>();
    const keys = [...buckets.keys()];
    const zeros = () => keys.map(() => 0);
    for (const d of days) {
      const key = bucketKey(d.date, granularity);
      const point = buckets.get(key)!;
      point.cacheRead += d.cacheRead;
      point.cacheWrite += d.cacheWrite;
      point.output += d.output;
      point.total += d.cacheRead + d.cacheWrite + d.output;
      point.cost = (point.cost ?? 0) + costOf(d);
      point.requests += d.requests;
      point.completed += d.completed;
      point.denominator += d.requests - d.aborted;
      const index = keys.indexOf(key);
      const agent = perAgent.get(d.agentId) ?? {
        agentId: d.agentId,
        requests: zeros(),
        completed: zeros(),
        denominator: zeros(),
      };
      agent.requests[index]! += d.requests;
      agent.completed[index]! += d.completed;
      agent.denominator[index]! += d.requests - d.aborted;
      perAgent.set(d.agentId, agent);
      const modelKey = `${d.provider}/${d.modelId}`;
      const model = perModel.get(modelKey) ?? {
        provider: d.provider,
        modelId: d.modelId,
        requests: zeros(),
        completed: zeros(),
        denominator: zeros(),
      };
      model.requests[index]! += d.requests;
      model.completed[index]! += d.completed;
      model.denominator[index]! += d.requests - d.aborted;
      perModel.set(modelKey, model);
    }
    const unexpected = store.f.usageErrors.filter((e) => e.kind === "unexpected").length;
    return {
      summary: {
        today: bucket(store.f.usage.filter((d) => d.date === today)),
        last7d: bucket(store.f.usage.filter((d) => d.date >= weekAgo)),
        total: bucket(store.f.usage),
      },
      groupBy,
      groups: [...groups.values()],
      granularity,
      series: keys.map((key) => buckets.get(key)!),
      byAgentSeries: [...perAgent.values()],
      byModelSeries: [...perModel.values()],
      errors: {
        total: store.f.usageErrors.reduce((n, e) => n + e.count, 0),
        rows: store.f.usageErrors.length,
        unexpected,
        topCode: store.f.usageErrors[0]
          ? {
              source: store.f.usageErrors[0].source,
              code: store.f.usageErrors[0].code,
              kind: store.f.usageErrors[0].kind,
              count: 1,
            }
          : null,
        recent: store.f.usageErrors,
      },
      agentIds: [...new Set(store.f.usage.map((d) => d.agentId))],
      models: [...perModel.values()].map(({ provider, modelId }) => ({ provider, modelId })),
    };
  });

// ---------------------------------------------------------------------------------------------
// Workspace files
// ---------------------------------------------------------------------------------------------

const normalizePath = (path: string) => path.replace(/^\.?\/+/, "").replace(/\/+$/, "");

/**
 * The Files panel's operations over the one demo Workspace, for both ways the panel names it: a
 * Session (`/api/sessions/:sessionId/files…`) and a directory (`/api/projects/:projectId/
 * workspace-files…?workspace=`, the new-chat draft's folder). Every scope sees the same files.
 */
const workspaceFiles = {
  list: ({ store, query }: Ctx): WorkspaceFilesResponse => {
    const path = normalizePath(query.get("path") ?? "");
    const entries = store.f.workspace.entries[path];
    if (!entries) notFound("Directory");
    return { path, entries };
  },
  read: ({ store, query }: Ctx) => {
    const path = normalizePath(query.get("path") ?? "");
    const content = store.f.workspace.content[path];
    if (content === undefined) notFound("File");
    const name = path.slice(path.lastIndexOf("/") + 1);
    return raw(content, {
      "content-type": path.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8",
      etag: `"${content.length}-${path.length}"`,
      ...(query.get("download") === "1"
        ? { "content-disposition": `attachment; filename="${name}"` }
        : {}),
    });
  },
  write: ({ store, query, body }: Ctx) => {
    const path = normalizePath(query.get("path") ?? "");
    const data = str(record(body).dataBase64);
    try {
      store.f.workspace.content[path] = decodeURIComponent(escape(atob(data)));
    } catch {
      store.f.workspace.content[path] = "";
    }
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const name = path.slice(path.lastIndexOf("/") + 1);
    const entries = (store.f.workspace.entries[dir] ??= []);
    const size = store.f.workspace.content[path]!.length;
    const existing = entries.find((e) => e.name === name);
    if (existing) {
      existing.sizeBytes = size;
      existing.mtime = new Date().toISOString();
    } else entries.push({ name, kind: "file", sizeBytes: size, mtime: new Date().toISOString() });
    return empty();
  },
  remove: ({ store, query }: Ctx) => {
    const path = normalizePath(query.get("path") ?? "");
    delete store.f.workspace.content[path];
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const name = path.slice(path.lastIndexOf("/") + 1);
    store.f.workspace.entries[dir] = (store.f.workspace.entries[dir] ?? []).filter(
      (e) => e.name !== name,
    );
    return empty();
  },
  reveal: () => fail(404, "not_desktop", "Only the desktop shell can reveal a file."),
  create: ({ store, body }: Ctx) => {
    const { path: named, kind } = record(body);
    const path = normalizePath(str(named));
    if (path === "") fail(400, "bad_request", "path must name the new entry.");
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const name = path.slice(path.lastIndexOf("/") + 1);
    const entries = (store.f.workspace.entries[dir] ??= []);
    if (entries.some((e) => e.name === name))
      fail(409, "target_exists", "Something already exists at this path.");
    const mtime = new Date().toISOString();
    if (kind === "dir") {
      entries.push({ name, kind: "dir", sizeBytes: 0, mtime });
      store.f.workspace.entries[path] ??= [];
    } else {
      entries.push({ name, kind: "file", sizeBytes: 0, mtime });
      store.f.workspace.content[path] = "";
    }
    return empty();
  },
  /** A file moves alone; a folder takes every listing and file under it along. */
  move: ({ store, body }: Ctx) => {
    const { from, to } = record(body);
    const source = normalizePath(str(from));
    const target = normalizePath(str(to));
    const ws = store.f.workspace;
    const folder = ws.entries[source] !== undefined;
    if (!folder && ws.content[source] === undefined) notFound("File");
    if (ws.content[target] !== undefined || ws.entries[target] !== undefined)
      fail(409, "target_exists", "The destination exists.");
    if (folder && target.startsWith(`${source}/`))
      fail(400, "bad_request", "A folder cannot move into itself.");
    const moved = (path: string) =>
      path === source || path.startsWith(`${source}/`)
        ? `${target}${path.slice(source.length)}`
        : path;
    for (const key of Object.keys(ws.content)) {
      const next = moved(key);
      if (next === key) continue;
      ws.content[next] = ws.content[key]!;
      delete ws.content[key];
    }
    for (const key of Object.keys(ws.entries)) {
      const next = moved(key);
      if (next === key) continue;
      ws.entries[next] = ws.entries[key]!;
      delete ws.entries[key];
    }
    const parentOf = (path: string) =>
      path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
    const was = (ws.entries[parentOf(source)] ?? []).find((e) => e.name === nameOf(source));
    ws.entries[parentOf(source)] = (ws.entries[parentOf(source)] ?? []).filter(
      (e) => e.name !== nameOf(source),
    );
    (ws.entries[parentOf(target)] ??= []).push({
      name: nameOf(target),
      kind: folder ? "dir" : "file",
      sizeBytes: was?.sizeBytes ?? 0,
      mtime: new Date().toISOString(),
    });
    return empty();
  },
  search: ({ store, query }: Ctx): WorkspaceSearchResponse => {
    const q = (query.get("q") ?? "").toLowerCase();
    if (q === "") fail(400, "empty_query", "Nothing to search for.");
    const hits: WorkspaceSearchResponse["hits"] = [];
    for (const [dir, entries] of Object.entries(store.f.workspace.entries)) {
      for (const entry of entries) {
        if (entry.name.toLowerCase().includes(q)) {
          hits.push({
            path: dir ? `${dir}/${entry.name}` : entry.name,
            kind: entry.kind,
            sizeBytes: entry.sizeBytes,
            mtime: entry.mtime,
          });
        }
      }
    }
    return { hits, truncated: false };
  },
};

for (const base of ["/api/sessions/:sessionId/files", "/api/projects/:projectId/workspace-files"]) {
  router
    .get(base, workspaceFiles.list)
    .get(`${base}/content`, workspaceFiles.read)
    .put(`${base}/content`, workspaceFiles.write)
    .delete(`${base}/content`, workspaceFiles.remove)
    .post(`${base}/reveal`, workspaceFiles.reveal)
    .post(`${base}/create`, workspaceFiles.create)
    .post(`${base}/move`, workspaceFiles.move)
    .get(`${base}/search`, workspaceFiles.search);
}

router
  // The separate preview origin has no counterpart here: the file is served as the page itself.
  .get("/api/sessions/:sessionId/files/preview-redirect", ({ store, query }) => {
    const path = normalizePath(query.get("path") ?? "");
    const content = store.f.workspace.content[path];
    if (content === undefined) notFound("File");
    return raw(content, {
      "content-type": path.endsWith(".html")
        ? "text/html; charset=utf-8"
        : "text/plain; charset=utf-8",
    });
  })
  .post("/api/sessions/:sessionId/files/stat", ({ store, body }): FilesStatResponse => {
    const paths = record(body).paths;
    return {
      existing: Array.isArray(paths)
        ? paths.filter(
            (p): p is string =>
              typeof p === "string" && store.f.workspace.content[normalizePath(p)] !== undefined,
          )
        : [],
    };
  });

// ---------------------------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------------------------

const withoutAgent = (item: ProjectSchedulesResponse["schedules"][number]): ScheduleItem => {
  const { agentId, ...rest } = item;
  void agentId;
  return rest;
};

router
  .get("/api/projects/:projectId/agents/:agentId/schedules", (ctx): SchedulesResponse => ({
    schedules: ctx.store.f.schedules
      .filter((s) => s.agentId === agentOf(ctx).agentId)
      .map(withoutAgent),
    invalidFiles: [],
  }))
  .get("/api/projects/:projectId/schedules", ({ store }): ProjectSchedulesResponse => ({
    schedules: store.f.schedules,
    invalidFiles: [],
  }))
  .post("/api/projects/:projectId/agents/:agentId/schedules", (ctx): unknown => {
    const agent = agentOf(ctx);
    const body = record(ctx.body);
    const name = str(body.name, `task-${ctx.store.f.schedules.length + 1}`);
    if (ctx.store.f.schedules.some((s) => s.agentId === agent.agentId && s.name === name)) {
      fail(409, "schedule_exists", "A task with that name exists.");
    }
    const item: ProjectSchedulesResponse["schedules"][number] = {
      agentId: agent.agentId,
      name,
      prompt: str(body.prompt),
      enabled: body.enabled !== false,
      startAt: str(body.startAt, new Date().toISOString()),
      ...(typeof body.period === "string" ? { period: body.period } : {}),
      ...(typeof body.endAt === "string" ? { endAt: body.endAt } : {}),
      ...(typeof body.sessionId === "string" ? { sessionId: body.sessionId } : {}),
      ...(typeof body.workspace === "string" ? { workspace: body.workspace } : {}),
      ...(typeof body.modelId === "string" && typeof body.provider === "string"
        ? { modelId: body.modelId, provider: body.provider }
        : {}),
      status: body.enabled === false ? "disabled" : "active",
      nextFireAt: str(body.startAt, new Date(Date.now() + 3_600_000).toISOString()),
      queued: false,
      creatorUserId: ctx.store.f.user.userId,
    };
    ctx.store.f.schedules.push(item);
    agent.scheduleCount += 1;
    return json(withoutAgent(item), 201);
  })
  .put("/api/projects/:projectId/agents/:agentId/schedules/:name", (ctx): ScheduleItem => {
    const agent = agentOf(ctx);
    const item = ctx.store.f.schedules.find(
      (s) => s.agentId === agent.agentId && s.name === ctx.params.name,
    );
    if (!item) notFound("Scheduled task");
    const body = record(ctx.body);
    Object.assign(item, body);
    item.status = item.enabled ? "active" : "disabled";
    if (item.enabled)
      item.nextFireAt = item.nextFireAt ?? new Date(Date.now() + 3_600_000).toISOString();
    else delete item.nextFireAt;
    return withoutAgent(item);
  })
  .delete("/api/projects/:projectId/agents/:agentId/schedules/:name", (ctx) => {
    const agent = agentOf(ctx);
    const before = ctx.store.f.schedules.length;
    ctx.store.f.schedules = ctx.store.f.schedules.filter(
      (s) => !(s.agentId === agent.agentId && s.name === ctx.params.name),
    );
    if (ctx.store.f.schedules.length === before) notFound("Scheduled task");
    agent.scheduleCount = Math.max(0, agent.scheduleCount - 1);
    return empty();
  });

// ---------------------------------------------------------------------------------------------
// Plugins, skills and hooks
// ---------------------------------------------------------------------------------------------

const installedOf = (ctx: Ctx) => {
  const agent = agentOf(ctx);
  return (ctx.store.f.installed[agent.agentId] ??= { skills: [], hooks: [] });
};

const libraryPlugins = (store: DemoStore) => store.f.library.groups.flatMap((g) => g.plugins);

router
  .get("/api/plugins", ({ store }): PluginLibraryResponse => store.f.library)
  .get("/api/plugins/registry", ({ store }): PluginIndexResponse => store.f.pluginIndex)
  // The demo installs no languages plugin: every fence is one the bundle carries or plain.
  .get("/api/languages", (): LanguageIndexResponse => ({ languages: [] }))
  .get("/api/plugins/registry/readme", ({ store, query }): PluginReadmeResponse => {
    const name = query.get("name") ?? "";
    return { name, readme: store.f.readmes[name] ?? null };
  })
  .get("/api/plugins/:plugin/files", ({ store, params }): PluginFilesResponse => {
    const files = store.f.pluginFiles[params.plugin!];
    if (!files) {
      if (!libraryPlugins(store).some((p) => p.name === params.plugin)) notFound("Plugin");
      return { files: {} };
    }
    return { files };
  })
  .post("/api/projects/:projectId/agents/:agentId/plugins", (ctx): unknown => {
    const installed = installedOf(ctx);
    const agent = agentOf(ctx);
    const names = record(ctx.body).names;
    const wanted = Array.isArray(names)
      ? names.filter((n): n is string => typeof n === "string")
      : [];
    for (const name of wanted) {
      const plugin = libraryPlugins(ctx.store).find((p) => p.name === name);
      if (!plugin) fail(404, "unknown_plugin", `No plugin named ${name}.`);
      for (const skill of plugin.skills) {
        installed.skills = installed.skills.filter((s) => s.name !== skill.name);
        installed.skills.push({ ...skill });
      }
      if (plugin.hooks.length > 0) {
        installed.hooks = installed.hooks.filter((h) => h.name !== plugin.name);
        installed.hooks.push({
          name: plugin.name,
          description: plugin.description,
          ...(plugin.descriptionZh ? { descriptionZh: plugin.descriptionZh } : {}),
          version: plugin.version,
          events: [...plugin.hooks],
        });
      }
      agent.pluginUpdates = agent.pluginUpdates.filter((u) => u.name !== name);
    }
    agent.skillCount = installed.skills.length;
    agent.hookCount = installed.hooks.length;
    return json(
      { skills: installed.skills, hooks: installed.hooks } satisfies AgentPluginsInstallResponse,
      201,
    );
  })
  .get("/api/projects/:projectId/agents/:agentId/skills", (ctx): AgentSkillsResponse => ({
    skills: installedOf(ctx).skills,
  }))
  .get("/api/projects/:projectId/agents/:agentId/hooks", (ctx): AgentHooksResponse => ({
    hooks: installedOf(ctx).hooks,
  }))
  .delete("/api/projects/:projectId/agents/:agentId/hooks/:name", (ctx) => {
    const installed = installedOf(ctx);
    const before = installed.hooks.length;
    installed.hooks = installed.hooks.filter((h) => h.name !== ctx.params.name);
    if (installed.hooks.length === before) notFound("Hook package");
    agentOf(ctx).hookCount = installed.hooks.length;
    return empty();
  })
  .post("/api/projects/:projectId/agents/:agentId/hooks/archive", () =>
    readOnly("install a hook archive"),
  )
  .get("/api/projects/:projectId/agents/:agentId/hooks/:name/archive", ({ params }) =>
    raw("PK\u0003\u0004 demo archive", {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${params.name}.zip"`,
    }),
  )
  .post("/api/projects/:projectId/agents/:agentId/skills/archive", () =>
    readOnly("install a skill archive"),
  )
  .get("/api/projects/:projectId/agents/:agentId/skills/:name/archive", ({ params }) =>
    raw("PK\u0003\u0004 demo archive", {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${params.name}.zip"`,
    }),
  )
  .delete("/api/projects/:projectId/agents/:agentId/skills/:name", (ctx) => {
    const installed = installedOf(ctx);
    const before = installed.skills.length;
    installed.skills = installed.skills.filter((s) => s.name !== ctx.params.name);
    if (installed.skills.length === before) notFound("Skill");
    agentOf(ctx).skillCount = installed.skills.length;
    return empty();
  });

// ---------------------------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------------------------

const benchmarkOf = ({ store, params }: Ctx) => {
  const benchmark = store.f.benchmarks.find((b) => b.id === params.benchmarkId);
  if (!benchmark) notFound("Benchmark");
  return benchmark;
};

const caseFilesOf = (ctx: Ctx, material: CaseMaterial): Record<string, string> => {
  const benchmark = benchmarkOf(ctx);
  const files = ctx.store.f.caseFiles[`${benchmark.id}/${ctx.params.caseId}`];
  if (!files) notFound("Case");
  return files[material];
};

const listCaseFiles = (ctx: Ctx, material: CaseMaterial): WorkspaceFilesResponse => {
  const files = caseFilesOf(ctx, material);
  const path = normalizePath(ctx.query.get("path") ?? "");
  const seen = new Set<string>();
  const entries: WorkspaceFilesResponse["entries"] = [];
  for (const [filePath, content] of Object.entries(files)) {
    if (path !== "" && !filePath.startsWith(`${path}/`)) continue;
    const rest = path === "" ? filePath : filePath.slice(path.length + 1);
    const name = rest.split("/")[0]!;
    if (seen.has(name)) continue;
    seen.add(name);
    const isDir = rest.includes("/");
    entries.push({
      name,
      kind: isDir ? "dir" : "file",
      sizeBytes: isDir ? 0 : content.length,
      mtime: new Date(ctx.store.f.now).toISOString(),
    });
  }
  return { path, entries };
};

const caseFileContent = (ctx: Ctx, material: CaseMaterial) => {
  const files = caseFilesOf(ctx, material);
  const path = normalizePath(ctx.query.get("path") ?? "");
  const content = files[path];
  if (content === undefined) notFound("File");
  return raw(content, { "content-type": "text/plain; charset=utf-8", etag: `"${content.length}"` });
};

router
  .get("/api/projects/:projectId/benchmarks", ({ store }): BenchmarksResponse => ({
    benchmarks: store.f.benchmarks,
  }))
  .get("/api/projects/:projectId/benchmarks/:benchmarkId/cases", (ctx): BenchmarkCasesResponse => ({
    cases: ctx.store.f.benchmarkCases[benchmarkOf(ctx).id] ?? [],
  }))
  .post("/api/projects/:projectId/benchmarks", ({ store, body }): unknown => {
    const { id, title, description, runs, cases } = record(body);
    const benchmarkId = str(id, `benchmark-${store.f.benchmarks.length + 1}`);
    if (store.f.benchmarks.some((b) => b.id === benchmarkId))
      fail(409, "benchmark_exists", "That id is taken.");
    const list = Array.isArray(cases) ? (cases as Array<Record<string, unknown>>) : [];
    // The server writes the day's first version, on the local calendar.
    const day = new Date();
    const two = (n: number) => String(n).padStart(2, "0");
    const benchmark: BenchmarksResponse["benchmarks"][number] = {
      id: benchmarkId,
      title: str(title, benchmarkId),
      ...(typeof description === "string" ? { description } : {}),
      runs: typeof runs === "number" ? runs : 1,
      status: "published",
      version: `${day.getFullYear()}.${two(day.getMonth() + 1)}.${two(day.getDate())}.1`,
      origin: { kind: "manual" },
      caseCount: list.length,
      evaluations: [],
      agentIds: [],
    };
    store.f.benchmarks.push(benchmark);
    store.f.benchmarkCases[benchmarkId] = list.map((c) => ({
      id: str(c.id),
      title: str(c.title, str(c.id)),
    }));
    for (const c of list) {
      store.f.caseFiles[`${benchmarkId}/${str(c.id)}`] = {
        statement: { "README.md": `# ${str(c.title)}\n\n${str(c.statement)}\n` },
        rubric: { "README.md": str(c.rubric) },
      };
    }
    return json({ benchmark } satisfies BenchmarkCreateResponse, 201);
  })
  .delete("/api/projects/:projectId/benchmarks/:benchmarkId", (ctx) => {
    const benchmark = benchmarkOf(ctx);
    ctx.store.f.benchmarks = ctx.store.f.benchmarks.filter((b) => b.id !== benchmark.id);
    return empty();
  })
  .post("/api/projects/:projectId/benchmarks/archive", () => readOnly("import a Benchmark package"))
  .get("/api/projects/:projectId/benchmarks/:benchmarkId/archive", (ctx) => {
    const benchmark = benchmarkOf(ctx);
    return raw("PK\u0003\u0004 demo archive", {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${benchmark.id}-v${benchmark.version ?? "0"}.zip"`,
    });
  })
  .get("/api/projects/:projectId/benchmarks/:benchmarkId/cases/:caseId/files", (ctx) =>
    listCaseFiles(ctx, "statement"),
  )
  .get("/api/projects/:projectId/benchmarks/:benchmarkId/cases/:caseId/rubric/files", (ctx) =>
    listCaseFiles(ctx, "rubric"),
  )
  .get("/api/projects/:projectId/benchmarks/:benchmarkId/cases/:caseId/files/content", (ctx) =>
    caseFileContent(ctx, "statement"),
  )
  .get(
    "/api/projects/:projectId/benchmarks/:benchmarkId/cases/:caseId/rubric/files/content",
    (ctx) => caseFileContent(ctx, "rubric"),
  );

// ---------------------------------------------------------------------------------------------
// Agent State export / import
// ---------------------------------------------------------------------------------------------

router
  .get("/api/projects/:projectId/agents/:agentId/export", ({ params }) =>
    raw("\u001f\u008b demo snapshot", {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${params.agentId}.tar.gz"`,
    }),
  )
  .post("/api/projects/:projectId/agents/:agentId/import", () => readOnly("import a snapshot"));

// ---------------------------------------------------------------------------------------------
// Machines (admin)
// ---------------------------------------------------------------------------------------------

const machinesResponse = (store: DemoStore): MachinesResponse => store.f.machines;

router
  .get("/api/projects/:projectId/machines", ({ store }) => machinesResponse(store))
  .post("/api/projects/:projectId/machines/probe", ({ store }) => {
    const checkedAt = new Date().toISOString();
    for (const machine of store.f.machines.machines) {
      if (machine.status) machine.status = { ...machine.status, checkedAt };
    }
    return machinesResponse(store);
  })
  .post("/api/projects/:projectId/machines/use", ({ store, body }): unknown => {
    const ids = record(body).machines;
    const refused: MachinesUseResponse["refused"] = Array.isArray(ids)
      ? ids
          .filter((id): id is string => typeof id === "string")
          .map((machineId) => ({ machineId, why: "no-image" as const }))
      : [];
    return json({ ...machinesResponse(store), refused } satisfies MachinesUseResponse, 202);
  })
  .post("/api/projects/:projectId/machines/ssh-hosts", ({ store, body }): unknown => {
    const { alias, hostName } = record(body);
    const name = str(alias, "new-host");
    if (store.f.machines.machines.some((m) => m.alias === name))
      fail(409, "ssh_host_exists", "That alias exists.");
    store.f.machines.machines.push({
      id: `ssh:${name}`,
      alias: name,
      installed: null,
      machineId: null,
      local: false,
      connection: null,
      api: null,
      status: null,
      root: `~/.penguin/data`,
    });
    void hostName;
    return json(machinesResponse(store), 201);
  })
  .get("/api/projects/:projectId/machines/ssh-hosts/:alias", ({ params }): SshHostResponse => ({
    alias: params.alias!,
    hostName: `${params.alias}.example.internal`,
    user: "ubuntu",
    port: 22,
    editable: true,
  }))
  .put("/api/projects/:projectId/machines/ssh-hosts/:alias", ({ store }) => machinesResponse(store))
  .post("/api/projects/:projectId/machines/stop-using", ({ store }) => machinesResponse(store))
  .post("/api/projects/:projectId/machines/:machineId/install", () =>
    readOnly("install on a machine"),
  )
  .post("/api/projects/:projectId/machines/:machineId/connect", () => readOnly("connect a machine"))
  .post("/api/projects/:projectId/machines/:machineId/release", ({ store }) =>
    machinesResponse(store),
  )
  .post("/api/projects/:projectId/machines/:machineId/restart", () => readOnly("restart a machine"))
  .post("/api/projects/:projectId/machines/:machineId/disconnect", ({ store }) =>
    machinesResponse(store),
  );

// ---------------------------------------------------------------------------------------------
// Version, self-update, desktop
// ---------------------------------------------------------------------------------------------

const idleJob: UpdateJobStatus = { state: "idle", targetVersion: null, output: "" };

router
  .get("/api/version", ({ store }): VersionResponse => store.f.version)
  .get("/api/version/history", (): VersionHistoryResponse => ({
    current: null,
    entries: [],
    lastRollback: null,
  }))
  .post("/api/version/history/rollback", () => readOnly("roll a version back"))
  .get("/api/version/history/ifaces/:hash", () => notFound("Interface table"))
  .get("/api/version/history/diff", () => ({ added: [], removed: [], changed: [] }))
  .get("/api/version/update-check", ({ store }): UpdateCheckResponse => store.f.update)
  .get("/api/version/update", (): UpdateJobStatus => idleJob)
  .post("/api/version/update", () => readOnly("update the server"))
  .post("/api/version/restart", (): RestartResponse => ({
    restarting: false,
    reason: "no_supervisor",
  }))
  .get("/api/desktop/update", (): DesktopUpdateStatusResponse => ({ status: null }))
  .post("/api/desktop/update/check", () => notFound("Desktop updater"))
  .post("/api/desktop/update/download", () => notFound("Desktop updater"))
  .post("/api/desktop/update/install", () => notFound("Desktop updater"))
  .get("/api/desktop/tray", (): DesktopTrayStatusResponse => ({ status: null }))
  .put("/api/desktop/tray", () => empty())
  .post("/api/desktop/privacy-settings", () => notFound("Desktop mode"));

// ---------------------------------------------------------------------------------------------
// The agent browser: the demo answers as a server with no desktop shell does, where the only
// backend is the user's own Chrome, and this user has not paired one
// ---------------------------------------------------------------------------------------------

function browserUnavailable(): never {
  return fail(
    503,
    "browser_unavailable",
    "No Chrome is paired for this user; the demo has no extension to connect.",
  );
}

/** A pairing code's shape: 43 base64url characters. */
const DEMO_PAIRING_CODE = "demo-pairing-code-for-the-gallery-0123456789";

router
  .get("/api/builtin-browser/status", (): BuiltinBrowserStatus => ({
    available: false,
    reason: "extension_not_paired",
    backend: "chrome",
    backends: [{ backend: "chrome", available: false, reason: "extension_not_paired" }],
    tabs: [],
    activeTabId: null,
  }))
  .get("/api/builtin-browser/backend", (): BrowserBackendResponse => ({
    backend: "chrome",
    choices: ["chrome"],
  }))
  .put("/api/builtin-browser/backend", () => readOnly("switch the agent browser"))
  .post("/api/builtin-browser/extension/pairings", (): BrowserExtensionPairingResponse => ({
    code: DEMO_PAIRING_CODE.slice(0, 43),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    origin: null,
  }))
  .get("/api/builtin-browser/extension", (): BrowserExtensionsResponse => ({
    paired: [],
    enabled: true,
  }))
  .delete("/api/builtin-browser/extension/:id", () => notFound("Paired Chrome"))
  .post("/api/builtin-browser/tabs/:tab/navigate", browserUnavailable)
  .post("/api/builtin-browser/tabs", browserUnavailable)
  .post("/api/builtin-browser/tabs/claim", browserUnavailable)
  .post("/api/builtin-browser/tabs/on-screen", browserUnavailable)
  .post("/api/builtin-browser/tabs/:tab/activate", browserUnavailable)
  .delete("/api/builtin-browser/tabs/:tab", browserUnavailable)
  .get("/api/builtin-browser/import/sources", (): BuiltinBrowserImportSourcesResponse => ({
    sources: [],
  }))
  .post("/api/builtin-browser/import", () => readOnly("import into the built-in browser"))
  .get("/api/builtin-browser/settings", (): BuiltinBrowserSettings => ({ homepage: null }))
  .put("/api/builtin-browser/settings", () => readOnly("change the built-in browser's settings"))
  .get("/api/builtin-browser/history", (): BuiltinBrowserHistoryResponse => ({ entries: [] }))
  .delete("/api/builtin-browser/history", () => empty())
  .post("/api/builtin-browser/clear-data", browserUnavailable);

// ---------------------------------------------------------------------------------------------
// Company mode: off in the demo, so every organization route answers as the server does then
// ---------------------------------------------------------------------------------------------

function companyOff(): never {
  return fail(404, "company_mode_off", "Company mode is off.");
}

router
  .get("/api/projects/:projectId/organizations", (): OrganizationsResponse => ({
    organizations: [],
  }))
  .post("/api/projects/:projectId/organizations", companyOff)
  .post("/api/projects/:projectId/suggest-id", ({ body }): SemanticIdSuggestResponse => {
    const name = str(record(body).name, "untitled");
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return id === ""
      ? { id: `untitled-${dayKey(Date.now())}`, source: "placeholder", reason: "no_ascii" }
      : { id, source: "fallback", reason: "no_default_model" };
  })
  .get("/api/projects/:projectId/organizations/:orgId", companyOff)
  .patch("/api/projects/:projectId/organizations/:orgId", companyOff)
  .delete("/api/projects/:projectId/organizations/:orgId", companyOff)
  .get("/api/projects/:projectId/organizations/:orgId/chart", companyOff)
  .post("/api/projects/:projectId/organizations/:orgId/employees", companyOff)
  .patch("/api/projects/:projectId/organizations/:orgId/employees/:agentId", companyOff)
  .delete("/api/projects/:projectId/organizations/:orgId/employees/:agentId", companyOff)
  .get("/api/projects/:projectId/organizations/:orgId/employees/:agentId/desk", companyOff)
  .post("/api/projects/:projectId/organizations/:orgId/employees/:agentId/desk", companyOff)
  .get("/api/projects/:projectId/organizations/:orgId/handbook", companyOff)
  .put("/api/projects/:projectId/organizations/:orgId/handbook", companyOff)
  .get("/api/projects/:projectId/organizations/:orgId/handbook/files", companyOff)
  .get("/api/projects/:projectId/organizations/:orgId/handbook/files/*", companyOff)
  .put("/api/projects/:projectId/organizations/:orgId/handbook/files/*", companyOff)
  .delete("/api/projects/:projectId/organizations/:orgId/handbook/files/*", companyOff)
  .get("/api/projects/:projectId/organizations/:orgId/calendar", companyOff)
  .post("/api/projects/:projectId/organizations/:orgId/calendar", companyOff)
  .put("/api/projects/:projectId/organizations/:orgId/calendar/:agentId/:name", companyOff)
  .delete("/api/projects/:projectId/organizations/:orgId/calendar/:agentId/:name", companyOff)
  .get("/api/projects/:projectId/organizations/:orgId/tickets", companyOff)
  .get("/api/projects/:projectId/organizations/:orgId/tickets/:ticketId", companyOff)
  .post("/api/projects/:projectId/organizations/:orgId/tickets", companyOff)
  .put("/api/projects/:projectId/organizations/:orgId/tickets/:ticketId", companyOff)
  .post("/api/projects/:projectId/organizations/:orgId/tickets/:ticketId/:action", companyOff)
  .get("/api/projects/:projectId/organizations/:orgId/channels", companyOff)
  .post("/api/projects/:projectId/organizations/:orgId/channels", companyOff)
  .get("/api/projects/:projectId/organizations/:orgId/channels/:channelId", companyOff)
  .patch("/api/projects/:projectId/organizations/:orgId/channels/:channelId", companyOff)
  .post("/api/projects/:projectId/organizations/:orgId/channels/:channelId/members", companyOff)
  .delete(
    "/api/projects/:projectId/organizations/:orgId/channels/:channelId/members/:principal",
    companyOff,
  )
  .get("/api/projects/:projectId/organizations/:orgId/channels/:channelId/messages", companyOff)
  .post("/api/projects/:projectId/organizations/:orgId/channels/:channelId/messages", companyOff)
  .post("/api/projects/:projectId/organizations/:orgId/channels/:channelId/read", companyOff)
  .get("/api/projects/:projectId/organizations/:orgId/finance", companyOff)
  .get("/api/projects/:projectId/organizations/:orgId/sessions", companyOff);

// ---------------------------------------------------------------------------------------------
// Workflows and the Project's plugin list
// ---------------------------------------------------------------------------------------------

router
  .get("/api/projects/:projectId/agents/:agentId/workflows", (): { workflows: WorkflowInfo[] } => ({
    workflows: [],
  }))
  .post("/api/projects/:projectId/agents/:agentId/workflows/:workflowId/reload", () =>
    notFound("Workflow"),
  )
  .get("/api/projects/:projectId/agents/:agentId/workflows/:workflowId/history", () => ({
    versions: [],
  }))
  .post("/api/projects/:projectId/agents/:agentId/workflows/:workflowId/rollback", () =>
    notFound("Workflow"),
  )
  .delete("/api/projects/:projectId/agents/:agentId/workflows/:workflowId", () =>
    notFound("Workflow"),
  )
  .get(
    "/api/projects/:projectId/plugins/installed",
    ({ store }): InstalledPluginsResponse => store.f.installedPlugins,
  )
  .put(
    "/api/projects/:projectId/plugins/installed",
    ({ store, body }): InstalledPluginsResponse => {
      const list = record(body).plugins;
      if (Array.isArray(list)) {
        const wanted = new Set(list.filter((p): p is string => typeof p === "string"));
        for (const plugin of store.f.installedPlugins.plugins)
          plugin.everywhere = wanted.has(plugin.specifier);
      }
      return store.f.installedPlugins;
    },
  )
  .post(
    "/api/projects/:projectId/plugins/installed",
    ({ store, body }): InstalledPluginsResponse => {
      const specifier = str(record(body).specifier);
      if (!store.f.installedPlugins.shipped.includes(specifier))
        fail(404, "plugin_not_shipped", "This build does not ship that plugin.");
      if (!store.f.installedPlugins.plugins.some((p) => p.specifier === specifier)) {
        store.f.installedPlugins.plugins.push({
          specifier,
          active: false,
          builtin: true,
          modules: [],
          replaces: [],
          everywhere: true,
          machines: [],
          here: true,
        });
        store.f.installedPlugins.restartPending = true;
      }
      return store.f.installedPlugins;
    },
  )
  .delete(
    "/api/projects/:projectId/plugins/installed",
    ({ store, query }): InstalledPluginsResponse => {
      const specifier = query.get("specifier");
      store.f.installedPlugins.plugins = store.f.installedPlugins.plugins.filter(
        (p) => p.specifier !== specifier,
      );
      return store.f.installedPlugins;
    },
  );

// ---------------------------------------------------------------------------------------------
// The terminal list (a direct fetch in the app): nothing to attach to without a machine
// ---------------------------------------------------------------------------------------------

router.get("/api/terminals", () => ({ terminals: [] }));
