/**
 * The demo world the mocked API answers from, built for one language at a time: a signed-in
 * admin, one Project with two Agents and its built-in General Agent, their conversations (the
 * General Agent's is a self-evolution round on the docs Agent, rsi-transcript.ts), the model
 * table, the plugin library and what is installed, thirty days of usage, the docs Agent's
 * Benchmark, a draft and the built-in Benchmarks, schedules, the machines, the memory and vault
 * of the docs Agent, a small Workspace and the server's settings. Every row is typed by the server's own DTOs, so the compiler is what keeps this
 * data in step with the app that reads it.
 */
import type {
  AgentApiSettings,
  AgentConfigResponse,
  AgentSummary,
  BenchmarkCaseSummary,
  BenchmarkEvaluation,
  BenchmarkSummary,
  CaseMaterial,
  ChatDefaultsDto,
  CommandPolicyDto,
  DirListResponse,
  HookItem,
  InstalledPluginsResponse,
  MachinesResponse,
  MeResponse,
  MemberInfo,
  MemoryFileResponse,
  MemoryOverviewResponse,
  ModelEffectiveConnection,
  ModelInfo,
  ModelsResponse,
  PluginConfigEntry,
  PluginIndexResponse,
  PluginLibraryResponse,
  ProjectScheduleItem,
  ProviderConnectionDto,
  ProjectSummary,
  ProxyProbeTargetsResponse,
  ServerSettings,
  SessionContextResponse,
  SessionInfo,
  SkillMetadataItem,
  UiPrefs,
  UpdateCheckResponse,
  UsageErrorItem,
  UserInfo,
  VaultResponse,
  VersionResponse,
  WorkspaceFileEntry,
} from "@prismshadow/penguin-server/api";
// The built-in catalog, as the app reads it (the same built module the app imports): the model
// table and the group tables are what it seeds a Project with, so the app's "add new models"
// badge stays quiet, and each row's effective connection is resolved by the same function the
// server uses.
import {
  catalogEntryFor,
  PENGUIN_GO_PROVIDER_ID,
  presetModelEntries,
  presetPromotions,
  presetProviderTable,
} from "../../../../server/dist/model-catalog.js";
import { effectiveConnection } from "../../../../core/dist/state/model-connection.js";
// The built-in Benchmarks as core writes them into a new Project: their cards and their cases.
import {
  BENCHMARK_REPO,
  BENCHMARK_RUN_RULES,
  BUILTIN_BENCHMARKS,
  HARBOR_AGENT,
  HARBOR_VERSION,
} from "../../../../core/dist/state/builtin-benchmarks-data.js";
// The AMSP wire types, by path: the gallery reads them as types only and takes no dependency.
import type { AmspRecord } from "../../../../amsp/src/types";
import { harnessTimeline, orgDeskTimeline, SWITCHED_MODEL } from "./harness-transcript";
import { IDS } from "./ids";
import { agentEvaluationPlugin, rsiToolkitPlugins } from "./library-plugins";
import {
  docsAgentsMd,
  RSI_ROUND,
  RSI_WORKSPACE,
  rsiCandidateEvaluation,
  rsiEvaluatorTitle,
  rsiReferenceScore,
  rsiSummary,
  rsiTestTitle,
  rsiTestWorkspace,
  rsiTimeline,
  rsiTitle,
} from "./rsi-transcript";
import type { Lang } from "./types";
import type { ModelRef } from "./transcripts";

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** One built-in Benchmark, as core's data module holds it. */
type BuiltinBenchmark = (typeof BUILTIN_BENCHMARKS)[number];

/**
 * What a model is used with, as GET /models reports it: its own values, else its group's
 * (`providers`), else nothing (the client's default) — the catalog is not consulted; the key's
 * source and mask, the environment's where the server reported one. The mocked writes call this
 * again after every change.
 */
export function effectiveOf(
  m: Omit<ModelInfo, "effective">,
  providers: Readonly<Record<string, ProviderConnectionDto>>,
): ModelEffectiveConnection {
  const group = providers[m.provider];
  const e = effectiveConnection(
    {
      provider: m.provider,
      modelId: m.modelId,
      clientType: m.clientType,
      baseUrl: m.credential?.baseUrl,
      apiKey: m.credential?.apiKeyMasked,
    },
    group && { baseUrl: group.baseUrl, clientType: group.clientType, apiKey: group.apiKeyMasked },
  );
  // The resolver was handed masks for keys, so the key it picked is already masked. A row with
  // no key in the file reads as `env` only where the server reported the variable's mask.
  const masked = e.apiKeySource === "none" ? m.envKeyMasked : e.apiKey;
  return {
    ...(e.baseUrl !== undefined ? { baseUrl: e.baseUrl } : {}),
    baseUrlSource: e.baseUrlSource,
    ...(e.clientType !== undefined ? { clientType: e.clientType } : {}),
    clientTypeSource: e.clientTypeSource,
    apiKeySource: e.apiKeySource !== "none" ? e.apiKeySource : m.envKeyMasked ? "env" : "none",
    ...(masked !== undefined ? { apiKeyMasked: masked } : {}),
  };
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
/** `yyyy-mm-dd` in UTC, which is also what the usage series buckets on. */
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A small deterministic generator, so the numbers are stable between reloads and tests. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** The model every demo Session runs on: the catalog's default. */
export const DEFAULT_MODEL: ModelRef = {
  provider: "deepseek",
  modelId: "deepseek-flash",
  contextWindow: 1_000_000,
};

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

export interface DemoFixtures {
  lang: Lang;
  now: number;
  user: UserInfo;
  users: UserInfo[];
  me: Omit<MeResponse, "user">;
  prefs: UiPrefs;
  serverSettings: ServerSettings;
  project: ProjectSummary;
  members: MemberInfo[];
  agents: AgentSummary[];
  agentConfigs: Record<string, AgentConfigResponse>;
  models: ModelsResponse;
  sessions: SessionInfo[];
  schedules: ProjectScheduleItem[];
  library: PluginLibraryResponse;
  pluginFiles: Record<string, Record<string, string>>;
  installed: Record<string, { skills: SkillMetadataItem[]; hooks: HookItem[] }>;
  installedPlugins: InstalledPluginsResponse;
  pluginIndex: PluginIndexResponse;
  readmes: Record<string, string>;
  benchmarks: BenchmarkSummary[];
  benchmarkCases: Record<string, BenchmarkCaseSummary[]>;
  caseFiles: Record<string, Record<CaseMaterial, Record<string, string>>>;
  machines: MachinesResponse;
  version: VersionResponse;
  update: UpdateCheckResponse;
  memory: Record<string, { overview: MemoryOverviewResponse; files: MemoryFileResponse[] }>;
  vault: Record<string, VaultResponse>;
  /** Each Agent's public API settings, keyed by Agent id; an Agent missing here never had them set. */
  agentApi: Record<string, AgentApiSettings>;
  workspace: { entries: Record<string, WorkspaceFileEntry[]>; content: Record<string, string> };
  chatDefaults: ChatDefaultsDto;
  commandPolicy: CommandPolicyDto;
  pluginConfig: PluginConfigEntry[];
  probeTargets: ProxyProbeTargetsResponse;
  dirs: Record<string, DirListResponse>;
  context: SessionContextResponse;
  usage: UsageDay[];
  usageErrors: UsageErrorItem[];
}

/** One day of one Agent on one model, the grain the usage routes aggregate from. */
export interface UsageDay {
  date: string;
  agentId: string;
  sessionId: string;
  provider: string;
  modelId: string;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  requests: number;
  completed: number;
  aborted: number;
}

export function buildFixtures(lang: Lang, now: number): DemoFixtures {
  const L = <T>(zh: T, en: T): T => (lang === "zh" ? zh : en);
  const ago = (days: number, minutes = 0) => now - days * DAY - minutes * 60_000;

  const user: UserInfo = {
    userId: IDS.users.admin,
    isAdmin: true,
    passwordIsInitial: false,
    displayName: L("演示管理员", "Demo Admin"),
    createdAt: iso(ago(120)),
  };
  const member: UserInfo = {
    userId: IDS.users.member,
    isAdmin: false,
    passwordIsInitial: true,
    createdAt: iso(ago(30)),
  };

  const project: ProjectSummary = {
    projectId: IDS.project,
    name: L("PenguinHarness 演示", "PenguinHarness demo"),
    role: "owner",
    ownerUserId: user.userId,
    createdAt: iso(ago(120)),
  };

  const activity = (seed: number, peak: number): number[] => {
    const rnd = seeded(seed);
    return Array.from({ length: 30 }, (_, i) => Math.round(rnd() * peak * (0.4 + i / 30)));
  };

  const rsi = rsiTimeline(now);
  const agents: AgentSummary[] = [
    {
      agentId: IDS.agents.docs,
      name: L("文档专家", "Docs Expert"),
      description: L(
        "回答关于 Claude Code 文档的问题，每条结论都引用语料库里的真实文件。",
        "Answers questions about the Claude Code docs, citing a real corpus file for every claim.",
      ),
      createdAt: iso(ago(90)),
      // The self-evolution round's accepted candidate: its version, written when the round edited it.
      updatedAt: iso(rsi.evaluatedAt),
      activeSessionCount: 4,
      sessionCount: 12,
      sessionActivity: activity(7, 6),
      toolCount: 6,
      version: RSI_ROUND.candidate,
      kernelOutdated: false,
      vaultKeyCount: 2,
      scheduleCount: 2,
      workbenchCount: 0,
      skillCount: 3,
      hookCount: 1,
      pluginUpdates: [{ name: IDS.plugins.registry, version: "2026.09.20.1" }],
      memoryCount: 4,
      // Its API is on: see `agentApi` below.
      apiEnabled: true,
    },
    {
      agentId: IDS.agents.notes,
      name: L("发布说明助手", "Release Notes"),
      description: L(
        "从变更日志起草发布说明，中英各一份。",
        "Drafts release notes from the changelog, in both languages.",
      ),
      createdAt: iso(ago(40)),
      updatedAt: iso(ago(6)),
      activeSessionCount: 0,
      sessionCount: 2,
      sessionActivity: activity(11, 2),
      toolCount: 4,
      version: 3,
      kernelOutdated: true,
      vaultKeyCount: 0,
      scheduleCount: 1,
      workbenchCount: 0,
      skillCount: 1,
      hookCount: 0,
      pluginUpdates: [],
      memoryCount: 0,
      apiEnabled: false,
    },
    // The Project's built-in Agent, with the self-evolution toolkits installed: it ran the round.
    {
      agentId: IDS.agents.general,
      name: L("通用智能体", "General Agent"),
      description: L(
        "通用型智能体，用工具完成你交代的事。",
        "General-purpose agent that completes the user's requests with its tools.",
      ),
      createdAt: iso(ago(120)),
      updatedAt: iso(ago(30)),
      activeSessionCount: 0,
      sessionCount: 1,
      sessionActivity: activity(5, 1),
      toolCount: 9,
      version: 1,
      kernelOutdated: false,
      vaultKeyCount: 0,
      scheduleCount: 0,
      workbenchCount: 0,
      skillCount: 7,
      hookCount: 0,
      pluginUpdates: [],
      memoryCount: 0,
      apiEnabled: false,
    },
  ];

  const systemPrompt = L(
    "你是文档专家。回答问题时引用语料库中真实存在的文件。\n\n{{MEMORY}}\n\n{{SKILLS}}\n\n{{VAULT}}\n\n{{SCHEDULES}}",
    "You are Docs Expert. Cite a real corpus file for every claim.\n\n{{MEMORY}}\n\n{{SKILLS}}\n\n{{VAULT}}\n\n{{SCHEDULES}}",
  );
  // The built-in Agent ships with an empty AGENTS.md; the docs Agent's carries the round's rule.
  const agentsMdOf = (agent: AgentSummary): string => {
    if (agent.agentId === IDS.agents.general) return "";
    const md = docsAgentsMd(lang, agent.name ?? agent.agentId);
    return agent.agentId === IDS.agents.docs ? `${md.reference}\n\n${md.rule}` : md.reference;
  };
  const agentConfig = (agent: AgentSummary, full: boolean): AgentConfigResponse => ({
    agentsMd: agentsMdOf(agent),
    systemConfigYaml: `version: ${agent.version}\nkernel_version: "2026-09-11"\nname: ${agent.name}\nmodel:\n  thinking_level: medium\n  max_tokens: 32000\ncompaction:\n  max_context_length: 800000\n  mode: summarize\n`,
    config: {
      name: agent.name,
      description: agent.description,
      version: agent.version,
      kernelVersion: agent.kernelOutdated ? "2026-08-20" : "2026-09-11",
      kernelLatest: "2026-09-11",
      kernelOutdated: agent.kernelOutdated,
      systemPrompt,
      maxTurns: 40,
      model: { maxTokens: 32_000, thinkingLevel: "medium", timeoutMs: 120_000 },
      compaction: { maxContextLength: 800_000, maxSessionTurns: 60, mode: "summarize" },
      memory: {
        enabled: true,
        prompt: "# Memory\n\n{{USER_MEMORY_INDEX}}",
        workspacePrompt:
          "## Workspace memory ({{WORKSPACE_MEMORY_DIR}})\n\n{{WORKSPACE_MEMORY_INDEX}}",
      },
      vault: {
        enabled: true,
        prompt: "# Vault\n\nThese environment variables are set: {{VAULT_KEYS}}",
        templateHasPlaceholder: true,
        legacySectionPresent: false,
      },
      skills: {
        enabled: true,
        prompt: "# Skills\n\n{{SKILL_METADATA}}",
        templateHasPlaceholder: true,
        legacySectionPresent: false,
      },
      schedules: {
        enabled: full,
        prompt: "# Scheduled tasks\n\n{{SCHEDULE_LIST}}",
        templateHasPlaceholder: full,
      },
      hooks: { enabled: true },
      toolsBuiltin: [
        {
          name: "read_file",
          description: "Read a file from the Workspace.",
          parameters: { type: "object", properties: { path: { type: "string" } } },
          permission: "r",
        },
        {
          name: "write_file",
          description: "Write a whole file.",
          parameters: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
          },
          permission: "rw",
        },
        {
          name: "edit_file",
          description: "Replace one exact string in a file.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string" },
              old_string: { type: "string" },
              new_string: { type: "string" },
            },
          },
          permission: "rw",
        },
        {
          name: "exec_command",
          description: "Run a shell command in the Workspace.",
          parameters: {
            type: "object",
            properties: { description: { type: "string" }, cmd: { type: "string" } },
          },
          permission: "rw",
          timeoutMs: 600_000,
          maxOutputLength: 20_000,
        },
        ...(full
          ? [
              {
                name: "run_subagent",
                description: "Delegate a task to a child Agent.",
                parameters: {
                  type: "object",
                  properties: { description: { type: "string" }, task: { type: "string" } },
                },
                permission: "rw",
              } as AgentConfigResponse["config"]["toolsBuiltin"][number],
            ]
          : []),
      ],
      mcpServers: full
        ? [
            {
              name: "filesystem",
              config: {
                transport: "stdio",
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-filesystem", IDS.workspace],
              },
            },
          ]
        : [],
    },
    stateDir: `/home/demo/.penguin/data/projects/${IDS.project}/agents/${agent.agentId}/agent_state`,
    activeSessionCount: agent.activeSessionCount,
  });

  // Every preset the catalog seeds a Project with, in catalog order, each row exactly as the
  // server serves a fresh table — name, context window, vision, list price and the running
  // promotion, and a protocol or endpoint only where it differs from its group's table (an
  // OpenCode Go Messages row, Penguin Go's pins, Atria in custom) — beside the group tables a new
  // Project writes, so every gateway row follows its group and the app's catalog check finds
  // nothing to add. Two groups hold a group key and one is covered by the environment; the rest
  // wait for a key, as in a fresh install.
  const promotions = new Map(
    presetPromotions().map((p) => [`${p.provider}\0${p.modelId}`, p.discount]),
  );
  const providers: Record<string, ProviderConnectionDto> = Object.fromEntries(
    Object.entries(presetProviderTable()).map(([id, table]) => [
      id,
      {
        ...(table.base_url !== undefined ? { baseUrl: table.base_url } : {}),
        ...(table.client_type !== undefined ? { clientType: table.client_type } : {}),
      },
    ]),
  );
  providers.deepseek = { apiKeyMasked: "sk-3f…9a2c", createdAt: iso(ago(60)) };
  providers.openai = { apiKeyMasked: "sk-pr…7Hd1", createdAt: iso(ago(12)) };
  const envKeys: Record<string, Partial<ModelInfo>> = {
    deepseek: { envKey: "DEEPSEEK_API_KEY" },
    anthropic: { envKey: "ANTHROPIC_API_KEY", envKeyMasked: "sk-ant…Qm4x" },
    openai: { envKey: "OPENAI_API_KEY" },
  };
  const rows: Array<Omit<ModelInfo, "effective">> = presetModelEntries().map((entry) => {
    const catalog = catalogEntryFor(entry.provider, entry.model_id);
    const discount = promotions.get(`${entry.provider}\0${entry.model_id}`);
    return {
      provider: entry.provider,
      modelId: entry.model_id,
      ...(catalog?.displayName ? { displayName: catalog.displayName } : {}),
      ...(entry.context_window !== undefined ? { contextWindow: entry.context_window } : {}),
      ...(entry.client_type !== undefined ? { clientType: entry.client_type } : {}),
      ...(entry.base_url !== undefined ? { credential: { baseUrl: entry.base_url } } : {}),
      ...(entry.vision === false ? { vision: false } : {}),
      ...(entry.pricing
        ? {
            pricing: {
              cacheRead: entry.pricing.cache_read,
              cacheWrite: entry.pricing.cache_write,
              output: entry.pricing.output,
            },
          }
        : {}),
      ...(discount !== undefined && entry.provider !== PENGUIN_GO_PROVIDER_ID ? { discount } : {}),
      ...(envKeys[entry.provider] ?? {}),
      isDefault:
        entry.provider === DEFAULT_MODEL.provider && entry.model_id === DEFAULT_MODEL.modelId,
    };
  });
  rows.push({
    provider: "custom",
    modelId: "qwen3.8-27b-local",
    displayName: L("本机 Qwen 3.8", "Local Qwen 3.8"),
    contextWindow: 131_072,
    clientType: "openai-chat",
    vision: false,
    maxTokens: 8_192,
    credential: { baseUrl: "http://127.0.0.1:8000/v1", createdAt: iso(ago(3)) },
    isDefault: false,
  });
  const modelsResponse: ModelsResponse = {
    defaultModel: { provider: DEFAULT_MODEL.provider, modelId: DEFAULT_MODEL.modelId },
    visionModel: { provider: "anthropic", modelId: "claude-sonnet-5" },
    updatedAt: iso(ago(3)),
    providers,
    models: rows.map((m) => ({ ...m, effective: effectiveOf(m, providers) })),
  };

  const sandbox: SessionInfo["sandbox"] = {
    mode: "workspace-write",
    network: "open",
    localNetworkSupported: false,
  };
  const session = (
    sessionId: string,
    agentId: string,
    title: string,
    createdAt: number,
    extra: Partial<SessionInfo> = {},
  ): SessionInfo => ({
    sessionId,
    projectId: IDS.project,
    agentId,
    provider: DEFAULT_MODEL.provider,
    modelId: DEFAULT_MODEL.modelId,
    workspace: IDS.workspace,
    approvalMode: "allow-all",
    sandbox,
    title,
    createdAt: iso(createdAt),
    lastActiveAt: iso(createdAt + 40_000),
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: false,
    client: "web",
    ...extra,
  });
  const tempWorkspace = `/home/demo/.penguin/data/projects/${IDS.project}/agents/${IDS.agents.docs}/workspaces/tmp-7c1e9b2a`;
  const harness = harnessTimeline(now);
  const orgDesk = orgDeskTimeline(now);
  const sessions: SessionInfo[] = [
    session(
      IDS.sessions.approval,
      IDS.agents.docs,
      L("发布文档包", "Publish the docs package"),
      ago(0, 1),
      {
        status: "running",
        pendingApprovalCount: 1,
        approvalMode: "always-ask",
        lastActiveAt: iso(ago(0, 0)),
      },
    ),
    session(
      IDS.sessions.thinking,
      IDS.agents.docs,
      L("规划 0.3 发布说明", "Plan the 0.3 release notes"),
      ago(0, 2),
      {
        status: "running",
        lastActiveAt: iso(ago(0, 0)),
      },
    ),
    session(
      IDS.sessions.streaming,
      IDS.agents.docs,
      L("讲解引用校验", "Explain the citation guard"),
      ago(0, 2.5),
      {
        status: "running",
        lastActiveAt: iso(ago(0, 0)),
      },
    ),
    session(
      IDS.sessions.runningTool,
      IDS.agents.docs,
      L("检查文档里的全部链接", "Check every link in the docs"),
      ago(0, 3),
      {
        status: "running",
        lastActiveAt: iso(ago(0, 1)),
        backgroundTasks: { processes: 1, subagents: 0 },
      },
    ),
    session(
      IDS.sessions.done,
      IDS.agents.docs,
      L("为 hooks 文档建立索引", "Index the hooks docs"),
      ago(0, 45),
    ),
    session(IDS.sessions.older[0], IDS.agents.docs, L("同步语料库", "Sync the corpus"), ago(1, 20)),
    session(IDS.sessions.older[1], IDS.agents.docs, L("上手说明", "Onboarding note"), ago(2, 60), {
      workspace: tempWorkspace,
    }),
    session(
      IDS.sessions.older[2],
      IDS.agents.docs,
      L("常失败的评估用例", "Cases that fail most"),
      ago(4, 10),
    ),
    session(
      IDS.sessions.older[3],
      IDS.agents.docs,
      L("接入 MCP 服务器", "Connect the MCP server"),
      ago(6, 5),
      {
        approvalMode: "read-only",
      },
    ),
    session(
      IDS.sessions.archived,
      IDS.agents.docs,
      L("迁移旧索引", "Migrate the old index"),
      ago(20),
      {
        archived: true,
      },
    ),
    // A program's Session nobody kept: archived by the listing rule.
    session(IDS.sessions.schedule, IDS.agents.docs, L("每晚同步", "Nightly sync"), ago(0, 420), {
      source: "schedule",
      archived: true,
    }),
    session(
      IDS.sessions.subagent,
      IDS.agents.docs,
      L("检查 hooks.md 的链接", "Check links in hooks.md"),
      ago(0, 44),
      {
        source: "subagent",
      },
    ),
    session(
      IDS.sessions.benchmark,
      IDS.agents.docs,
      L("评估 CASE-001", "Evaluate CASE-001"),
      ago(3),
      {
        // A Test Session the evaluation launched through `penguin run`: archived until kept.
        source: "cli",
        archived: true,
        workspace: `/home/demo/.penguin/data/projects/${IDS.project}/agents/${IDS.agents.docs}/workspaces/case-001`,
      },
    ),
    // A `penguin run` Session the user unarchived: kept in the sidebar, wearing its CLI glyph.
    session(
      IDS.sessions.kept,
      IDS.agents.docs,
      L("批量重建索引", "Rebuild the index in batch"),
      ago(1, 120),
      {
        source: "cli",
      },
    ),
    // Every row the harness writes; it switched models mid-way, so the row names the new one.
    session(
      IDS.sessions.harness,
      IDS.agents.docs,
      L("修复 hooks 文档的引用", "Fix the hooks doc citations"),
      harness.startedAt,
      {
        provider: SWITCHED_MODEL.provider,
        modelId: SWITCHED_MODEL.modelId,
        lastActiveAt: iso(harness.endedAt),
      },
    ),
    session(
      IDS.sessions.notes[0],
      IDS.agents.notes,
      L("0.2.13 发布说明", "0.2.13 release notes"),
      ago(5, 30),
    ),
    session(
      IDS.sessions.notes[1],
      IDS.agents.notes,
      L("破坏性变更清单", "Breaking changes list"),
      ago(9),
    ),
    // An organization's desk Session (a company Session, with the durable `org` stamp):
    // reached by its link, never listed.
    session(
      IDS.sessions.orgDesk,
      IDS.agents.notes,
      L("本周发布摘要", "This week's release digest"),
      orgDesk.startedAt,
      {
        workspace: "/home/demo/projects/release-notes",
        lastActiveAt: iso(orgDesk.endedAt),
        client: "org",
        source: "company",
      },
    ),
    // The General Agent's self-evolution round on the docs Agent, on the model it was run with.
    session(IDS.sessions.optimize, IDS.agents.general, rsiTitle(lang), rsi.startedAt, {
      workspace: RSI_WORKSPACE,
      lastActiveAt: iso(rsi.endedAt),
    }),
    // Its evaluator subagents, which its tool cards open, and the Test Sessions they ran with
    // `penguin run`: CLI Sessions, archived until kept.
    ...IDS.sessions.evaluators.map((id, i) =>
      session(id, IDS.agents.general, rsiEvaluatorTitle(lang, i), rsi.startedAt + 54_000, {
        workspace: RSI_WORKSPACE,
        source: "subagent",
        lastActiveAt: iso(rsi.evaluatedAt - 20_000),
      }),
    ),
    ...IDS.sessions.tests.map((id, i) =>
      session(id, IDS.agents.docs, rsiTestTitle(lang, i), rsi.startedAt + 61_000, {
        workspace: rsiTestWorkspace(i),
        source: "cli",
        archived: true,
        lastActiveAt: iso(rsi.startedAt + 61_000 + RSI_ROUND.cases[i]!.after.durationMs),
      }),
    ),
  ];

  const schedules: ProjectScheduleItem[] = [
    {
      agentId: IDS.agents.docs,
      name: "nightly-docs-sync",
      prompt: L(
        "从文档仓库同步语料库，汇报变化。",
        "Sync the corpus from the docs repository and report what changed.",
      ),
      enabled: true,
      startAt: iso(ago(30)),
      period: "24h",
      status: "active",
      nextFireAt: iso(now + 6 * 3_600_000),
      lastFiredAt: iso(ago(0, 420)),
      queued: false,
      creatorUserId: user.userId,
    },
    {
      agentId: IDS.agents.docs,
      name: "weekly-link-check",
      prompt: L("检查语料库里的所有链接。", "Check every link in the corpus."),
      enabled: true,
      startAt: iso(ago(14)),
      period: "7d",
      sessionId: IDS.sessions.runningTool,
      status: "active",
      nextFireAt: iso(now + 5 * DAY),
      lastFiredAt: iso(ago(2)),
      queued: false,
      creatorUserId: user.userId,
    },
    {
      agentId: IDS.agents.notes,
      name: "release-digest",
      prompt: L("汇总本周合并的 PR。", "Summarize the PRs merged this week."),
      enabled: false,
      startAt: iso(ago(20)),
      period: "7d",
      endAt: iso(now + 60 * DAY),
      provider: "anthropic",
      modelId: "claude-sonnet-5",
      status: "disabled",
      queued: false,
      creatorUserId: user.userId,
    },
  ];

  const skill = (
    name: string,
    zh: string,
    en: string,
    version = "2026.09.11.1",
  ): SkillMetadataItem => ({
    name,
    description: en,
    shortDescription: en,
    shortDescriptionZh: zh,
    version,
  });
  // The self-evolution toolkits and the evaluator are the shipped packages' own listings; the
  // other groups are the demo's.
  const toolkits = rsiToolkitPlugins();
  const evaluationPlugin = agentEvaluationPlugin();
  const library: PluginLibraryResponse = {
    groups: [
      { id: "rsi", title: "Agent Self-Evolution", titleZh: "Agent 自进化", plugins: toolkits },
      {
        id: "developer",
        title: "Developer",
        titleZh: "开发",
        plugins: [
          {
            name: IDS.plugins.registry,
            description:
              "Answer questions about Claude Code from its documentation, with citations.",
            descriptionZh: "基于 Claude Code 文档回答问题，并给出引用。",
            shortDescription: "Claude Code docs, with citations",
            shortDescriptionZh: "带引用的 Claude Code 文档问答",
            version: "0.2.13",
            package: `@penguinharness/${IDS.plugins.registry}`,
            source: "builtin",
            skills: [
              skill(
                "claude-code-expert",
                "检索并引用 Claude Code 文档",
                "Search and cite the Claude Code docs",
                "2026.09.20.1",
              ),
              skill("docs-sync", "从上游同步文档语料库", "Sync the docs corpus from upstream"),
            ],
            hooks: [],
            mcpServers: [],
          },
          {
            name: "penguin-sdk",
            description:
              "Build with the PenguinHarness SDK: the Session, Agent State and AMSP record APIs.",
            descriptionZh: "使用 PenguinHarness SDK 开发：Session、Agent State 与 AMSP 记录接口。",
            version: "0.2.13",
            package: "@penguinharness/penguin-sdk",
            source: "builtin",
            skills: [
              skill("penguin-sdk", "PenguinHarness SDK 用法", "How to use the PenguinHarness SDK"),
            ],
            hooks: [],
            mcpServers: [],
          },
          {
            name: "web-design",
            description: "Design and build web pages that do not read as templated defaults.",
            descriptionZh: "设计并实现不像模板默认值的网页。",
            version: "0.2.13",
            package: "@penguinharness/web-design",
            source: "builtin",
            skills: [skill("web-design", "网页视觉设计", "Web visual design")],
            hooks: [],
            mcpServers: [],
          },
        ],
      },
      {
        id: "office",
        title: "Office Productivity",
        titleZh: "办公效率",
        plugins: [
          {
            name: "goal",
            description:
              "Run a Session round after round until an objective is met, within a token budget.",
            descriptionZh: "在 Token 预算内一轮轮推进，直到达成目标。",
            version: "0.2.13",
            package: "@penguinharness/goal",
            source: "builtin",
            skills: [],
            hooks: ["stop"],
            hookVersion: "2026.09.02.1",
            mcpServers: [],
          },
          {
            name: "continual-learning",
            description: "Write what a Session learned into the Agent's memory when it ends.",
            descriptionZh: "会话结束时把学到的东西写进智能体记忆。",
            version: "0.2.13",
            package: "@penguinharness/continual-learning",
            source: "builtin",
            skills: [
              skill(
                "continual-learning",
                "会话结束时沉淀记忆",
                "Consolidate memory when a Session ends",
              ),
            ],
            hooks: ["stop"],
            hookVersion: "2026.09.02.1",
            mcpServers: [],
          },
          {
            name: "report-writer",
            description:
              "Turn findings into a structured report with a summary, sections and an appendix.",
            descriptionZh: "把调查结果整理成带摘要、分节和附录的报告。",
            version: "0.2.13",
            package: "@acme/report-writer",
            source: "installed",
            skills: [skill("report-writer", "撰写结构化报告", "Write structured reports")],
            hooks: [],
            mcpServers: [],
          },
        ],
      },
      {
        id: "ai-app-development",
        title: "AI App Development",
        titleZh: "AI 应用开发",
        plugins: [evaluationPlugin],
      },
    ],
  };
  const pluginFiles: Record<string, Record<string, string>> = {
    [IDS.plugins.registry]: {
      "skills/claude-code-expert/SKILL.md":
        "---\nname: claude-code-expert\nversion: 2026.09.20.1\ndescription: Search and cite the Claude Code docs\n---\n\n# Claude Code expert\n\nSearch the corpus first, then answer with `[n] path` citations.\n",
      "skills/claude-code-expert/scripts/search.mjs":
        "#!/usr/bin/env node\n// BM25 over corpus/*.md\n",
      "skills/docs-sync/SKILL.md":
        "---\nname: docs-sync\nversion: 2026.09.11.1\ndescription: Sync the docs corpus from upstream\n---\n\n# Docs sync\n",
    },
    goal: {
      "hooks/hooks.json":
        '{ "name": "goal", "version": "2026.09.02.1", "events": ["stop"], "scripts": { "stop": "stop.mjs" } }\n',
      "hooks/stop.mjs":
        "export default async function stop(ctx) { return ctx.goal.done ? 'stop' : 'continue'; }\n",
    },
  };
  const registryPlugin = library.groups
    .flatMap((group) => group.plugins)
    .find((plugin) => plugin.name === IDS.plugins.registry)!;
  const docsSkills = registryPlugin.skills.map((s) => ({
    ...s,
    version: s.name === "claude-code-expert" ? "2026.09.11.1" : s.version,
  }));
  const installed: DemoFixtures["installed"] = {
    [IDS.agents.docs]: {
      skills: [
        ...docsSkills,
        skill("report-writer", "撰写结构化报告", "Write structured reports", "2026.09.02.1"),
      ],
      hooks: [
        {
          name: "goal",
          description: "Run a Session round after round until an objective is met.",
          descriptionZh: "一轮轮推进，直到达成目标。",
          version: "2026.09.02.1",
          events: ["stop"],
        },
      ],
    },
    [IDS.agents.notes]: {
      skills: [
        skill("report-writer", "撰写结构化报告", "Write structured reports", "2026.09.02.1"),
      ],
      hooks: [],
    },
    // Every toolkit and the evaluator, each Skill wearing its plugin's icon, as an install writes it.
    [IDS.agents.general]: {
      skills: [...toolkits, evaluationPlugin].flatMap((plugin) =>
        plugin.skills.map((s) => ({ ...s, ...(plugin.icon ? { icon: plugin.icon } : {}) })),
      ),
      hooks: [],
    },
  };

  const installedPlugins: InstalledPluginsResponse = {
    plugins: [
      {
        specifier: "@penguinharness/sandbox-bwrap",
        active: true,
        builtin: true,
        modules: ["sandbox.bwrap"],
        replaces: ["sandbox"],
        everywhere: true,
        machines: [],
        here: true,
      },
      {
        specifier: "@penguinharness/messaging-feishu",
        active: false,
        builtin: false,
        modules: ["messaging.feishu"],
        replaces: [],
        everywhere: false,
        machines: ["gpu-box-a8f3c2"],
        here: false,
      },
      // A plugin the running build cannot run: loaded, left out, with the platform's reason.
      {
        specifier: "@penguinharness/claude-code",
        active: false,
        builtin: false,
        modules: ["ClaudeCode"],
        replaces: [],
        unsatisfied: {
          disabled: true,
          reason:
            "/PlatformModule/ClaudeCode: requires.surfaces from 'SessionSurfacesModule': no such module",
        },
        everywhere: true,
        machines: [],
        here: true,
      },
    ],
    shipped: ["@penguinharness/sandbox-bwrap", "@penguinharness/sandbox-seatbelt"],
    file: ".project_config.toml",
    machineId: "demo-machine-0001",
    restartPending: false,
  };
  // The sandbox backends' cards: their rows carry the bilingual descriptions and the shield
  // icons the packages' own package.json (its `penguin` block) and icon hold.
  const shield = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5.2c0 4.4-3 8.2-7 9.8-4-1.6-7-5.4-7-9.8V6l7-3z" />${inner}</svg>`;
  const pluginIndex: PluginIndexResponse = {
    plugins: [
      {
        name: "@penguinharness/sandbox-bwrap",
        version: "0.2.13",
        description: "Confines agent commands with bubblewrap on Linux.",
        descriptionZh: "在 Linux 上用 bubblewrap 封禁 Agent 的命令。",
        shortDescription: "Linux: confine file writes, cut the network, mask paths.",
        shortDescriptionZh: "Linux：限制文件写入、断开网络、屏蔽路径。",
        icon: shield(
          '<circle cx="10.4" cy="10.3" r="1.7" /><circle cx="14.2" cy="12.3" r="1.1" /><circle cx="11.3" cy="14.9" r="0.8" />',
        ),
        authors: ["PenguinHarness"],
        license: "MIT",
        repository: "https://github.com/prismshadow/penguin-harness",
        keywords: ["linux", "sandbox"],
        categories: ["sandbox"],
        updatedAt: Math.floor(ago(19) / 1000),
      },
      {
        name: "@penguinharness/sandbox-seatbelt",
        version: "0.2.13",
        description: "Confines agent commands with Seatbelt on macOS.",
        descriptionZh: "在 macOS 上用 Seatbelt 封禁 Agent 的命令。",
        shortDescription: "macOS: confine file writes, cut the network, mask paths.",
        shortDescriptionZh: "macOS：限制文件写入、断开网络、屏蔽路径。",
        icon: shield(
          '<path d="M8.6 15.4l6.8-6.8" /><rect x="10.4" y="10.4" width="3.2" height="3.2" rx="0.6" />',
        ),
        authors: ["PenguinHarness"],
        license: "MIT",
        repository: "https://github.com/prismshadow/penguin-harness",
        keywords: ["macos", "sandbox"],
        categories: ["sandbox"],
        updatedAt: Math.floor(ago(19) / 1000),
      },
      {
        name: "@penguinharness/messaging-feishu",
        version: "0.2.12",
        description: "Relays a Session to a Feishu bot.",
        authors: ["PenguinHarness"],
        license: "MIT",
        keywords: ["messaging", "feishu"],
        categories: ["messaging"],
        updatedAt: Math.floor(ago(40) / 1000),
      },
    ],
    failures: [],
    pending: [],
  };
  const readmes: Record<string, string> = {
    "@penguinharness/sandbox-bwrap":
      '# sandbox-bwrap\n\nRuns every agent command inside a bubblewrap namespace: the Workspace is writable, the rest of the filesystem read-only, and the network follows the Session\'s sandbox level.\n\n```toml\n[plugins]\nsandbox-bwrap = "@penguinharness/sandbox-bwrap"\n```\n',
    "@penguinharness/sandbox-seatbelt":
      "# sandbox-seatbelt\n\nThe macOS counterpart of sandbox-bwrap, on Seatbelt profiles.\n",
    "@penguinharness/messaging-feishu":
      "# messaging-feishu\n\nBinds a Session to a Feishu bot so replies reach a chat.\n",
  };

  /** One case's record in an evaluation: its score, cost and duration, and the one run behind them. */
  const caseRecord = (
    id: string,
    score: number,
    cost: number,
    durationMs: number,
    sessionId: string,
  ): BenchmarkEvaluation["cases"][number] => ({
    case: id,
    score,
    cost,
    durationMs,
    runs: [{ score, cost, durationMs, sessionId }],
  });
  const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  /** An evaluation's top line, averaged from its cases as the scoreboard writes it. */
  const totals = (cases: BenchmarkEvaluation["cases"]) => ({
    cost: Math.round(mean(cases.map((c) => c.cost ?? 0)) * 1e6) / 1e6,
    durationMs: Math.round(mean(cases.map((c) => c.durationMs))),
  });
  /**
   * An evaluation of the docs Agent on its Benchmark, one run per case. The cases spread around
   * `score` (seeded, so every load draws the same) and average to it, unless they are given: the
   * self-evolution round's Reference and its accepted candidate carry the round's own numbers.
   */
  const docsEvaluation = (
    at: number,
    score: number,
    version: number,
    modelId: string,
    provider = "deepseek",
    given?: {
      scores: readonly number[];
      costs?: readonly number[];
      durations?: readonly number[];
      sessions?: readonly string[];
      summary?: { title: string; text: string };
    },
  ): BenchmarkEvaluation => {
    const rnd = seeded(Math.round(score * 100) + version);
    const spread = RSI_ROUND.cases.map(() => (rnd() - 0.5) * 24);
    const centre = mean(spread);
    const drawn = spread.map((d) => Math.max(0, Math.min(100, Math.round(score + d - centre))));
    drawn[drawn.length - 1] = Math.max(
      0,
      Math.min(100, score * drawn.length - drawn.slice(0, -1).reduce((a, b) => a + b, 0)),
    );
    const cases = RSI_ROUND.cases.map((c, i) =>
      caseRecord(
        c.id,
        given?.scores[i] ?? drawn[i]!,
        given?.costs?.[i] ?? Math.round((0.012 + rnd() * 0.02) * 10_000) / 10_000,
        given?.durations?.[i] ?? 40_000 + Math.round(rnd() * 50_000),
        given?.sessions?.[i] ?? IDS.sessions.benchmark,
      ),
    );
    return {
      time: iso(at),
      agentId: IDS.agents.docs,
      summaryTitle:
        given?.summary?.title ??
        L(
          score > 78 ? "引用命中率明显提升" : "hooks 用例仍是短板",
          score > 78 ? "Citation accuracy up markedly" : "The hooks case is still the weak spot",
        ),
      summary:
        given?.summary?.text ??
        L(
          "四个用例平均分见上；本轮把语料库扫描改为按文件存在性过滤后，引用类失分消失。",
          "Average over four cases above; filtering the corpus walk on file existence removed the citation losses this round.",
        ),
      modelId,
      provider,
      thinkingLevel: "medium",
      version,
      score,
      ...totals(cases),
      cases,
    };
  };
  const candidate = rsiCandidateEvaluation();
  const docsEvaluations: BenchmarkEvaluation[] = [
    docsEvaluation(ago(18), 48, 9, "deepseek-flash"),
    docsEvaluation(ago(13), 62, 11, "deepseek-flash"),
    docsEvaluation(ago(10), 69, 12, "deepseek-flash"),
    docsEvaluation(ago(7), 74, 13, "deepseek-flash"),
    docsEvaluation(ago(6), 72, 13, "claude-sonnet-5", "anthropic"),
    // The self-evolution round's Reference and the candidate it accepted (rsi-transcript.ts).
    docsEvaluation(
      rsi.referenceAt,
      rsiReferenceScore(),
      RSI_ROUND.reference,
      "deepseek-flash",
      "deepseek",
      {
        scores: RSI_ROUND.cases.map((c) => c.before),
      },
    ),
    docsEvaluation(
      rsi.evaluatedAt,
      candidate.score,
      RSI_ROUND.candidate,
      "deepseek-flash",
      "deepseek",
      {
        scores: RSI_ROUND.cases.map((c) => c.after.score),
        costs: RSI_ROUND.cases.map((c) => c.after.cost),
        durations: RSI_ROUND.cases.map((c) => c.after.durationMs),
        sessions: IDS.sessions.tests,
        summary: rsiSummary(lang),
      },
    ),
  ];

  // The built-in Benchmarks, as core writes them into a new Project: every case is a Harbor task
  // whose statement and rubric are text only. The writer is core's (builtin-benchmarks.ts), kept
  // private there beside the file system, so the two texts are spelled again here, word for word.
  const builtinCaseId = (index: number, task: string) =>
    `CASE-${String(index).padStart(3, "0")}-${task}`;
  const taskPath = (bench: BuiltinBenchmark) => `benchmarks/${bench.repoDir}/tasks`;
  const repoLink = (bench: BuiltinBenchmark, kind: "tree" | "blob", rel: string) =>
    `${BENCHMARK_REPO}/${kind}/${bench.ref}/${rel}`;
  const shellWord = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;
  const builtinStatement = (
    bench: BuiltinBenchmark,
    item: BuiltinBenchmark["cases"][number],
  ): string => {
    const offline = bench.agentNetwork === "no-network";
    const facts = [
      `- Benchmark: ${bench.title} — ${bench.source} · Category: ${item.category}` +
        (item.expertHours !== undefined ? ` · Expert estimate: ${item.expertHours} h` : ""),
      `- Task: \`${item.task}\` in ${repoLink(bench, "tree", `${taskPath(bench)}/${item.task}`)}`,
      `- Upstream: ${bench.upstream.url} (${bench.upstream.license})` +
        (item.upstreamTask !== undefined ? `, ${item.upstreamTask}` : ""),
      `- Container: ${item.cpus} CPU, ${item.memoryMb / 1024} GB RAM, CPU only · Agent network: ` +
        (offline ? "none, except the model provider's API host" : "public") +
        ` · Verifier: ${bench.verifier}`,
    ];
    const command = [
      'export PYTHONPATH="$PWD/agents"',
      `uvx --from harbor==${HARBOR_VERSION} harbor run -p ${taskPath(bench)} -i ${item.task} \\`,
      `  -a ${HARBOR_AGENT} -m <provider>/<model_id> \\`,
      "  --ak thinking=<level> --ak penguin_version=<penguin version> \\",
      `  --ak run_timeout=${bench.runTimeout} --ak max_turns=${bench.maxTurns} \\`,
      ...(bench.timeBudgetNote !== undefined
        ? [`  --ak time_budget_note=${shellWord(bench.timeBudgetNote)} \\`]
        : []),
      ...(offline ? ["  --allow-agent-host <model provider API host> \\"] : []),
      ...(bench.sharedNetwork
        ? ["  --extra-docker-compose tools/docker/shared-network.yaml \\"]
        : []),
      "  --agent-setup-timeout-multiplier 2.5 -k 1 -n 1 --job-name <job name> -o <jobs dir> -y",
    ];
    return [
      `# ${item.title}`,
      "",
      item.summary,
      "",
      ...facts,
      "",
      "## How this case is run",
      "",
      "This case does not run in a Workspace. It is a Harbor task: the evaluator runs it in Docker " +
        `with Harbor ${HARBOR_VERSION} and the PenguinHarness adapter from the repository above, ` +
        `following that repository's rules for agents — ${repoLink(bench, "blob", BENCHMARK_RUN_RULES)} — ` +
        `from the root of a checkout at commit \`${bench.ref}\`:`,
      "",
      "```bash",
      ...command,
      "```",
      "",
      `Caps: the agent is stopped at ${bench.runTimeout} and after ${bench.maxTurns} turns. Run at ` +
        "most four trials at a time on one machine. Prerequisites on the evaluating machine: Docker " +
        `with Compose v2; uv; network access to ${bench.downloads}, nodejs.org, the npm registry and ` +
        "the model provider; the model under test configured in this machine's PenguinHarness with " +
        "its API key saved (the adapter copies that one entry into the container, outside the " +
        "trial's log directory)." +
        (bench.note !== undefined ? ` ${bench.note}` : ""),
      "",
      "The score is the verifier's reward × 100: " +
        (bench.grader?.scale ??
          "a pass (1) scores 100, a fail (0) scores 0, and a fractional reward r scores 100·r") +
        ". An evaluation from the Evaluation Center keeps every trial under this Benchmark's " +
        "`.jobs/` directory and records its Session id as `harbor:<trial name>`.",
      "",
      ...(bench.results !== undefined
        ? [
            `Measured results of PenguinHarness on these tasks: ${repoLink(bench, "blob", bench.results)}`,
            "",
          ]
        : []),
    ].join("\n");
  };
  const builtinRubric = (bench: BuiltinBenchmark) =>
    `# Scoring rubric (max 100 points)\n\n- 100 pts: the Harbor verifier's reward for this trial (\`/logs/verifier/reward.txt\` or the \`reward\` key of \`reward.json\`) multiplied by 100. The task's own ${bench.grader !== undefined ? "grader decides" : "tests decide"}; there is no manual judging and no partial credit beyond what the verifier itself reports.\n`;

  /**
   * The one built-in Benchmark the docs Agent has been through: one Harbor trial per case, the
   * verifier passing three of them. A run's Session id names its trial (`harbor:<trial>`).
   */
  const harborBaseline = (bench: BuiltinBenchmark): BenchmarkEvaluation => {
    const rnd = seeded(4040);
    const cases = bench.cases.map((item, i) => {
      const score = i === 0 || i === 3 || i === 7 ? 100 : 0;
      const trial = `${item.task.slice(0, 22)}__${Math.floor(rnd() * 36 ** 7)
        .toString(36)
        .padStart(7, "0")}`;
      return caseRecord(
        builtinCaseId(i + 1, item.task),
        score,
        Math.round((0.04 + rnd() * 0.06) * 10_000) / 10_000,
        420_000 + Math.round(rnd() * 600_000),
        `harbor:${trial}`,
      );
    });
    return {
      time: iso(ago(1)),
      agentId: IDS.agents.docs,
      summaryTitle: L("首个 Harbor 基线", "First Harbor baseline"),
      summary: L(
        "每题一次 Harbor trial；分数即验证器的 reward × 100。",
        "One Harbor trial per case; each score is the verifier's reward × 100.",
      ),
      modelId: "deepseek-flash",
      provider: "deepseek",
      thinkingLevel: "max",
      version: RSI_ROUND.reference,
      score: Math.round(mean(cases.map((c) => c.score)) * 100) / 100,
      ...totals(cases),
      cases,
    };
  };

  const benchmarks: BenchmarkSummary[] = [
    {
      id: IDS.benchmarks.docs,
      title: L("文档问答 v1", "Docs QA v1"),
      description: L(
        "四个关于 Claude Code 文档的问题，按引用是否真实、答案是否完整计分。",
        "Four questions about the Claude Code docs, scored on real citations and completeness.",
      ),
      runs: 1,
      status: "published",
      version: "2026.10.08.2",
      origin: { kind: "agent" },
      caseCount: RSI_ROUND.cases.length,
      evaluations: docsEvaluations,
      agentIds: [IDS.agents.docs],
    },
    {
      id: IDS.benchmarks.draft,
      title: L("发布说明草稿", "Release notes draft"),
      status: "draft",
      version: "2026.10.09.1",
      origin: { kind: "agent" },
      caseCount: 2,
      evaluations: [],
      agentIds: [],
    },
    // Built in, as a new Project gets them: English titles in either locale, like the product's.
    ...BUILTIN_BENCHMARKS.map((bench): BenchmarkSummary => ({
      id: bench.id,
      title: bench.title,
      description: bench.description,
      descriptionZh: bench.descriptionZh,
      runs: 1,
      status: "published",
      version: bench.version,
      origin: { kind: "builtin" },
      caseCount: bench.cases.length,
      evaluations: bench.id === IDS.benchmarks.builtin ? [harborBaseline(bench)] : [],
      agentIds: bench.id === IDS.benchmarks.builtin ? [IDS.agents.docs] : [],
    })),
  ];
  const benchmarkCases: Record<string, BenchmarkCaseSummary[]> = {
    [IDS.benchmarks.docs]: RSI_ROUND.cases.map((c, i) => ({
      id: c.id,
      title: rsiTestTitle(lang, i),
    })),
    [IDS.benchmarks.draft]: [
      { id: "CASE-001-lead", title: L("写一段导语", "Write a lead paragraph") },
      { id: "CASE-002-breaking", title: L("列出破坏性变更", "List the breaking changes") },
    ],
  };
  for (const bench of BUILTIN_BENCHMARKS) {
    benchmarkCases[bench.id] = bench.cases.map((item, i) => ({
      id: builtinCaseId(i + 1, item.task),
      title: item.title,
    }));
  }
  const caseFiles: DemoFixtures["caseFiles"] = {};
  for (const id of [IDS.benchmarks.docs, IDS.benchmarks.draft]) {
    for (const item of benchmarkCases[id]!) {
      caseFiles[`${id}/${item.id}`] = {
        statement: {
          "README.md": `# ${item.title}\n\n${L("回答这个问题，并引用语料库里的文件。", "Answer the question, citing corpus files.")}\n`,
          "input/question.txt": `${item.title}\n`,
        },
        rubric: {
          "README.md": `# Rubric\n\n- ${L("引用真实文件", "Cites a real file")} — 50\n- ${L("答案完整", "Complete answer")} — 30\n- ${L("简洁", "Concise")} — 20\n`,
        },
      };
    }
  }
  // A Harbor case is text only: what the task is, where its folder is, and how it is launched.
  for (const bench of BUILTIN_BENCHMARKS) {
    bench.cases.forEach((item, i) => {
      caseFiles[`${bench.id}/${builtinCaseId(i + 1, item.task)}`] = {
        statement: { "README.md": builtinStatement(bench, item) },
        rubric: { "README.md": builtinRubric(bench) },
      };
    });
  }

  const machines: MachinesResponse = {
    machines: [
      {
        id: IDS.machine,
        alias: "local",
        installed: { version: "0.2.13", at: iso(ago(19)) },
        machineId: "demo-machine-0001",
        local: true,
        connection: null,
        socket: null,
        api: null,
        status: { state: "running", checkedAt: iso(ago(0, 1)), port: 7364 },
        root: "/home/demo/.penguin/data",
      },
      {
        id: "ssh:gpu-box",
        alias: "gpu-box",
        installed: { version: "0.2.13", at: iso(ago(5)) },
        machineId: "gpu-box-a8f3c2",
        local: false,
        connection: { pid: 41_226 },
        socket: null,
        api: { answeredAt: iso(ago(0, 3)) },
        status: { state: "running", checkedAt: iso(ago(0, 3)), port: 7364 },
        root: "/home/ubuntu/.penguin/data",
        // The last sync could not carry a key this server reads from its environment, and the
        // machine would not take one hand-added model: the dialog's two notices.
        configSync: {
          at: iso(ago(0, 3)),
          ok: true,
          envOnly: [
            {
              projectId: IDS.project,
              provider: "openai",
              modelId: "gpt-5.6-luna",
              variable: "OPENAI_API_KEY",
            },
          ],
          skipped: [
            {
              projectId: IDS.project,
              provider: "penguin-go",
              modelId: "gemini-3.7-flash",
              code: "model_not_addable",
              reason: "cannot be added",
            },
            // A built-in model here that the machine's older build does not list yet.
            {
              projectId: IDS.project,
              provider: "minimax",
              modelId: "MiniMax-M3.1-Flash",
              code: "model_not_addable",
              reason: "cannot be added",
              builtInHere: true,
            },
          ],
        },
      },
      {
        id: "ssh:office-mac",
        alias: "office-mac",
        installed: null,
        machineId: null,
        local: false,
        connection: null,
        socket: null,
        api: null,
        status: null,
        root: "~/.penguin/data",
      },
    ],
    imageVersion: "0.2.13",
    job: null,
    jobs: [],
  };

  const version: VersionResponse = {
    version: "0.2.13",
    describe: "v0.2.13",
    channel: "release",
    buildDate: "2026-09-10",
    commit: "34f17ad35a2d4c1f9e8b7d6c5a4b3c2d1e0f9a8b",
    branch: null,
    dirty: null,
    runtime: { node: "24.8.0", platform: "linux", arch: "x64" },
    harness: null,
  };
  const update: UpdateCheckResponse = {
    currentVersion: "0.2.13",
    buildDate: "2026-09-10",
    latestVersion: "0.2.13",
    updateAvailable: false,
    releaseUrl: "https://github.com/prismshadow/penguin-harness/releases/tag/v0.2.13",
    publishedAt: iso(ago(19)),
    checkedAt: iso(ago(0, 12)),
  };

  const memoryFile = (
    scopeKey: string,
    name: string,
    title: string,
    description: string,
    content: string,
    days: number,
  ): MemoryFileResponse => ({
    scopeKey,
    file: {
      name,
      title,
      description,
      updatedAt: dayKey(ago(days)),
      size: content.length,
      modifiedAt: iso(ago(days)),
    },
    content,
  });
  const workspaceScope = "docs-expert-4f2a9c";
  const memory: DemoFixtures["memory"] = {
    [IDS.agents.docs]: {
      overview: {
        enabled: true,
        templateHasMemory: true,
        memoryDir: `/home/demo/.penguin/data/projects/${IDS.project}/agents/${IDS.agents.docs}/agent_state/memory`,
        scopes: [
          { scopeKey: "user", kind: "user", fileCount: 3, hasIndex: true, updatedAt: iso(ago(1)) },
          {
            scopeKey: workspaceScope,
            kind: "workspace",
            workspacePath: IDS.workspace,
            fileCount: 1,
            hasIndex: true,
            updatedAt: iso(ago(2)),
          },
        ],
      },
      files: [
        memoryFile(
          "user",
          "prefers-pnpm.md",
          L("偏好 pnpm", "Prefers pnpm"),
          L("包管理器一律用 pnpm。", "Always use pnpm as the package manager."),
          `---\nname: ${L("偏好 pnpm", "Prefers pnpm")}\nupdated_at: ${dayKey(ago(1))}\n---\n\n${L("用户在每个仓库里都用 pnpm；不要建议 npm 或 yarn。", "The user runs pnpm in every repository; never suggest npm or yarn.")}\n`,
          1,
        ),
        memoryFile(
          "user",
          "citation-style.md",
          L("引用格式", "Citation style"),
          L("引用写成 [n] path。", "Cite as [n] path."),
          `---\nname: ${L("引用格式", "Citation style")}\nupdated_at: ${dayKey(ago(4))}\n---\n\n${L("引用编号放在句末，文件路径列在答案末尾。", "Number citations at the end of the sentence and list paths at the end of the answer.")}\n`,
          4,
        ),
        memoryFile(
          "user",
          "timezone.md",
          L("时区", "Timezone"),
          L("用户在 UTC+8。", "The user is in UTC+8."),
          `---\nname: ${L("时区", "Timezone")}\nupdated_at: ${dayKey(ago(9))}\n---\n\n${L("时间一律按 UTC+8 显示。", "Show times in UTC+8.")}\n`,
          9,
        ),
        memoryFile(
          workspaceScope,
          "corpus-layout.md",
          L("语料库结构", "Corpus layout"),
          L("corpus/ 下按上游仓库分目录。", "corpus/ is split by upstream repository."),
          `---\nname: ${L("语料库结构", "Corpus layout")}\nupdated_at: ${dayKey(ago(2))}\n---\n\ncorpus/claude-code-docs/ · corpus/penguin-docs/\n`,
          2,
        ),
      ],
    },
    [IDS.agents.notes]: {
      overview: {
        enabled: true,
        templateHasMemory: false,
        memoryDir: `/home/demo/.penguin/data/projects/${IDS.project}/agents/${IDS.agents.notes}/agent_state/memory`,
        scopes: [{ scopeKey: "user", kind: "user", fileCount: 0, hasIndex: false }],
      },
      files: [],
    },
    [IDS.agents.general]: {
      overview: {
        enabled: true,
        templateHasMemory: true,
        memoryDir: `/home/demo/.penguin/data/projects/${IDS.project}/agents/${IDS.agents.general}/agent_state/memory`,
        scopes: [{ scopeKey: "user", kind: "user", fileCount: 0, hasIndex: false }],
      },
      files: [],
    },
  };

  const vault: DemoFixtures["vault"] = {
    [IDS.agents.docs]: {
      entries: [
        { key: "GITHUB_TOKEN", valueMasked: "ghp_…9x2Q" },
        { key: "DOCS_UPSTREAM", valueMasked: "http…docs" },
      ],
    },
    [IDS.agents.notes]: { entries: [] },
    [IDS.agents.general]: { entries: [] },
  };

  // The docs Agent answers programs: one key in daily use, one minted and never used.
  const agentApi: DemoFixtures["agentApi"] = {
    [IDS.agents.docs]: {
      enabled: true,
      open: false,
      approvalMode: "allow-all",
      model: null,
      thinkingLevel: null,
      maxConcurrentRuns: 4,
      workspace: null,
      keys: [
        {
          keyId: "kq3VtX9cRb2LmN0a",
          name: L("文档站检索", "docs-site search"),
          prefix: "penguin_Zr8kQ2vT",
          createdBy: user.userId,
          createdAt: iso(ago(21)),
          lastUsedAt: iso(ago(0, 12)),
        },
        {
          keyId: "Hc7pW2sYd4EfJ6uB",
          name: L("每周报告脚本", "weekly report script"),
          prefix: "penguin_4mGxL7pA",
          createdBy: user.userId,
          createdAt: iso(ago(2)),
          lastUsedAt: null,
        },
      ],
    },
  };

  const file = (name: string, sizeBytes: number, days: number): WorkspaceFileEntry => ({
    name,
    kind: "file",
    sizeBytes,
    mtime: iso(ago(days)),
  });
  const dir = (name: string, days: number): WorkspaceFileEntry => ({
    name,
    kind: "dir",
    sizeBytes: 0,
    mtime: iso(ago(days)),
  });
  const ragSource = `import fs from "node:fs";\nimport { bm25 } from "./bm25";\n\nexport function buildIndex(root: string) {\n  const files = walk(root)\n    .filter((f) => f.endsWith(".md"))\n    .filter((f) => fs.existsSync(f)); // a citation must open a real file\n  return bm25(files.map((f) => ({ source: f, text: fs.readFileSync(f, "utf8") })));\n}\n`;
  const workspace: DemoFixtures["workspace"] = {
    entries: {
      "": [
        dir("corpus", 1),
        dir("scripts", 3),
        dir("src", 0),
        dir("test", 0),
        file("CHANGELOG.md", 48_213, 1),
        file("README.md", 2_140, 12),
        file("package.json", 612, 12),
      ],
      corpus: [dir("claude-code-docs", 1), dir("penguin-docs", 1)],
      "corpus/claude-code-docs": [
        file("hooks.md", 9_812, 1),
        file("mcp.md", 7_420, 1),
        file("memory.md", 5_118, 1),
      ],
      "corpus/penguin-docs": [file("server-api.md", 31_004, 1), file("amsp-records.md", 22_870, 1)],
      scripts: [file("check-links.mjs", 1_984, 3)],
      src: [file("bm25.ts", 3_102, 5), file("rag.ts", 1_410, 0)],
      test: [file("rag.test.ts", 2_206, 0)],
    },
    content: {
      "README.md": `# Docs Expert\n\n${L("一个引用来源的文档问答智能体。", "A docs question-answering Agent that cites its sources.")}\n\n- \`pnpm install\`\n- \`pnpm test\`\n`,
      "package.json":
        '{\n  "name": "docs-expert",\n  "private": true,\n  "scripts": { "test": "vitest run" }\n}\n',
      "CHANGELOG.md":
        "# Changelog\n\n## Unreleased\n\n- Filter the corpus walk on file existence.\n",
      "src/rag.ts": ragSource,
      "src/bm25.ts":
        "export function bm25(docs: { source: string; text: string }[]) {\n  // Okapi BM25, k1 = 1.2, b = 0.75\n  return { query: (q: string) => rank(docs, q) };\n}\n",
      "test/rag.test.ts":
        'import { expect, it } from "vitest";\nimport { buildIndex, rank } from "../src/rag";\n\nit("never cites a file that does not exist", () => {\n  const index = buildIndex("corpus");\n  for (const hit of rank("hooks", index)) expect(hit.source).toMatch(/\\.md$/);\n});\n',
      "scripts/check-links.mjs":
        "#!/usr/bin/env node\n// Walks every .md under corpus/, extracts links, HEADs each URL with a 10s timeout.\n",
      "corpus/claude-code-docs/hooks.md": `# Hooks\n\n${L("hooks 在 Agent State 的 hooks.json 里配置，每个钩子点一条。", "Hooks are configured in hooks.json under the Agent State, one entry per hook point.")}\n`,
      "corpus/claude-code-docs/mcp.md":
        "# MCP servers\n\nAn MCP server is declared under `tools.mcpServers` in system_config.yaml.\n",
      "corpus/claude-code-docs/memory.md":
        "# Memory\n\nMemory files are Markdown with a frontmatter name and description.\n",
      "corpus/penguin-docs/server-api.md": "# Server API\n\nEvery route is listed here.\n",
      "corpus/penguin-docs/amsp-records.md": "# AMSP Records\n\nThe message format.\n",
    },
  };

  const chatDefaults: ChatDefaultsDto = {
    agentId: IDS.agents.docs,
    workspace: IDS.workspace,
    approvalMode: "allow-all",
    thinkingLevel: "medium",
    sandbox,
  };
  const rules: CommandPolicyDto["rules"] = [
    {
      name: "no-rm-root",
      pattern: "^rm\\s+-rf\\s+/(\\s|$)",
      description: L("删除根目录", "Deleting the root directory"),
      enabled: true,
    },
    {
      name: "no-force-push",
      pattern: "git\\s+push\\s+.*--force",
      description: L("强制推送", "Force pushing"),
      enabled: true,
    },
    {
      name: "no-curl-pipe-sh",
      pattern: "curl\\s.*\\|\\s*(ba)?sh",
      description: L("管道执行远程脚本", "Piping a download into a shell"),
      enabled: false,
    },
  ];
  const commandPolicy: CommandPolicyDto = {
    enabled: true,
    rules,
    defaultRules: rules.map((r) => ({ ...r, enabled: true })),
  };

  const pluginConfig: PluginConfigEntry[] = [
    {
      name: "sandbox",
      configuration: {
        title: "Agent Sandbox",
        titleZh: "Agent 运行沙箱",
        description: "How agent commands are confined on this machine.",
        descriptionZh: "这台机器上智能体命令的隔离方式。",
        properties: {
          backend: {
            type: "enum",
            title: "Backend",
            titleZh: "后端",
            default: "bwrap",
            options: [
              { value: "bwrap", title: "bubblewrap" },
              { value: "seatbelt", title: "Seatbelt" },
              { value: "none", title: "None", titleZh: "不隔离" },
            ],
          },
          network: {
            type: "enum",
            title: "Network",
            titleZh: "网络",
            default: "open",
            options: [
              { value: "open", title: "Open", titleZh: "开放" },
              { value: "local", title: "Local only", titleZh: "仅本机" },
              { value: "none", title: "None", titleZh: "无" },
            ],
          },
          allowPaths: {
            type: "list",
            title: "Writable paths",
            titleZh: "可写路径",
            description: "Paths outside the Workspace the sandbox may write.",
            descriptionZh: "工作区之外允许写入的路径。",
            maxItems: 20,
          },
        },
      },
      values: { backend: "bwrap", network: "open", allowPaths: ["/tmp"] },
      unavailable: [
        { field: "backend", value: "seatbelt", reason: "macOS only", reasonZh: "仅 macOS" },
      ],
      actions: [
        {
          id: "verify",
          title: "Verify",
          titleZh: "验证",
          description: "Run a command through the sandbox and report what it could reach.",
          descriptionZh: "在沙箱里跑一条命令，报告它能触及什么。",
        },
      ],
    },
  ];
  const probeTargets: ProxyProbeTargetsResponse = {
    targets: [
      { provider: "openai", url: "https://api.openai.com/v1/models" },
      { provider: "anthropic", url: "https://api.anthropic.com/v1/models" },
      { provider: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/models" },
      { provider: "deepseek", url: "https://api.deepseek.com/models" },
      { provider: "zai", url: "https://api.z.ai/api/paas/v4/models" },
      { provider: "bigmodel", url: "https://open.bigmodel.cn/api/paas/v4/models" },
    ],
  };

  const dirs: Record<string, DirListResponse> = {
    "/home/demo": {
      path: "/home/demo",
      parent: "/home",
      entries: [
        { name: ".penguin", path: "/home/demo/.penguin" },
        { name: "projects", path: "/home/demo/projects" },
      ],
    },
    "/home/demo/projects": {
      path: "/home/demo/projects",
      parent: "/home/demo",
      entries: [
        { name: "docs-expert", path: IDS.workspace },
        { name: "release-notes", path: "/home/demo/projects/release-notes" },
      ],
    },
    [IDS.workspace]: {
      path: IDS.workspace,
      parent: "/home/demo/projects",
      entries: [
        { name: "corpus", path: `${IDS.workspace}/corpus` },
        { name: "src", path: `${IDS.workspace}/src` },
      ],
    },
    "/home": { path: "/home", parent: "/", entries: [{ name: "demo", path: "/home/demo" }] },
    "/mnt/data": {
      path: "/mnt/data",
      parent: "/mnt",
      entries: [{ name: "datasets", path: "/mnt/data/datasets" }],
    },
    "/": { path: "/", parent: null, entries: [{ name: "home", path: "/home" }] },
  };

  const context: SessionContextResponse = {
    systemPrompt: 2_140,
    toolDefs: 1_860,
    userMessages: 320,
    assistantMessages: 4_210,
    toolRequests: 610,
    toolResults: 3_260,
    total: 12_400,
    topTools: [
      { name: "read_file", tokens: 2_100 },
      { name: "exec_command", tokens: 1_180 },
      { name: "edit_file", tokens: 590 },
    ],
    topFiles: [
      { path: "src/rag.ts", tokens: 1_640, ops: { read: 1, edit: 1, write: 0 } },
      { path: "test/rag.test.ts", tokens: 460, ops: { read: 1, edit: 0, write: 0 } },
    ],
    contextClosed: false,
    compactionThreshold: 800_000,
  };

  // Thirty days of usage: the docs Agent most days on the default model, the notes Agent on
  // a few, and a couple of days on the Anthropic model — enough to draw every chart.
  const rnd = seeded(2026);
  const usage: UsageDay[] = [];
  for (let day = 29; day >= 0; day -= 1) {
    const date = dayKey(ago(day));
    const busy = day % 7 !== 0 && day % 7 !== 6;
    const scale = busy ? 1 : 0.25;
    const docsRequests = Math.round((6 + rnd() * 14) * scale);
    usage.push({
      date,
      agentId: IDS.agents.docs,
      sessionId: day === 0 ? IDS.sessions.done : IDS.sessions.older[day % 4]!,
      provider: DEFAULT_MODEL.provider,
      modelId: DEFAULT_MODEL.modelId,
      cacheRead: Math.round(docsRequests * (18_000 + rnd() * 9_000)),
      cacheWrite: Math.round(docsRequests * (2_000 + rnd() * 1_500)),
      output: Math.round(docsRequests * (900 + rnd() * 700)),
      requests: docsRequests,
      completed: docsRequests - (rnd() < 0.15 ? 1 : 0),
      aborted: rnd() < 0.1 ? 1 : 0,
    });
    if (day % 3 === 0) {
      const notesRequests = Math.round((2 + rnd() * 5) * scale);
      usage.push({
        date,
        agentId: IDS.agents.notes,
        sessionId: IDS.sessions.notes[day % 2]!,
        provider: "anthropic",
        modelId: "claude-sonnet-5",
        cacheRead: Math.round(notesRequests * (12_000 + rnd() * 6_000)),
        cacheWrite: Math.round(notesRequests * (1_500 + rnd() * 900)),
        output: Math.round(notesRequests * (1_400 + rnd() * 900)),
        requests: notesRequests,
        completed: notesRequests,
        aborted: 0,
      });
    }
  }
  const usageErrors: UsageErrorItem[] = [
    {
      ts: iso(ago(0, 95)),
      firstTs: iso(ago(0, 180)),
      count: 4,
      source: "llm",
      code: "rate_limited",
      kind: "expected",
      message: "429 Too Many Requests from api.deepseek.com; retried after 8s.",
    },
    {
      ts: iso(ago(2, 40)),
      firstTs: iso(ago(2, 40)),
      count: 1,
      source: "http",
      code: "file_too_large",
      kind: "expected",
      message: "attachment exceeds the 100 MB limit (142 MB).",
    },
    {
      ts: iso(ago(5, 12)),
      firstTs: iso(ago(5, 12)),
      count: 1,
      source: "runtime",
      code: "internal",
      kind: "unexpected",
      message:
        "TypeError: cannot read properties of undefined (reading 'source') at rank (src/rag.ts:14).",
    },
  ];

  return {
    lang,
    now,
    user,
    users: [user, member],
    me: {
      previewIsolated: true,
      desktopMode: false,
      sessionVia: "password",
      uploadLimits: {
        attachmentMaxMb: 100,
        attachmentTotalMb: 120,
        attachmentMaxCount: 20,
        imageMaxMb: 20,
        attachmentLimitMinMb: 1,
        attachmentLimitMaxMb: 200,
      },
      companyMode: false,
    },
    prefs: {
      lastProjectId: IDS.project,
      credentialGuideSeen: true,
      initialPasswordBannerDismissed: true,
      workMode: "dev",
    },
    serverSettings: {
      proxyForApp: true,
      proxyForAgent: true,
      proxyUrl: null,
      attachmentMaxMb: 100,
      attachmentTotalMb: 120,
      companyMode: false,
      browserExtensionsEnabled: true,
      agentApiEnabled: true,
    },
    project,
    members: [
      { userId: user.userId, role: "owner", createdAt: project.createdAt },
      { userId: member.userId, role: "member", createdAt: iso(ago(30)) },
    ],
    agents,
    agentConfigs: {
      [IDS.agents.docs]: agentConfig(agents[0]!, true),
      [IDS.agents.notes]: agentConfig(agents[1]!, false),
      [IDS.agents.general]: agentConfig(agents[2]!, true),
    },
    models: modelsResponse,
    sessions,
    schedules,
    library,
    pluginFiles,
    installed,
    installedPlugins,
    pluginIndex,
    readmes,
    benchmarks,
    benchmarkCases,
    caseFiles,
    machines,
    version,
    update,
    memory,
    vault,
    agentApi,
    workspace,
    chatDefaults,
    commandPolicy,
    pluginConfig,
    probeTargets,
    dirs,
    context,
    usage,
    usageErrors,
  };
}

// ---------------------------------------------------------------------------------------------
// The API tab's Try it: one run's AMSP stream
// ---------------------------------------------------------------------------------------------

/** The Session the demo's Try it runs open. */
export const TRY_SESSION_ID = "session-2026-10-09-09-30-00-7d2e41c8";

/** `date`'s own format, in UTC: `Fri Oct  9 09:30:00 UTC 2026`. */
function dateOutput(ms: number): string {
  const d = new Date(ms);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const month = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
  const date = String(d.getUTCDate()).padStart(2, " ");
  const time = d.toISOString().slice(11, 19);
  return `${day} ${month} ${date} ${time} UTC ${d.getUTCFullYear()}`;
}

/**
 * The body the try route streams, as AMSP frames: a `ping`, the run's records with their ids, then
 * `[DONE]`. A new Session's first message: its session_meta, which names it, the Task, the example
 * question answered by running `date` over two Requests — the tool call's fragments and the
 * complete call, its decision and output, then the answer's fragments and the complete answer, so
 * the rendered view has fragments to merge; a run that continues a Session gets one answer in one
 * Request.
 */
export function amspTryStream(body: unknown, run: { lang: Lang; now: number }): string {
  const { lang, now } = run;
  const L = <T>(zh: T, en: T): T => (lang === "zh" ? zh : en);
  const sessionField = (body as { session_id?: unknown } | null)?.session_id;
  const inputField = (body as { input?: unknown } | null)?.input;
  const question = typeof inputField === "string" ? inputField : "";
  const sessionId = typeof sessionField === "string" ? sessionField : TRY_SESSION_ID;
  let clock = now;
  const at = (stepMs: number) => new Date((clock += stepMs)).toISOString();
  const usage = (output: number, total: number, cacheRead: number) => ({
    cache_read: cacheRead,
    cache_write: 0,
    output,
    total,
  });
  const ev = (stepMs: number, payload: object): AmspRecord =>
    ({ timestamp: at(stepMs), type: "event_msg", payload }) as AmspRecord;
  const msg = (stepMs: number, payload: object): AmspRecord =>
    ({ timestamp: at(stepMs), type: "model_msg", payload }) as AmspRecord;
  const userInput = msg(10, {
    type: "text",
    role: "user",
    text: question,
  });
  let records: AmspRecord[];
  if (typeof sessionField === "string") {
    const answer = usage(38, 3120, 2944);
    const text = L(
      "演示数据只回答第一个问题；真实的 Agent 会在这里接着同一个会话作答。",
      "The demo answers only the first question; a real agent would carry on this conversation here.",
    );
    records = [
      ev(0, { type: "task_begin" }),
      userInput,
      ev(120, { type: "request_begin", thinking_level: "medium" }),
      msg(1400, { type: "text", role: "assistant", text }),
      ev(10, { type: "token_usage", session: usage(124, 5848, 5184), request: answer }),
      ev(10, { type: "request_end", status: "completed" }),
      ev(10, { type: "task_end" }),
    ];
  } else {
    const call = usage(31, 1376, 1152);
    const answer = usage(55, 1352, 1088);
    const clockText = dateOutput(now + 1900);
    const answerText = L(
      `现在是 ${clockText.slice(11, 16)}（UTC），${new Date(now).getUTCFullYear()} 年 ${new Date(now).getUTCMonth() + 1} 月 ${new Date(now).getUTCDate()} 日。`,
      `It is ${clockText.slice(11, 16)} UTC on ${clockText.slice(0, 10)}, ${new Date(now).getUTCFullYear()}.`,
    );
    // The answer as a model streams it: three fragments, then the complete text.
    const third = Math.ceil(answerText.length / 3);
    const fragments = [0, 1, 2].map((i) => answerText.slice(i * third, (i + 1) * third));
    const id = "toolu_try_date";
    records = [
      {
        timestamp: at(0),
        type: "session_meta",
        payload: {
          session_id: sessionId,
          provider: "anthropic",
          model_id: "claude-sonnet-5",
          model_context_window: 200000,
          system_prompt: "",
          agent_state: "",
          workspace: "",
          source: "api",
        },
      } as AmspRecord,
      ev(10, { type: "task_begin" }),
      userInput,
      ev(20, {
        type: "tool_list_ready",
        tools: ["exec_command", "read_file", "write_file", "edit_file", "web_fetch"].map(
          (name) => ({ name, description: "" }),
        ),
      }),
      ev(40, { type: "request_begin", thinking_level: "medium" }),
      msg(1200, {
        type: "partial_tool_call",
        event_type: "start",
        name: "exec_command",
        arguments: "",
        tool_call_id: id,
      }),
      msg(100, {
        type: "partial_tool_call",
        event_type: "delta",
        name: "",
        arguments: '{"cmd": ',
        tool_call_id: id,
      }),
      msg(200, {
        type: "partial_tool_call",
        event_type: "delta",
        name: "",
        arguments: '"date"}',
        tool_call_id: id,
      }),
      msg(10, {
        type: "partial_tool_call",
        event_type: "stop",
        name: "",
        arguments: "",
        tool_call_id: id,
      }),
      msg(10, {
        type: "tool_call",
        name: "exec_command",
        arguments: '{"cmd":"date"}',
        tool_call_id: id,
      }),
      ev(10, { type: "approval_decision", decision: "allow", tool_call_id: id }),
      ev(10, { type: "token_usage", session: call, request: call }),
      ev(10, { type: "request_end", status: "completed" }),
      msg(260, {
        type: "tool_call_output",
        output: `${clockText}\n`,
        tool_call_id: id,
        status: "completed",
      }),
      ev(30, { type: "request_begin", thinking_level: "medium" }),
      msg(10, { type: "partial_text", role: "assistant", event_type: "start", text: "" }),
      ...fragments.map((text) =>
        msg(400, { type: "partial_text", role: "assistant", event_type: "delta", text }),
      ),
      msg(10, { type: "partial_text", role: "assistant", event_type: "stop", text: "" }),
      msg(10, { type: "text", role: "assistant", text: answerText }),
      ev(10, { type: "token_usage", session: usage(86, 2728, 2240), request: answer }),
      ev(20, { type: "request_end", status: "completed" }),
      ev(10, { type: "task_end" }),
    ];
  }
  const frames = records.map((r, i) => `id: try-${i + 1}\ndata: ${JSON.stringify(r)}\n\n`);
  return ["event: ping\ndata: {}\n\n", ...frames, "data: [DONE]\n\n"].join("");
}
