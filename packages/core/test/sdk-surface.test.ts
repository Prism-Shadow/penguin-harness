/**
 * The SDK surface lock: the eight subpath exports this package declares and the public names
 * every one of them ships — the contract packages/server, packages/cli, packages/web,
 * packages/desktop, packages/hmr and this organization's own plugins import.
 *
 * Nothing else in the package asserts it: a module may drop or rename a public name and the
 * build stays green here, so every consumer discovers it in its own build. This file is where
 * that change has to be visible (and recorded) instead.
 *
 * The lock has two halves, because one of them cannot be seen from a test:
 *
 * - **Values** (consts, functions, classes) are asserted by the tests below: each subpath's
 *   module is imported and its runtime export names are compared with the recorded list.
 * - **Types** (interfaces, type aliases) are erased at runtime, so no test can reach them. They
 *   are recorded as the `import type` lists under "The type half" below: a dropped or renamed
 *   type fails `pnpm --filter @prismshadow/penguin-core typecheck`, whose tsconfig includes
 *   test/ — the compile-time half of the same lock.
 *
 * What this file deliberately does not see, named rather than asserted:
 *
 * - The built output itself. `dist/` is not built or imported here, so the test pins the
 *   declared dist paths, the source entry each one is built from (by existence) and the tsup
 *   entry list that emits them — not the emitted bundle. A tsup change that stops emitting one of
 *   these entries while leaving its config entry in place is caught at build time, not here.
 * - The value of the release stamps. `VERSION` / `BUILD_DATE` / `BUILD_COMMIT` are
 *   rewritten by the release workflow, so only their names and kinds are held; their content is
 *   not a surface fact.
 *
 * Adding, dropping or renaming a public name is allowed — it only has to be recorded here in the
 * same change. Each assertion prints the block to paste into this file when it fails, and the
 * records are sorted, so a diff in review reads as exactly the names that moved.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** One declared subpath: where it points in the build, the source it is built from, and the
 * names a consumer reaches through it. */
interface SubpathRecord {
  /** the key in package.json `exports`. */
  key: string;
  /** the value of that entry's `import` condition. */
  dist: string;
  /** the source file the dist entry is built from. */
  source: string;
  /** loads that source module — the same module the built entry is compiled from. */
  load: () => Promise<Record<string, unknown>>;
  /** every runtime export name of that module, sorted. */
  values: string[];
}

/**
 * The eight subpath exports of package.json, with the runtime names each one ships at revision
 * 9eebc91c (root 0.2.13).
 */
const SUBPATHS: SubpathRecord[] = [
  {
    key: ".",
    dist: "./dist/index.js",
    source: "src/index.ts",
    load: () => import("../src/index.js"),
    values: [
      "AGENTS_MD_PLACEHOLDER",
      "AGENT_ID_PLACEHOLDER",
      "APP_URL",
      "ATTACHED_FILE_PREFIX",
      "ATTACHED_IMAGE_PREFIX",
      "Agent",
      "BUILD_COMMIT",
      "BUILD_DATE",
      "BUILTIN_AGENT_IDS",
      "BUILTIN_TOOL_FACTORIES",
      "CHAT_APPROVAL_MODES",
      "COMPACTION_HEADROOM",
      "CWD_PLACEHOLDER",
      "CommandSessionManager",
      "ContextEngine",
      "DATE_PLACEHOLDER",
      "DEEPSEEK_OFF_PEAK",
      "DEFAULT_AGENT_ID",
      "DEFAULT_CHAT_THINKING_LEVELS",
      "DEFAULT_COMMAND_POLICY_RULES",
      "DEFAULT_COMPACTION_PROMPT",
      "DEFAULT_CONTEXT_WINDOW",
      "DEFAULT_DEV_SERVER_PORT",
      "DEFAULT_HOOK_TIMEOUT_S",
      "DEFAULT_MAX_CONTEXT_LENGTH",
      "DEFAULT_MCP_CONNECT_TIMEOUT_MS",
      "DEFAULT_MCP_PERMISSION",
      "DEFAULT_MEMORY_PROMPT",
      "DEFAULT_MEMORY_WORKSPACE_PROMPT",
      "DEFAULT_PROJECT_ID",
      "DEFAULT_SCHEDULES_PROMPT",
      "DEFAULT_SERVER_PORT",
      "DEFAULT_SKILLS_PROMPT",
      "DEFAULT_VAULT_PROMPT",
      "DETACHED_TOOL_NOTE_PREFIX",
      "EDIT_FILE_NAME",
      "EXAMPLE_BENCHMARK_ID",
      "EXEC_COMMAND_NAME",
      "Environment",
      "EventTranslator",
      "FAST_MODE_UNSUPPORTED_GUIDANCE",
      "GenerativeModel",
      "INPUT_COMMAND_NAME",
      "INPUT_SUBAGENT_NAME",
      "KERNEL_DEFAULT_TAB_HASHES",
      "KERNEL_SUPERSEDED_TAB_HASHES",
      "KERNEL_TABS",
      "KERNEL_TAB_KEYS",
      "KERNEL_VERSION",
      "LEGACY_SKILLS_SECTION",
      "LEGACY_VAULT_SECTION",
      "MARKER_TAGS",
      "MCP_TOOL_PREFIX",
      "MEMORY_INDEX_EMPTY_NOTE",
      "MEMORY_INDEX_FILENAME",
      "MEMORY_INDEX_MAX_CHARS",
      "MEMORY_INDEX_MAX_LINES",
      "MEMORY_PLACEHOLDER",
      "MIN_OUTPUT_TOKENS",
      "MODELSCOPE_PROVIDER_ID",
      "MODEL_CATALOG",
      "MODEL_ID_PLACEHOLDER",
      "MODEL_PROVIDERS",
      "ManagedSession",
      "ManagedSubagentSession",
      "McpToolProvider",
      "OS_VERSION_PLACEHOLDER",
      "OUTPUT_SAFETY_MARGIN",
      "PENGUIN_GO_BASE_URL",
      "PENGUIN_GO_PROVIDER_ID",
      "PLATFORM_PLACEHOLDER",
      "PLUGIN_CATEGORIES",
      "PLUGIN_MACHINE_ID",
      "PLUGIN_NAME_PATTERN",
      "PLUGIN_VERSION_PATTERN",
      "PROJECT_DIR_PLACEHOLDER",
      "PROVIDER_PLACEHOLDER",
      "PartialAggregator",
      "QWEN_OFF_PEAK",
      "READ_FILE_NAME",
      "SCHEDULES_PLACEHOLDER",
      "SCHEDULE_LIST_EMPTY_NOTE",
      "SCHEDULE_LIST_PLACEHOLDER",
      "SERVER_RESTART_EXIT_CODE",
      "SESSION_ID_PLACEHOLDER",
      "SHELL_PLACEHOLDER",
      "SKILLS_PLACEHOLDER",
      "SKILL_METADATA_PLACEHOLDER",
      "SUBAGENT_NAME",
      "SUBAGENT_THINKING_LEVELS",
      "Session",
      "SubagentSessionManager",
      "THINKING_LEVEL_NAMES",
      "TITLE_NOISE_TAGS",
      "TRANSCRIPT_TAGS",
      "ToolCallIdAllocator",
      "USER_MEMORY_INDEX_PLACEHOLDER",
      "USER_SCOPE_KEY",
      "VAULT_KEYS_PLACEHOLDER",
      "VAULT_PLACEHOLDER",
      "VAULT_VALUE_MAX_LENGTH",
      "VERSION",
      "WORKSPACE_MARKER_FILENAME",
      "WORKSPACE_MEMORY_DIR_PLACEHOLDER",
      "WORKSPACE_MEMORY_INDEX_PLACEHOLDER",
      "WRITE_FILE_NAME",
      "Writer",
      "abortEvent",
      "addModel",
      "addTokenCounts",
      "agentDir",
      "agentStateDir",
      "agentStateVersion",
      "agentVaultPath",
      "agentsDir",
      "agentsDirFrom",
      "agentsMdPath",
      "aggregateAll",
      "appendAttachmentLines",
      "applyKernelUpdate",
      "approvalDecision",
      "approximateMessagesTokens",
      "approximateTokens",
      "assembleSystemPrompt",
      "assertValidId",
      "assertValidVaultKey",
      "assertValidVaultValue",
      "assistantText",
      "atomicWriteFile",
      "attachedFileLine",
      "attachedImageLine",
      "attributionHeaders",
      "benchmarksDir",
      "buildBackgroundTaskDoneMessage",
      "buildContextSummaryText",
      "buildExampleScoreboard",
      "buildHandoffMessage",
      "buildInfo",
      "buildModelSwitchMessage",
      "buildOrgTriggerMessage",
      "buildScheduledMessage",
      "buildSkillsMessage",
      "buildToolConfig",
      "buildTurnAbortedBlock",
      "buildTurnRetriedBlock",
      "buildUniConfig",
      "builtinProjectAgentPresets",
      "canonicalClientType",
      "catalogEntryFor",
      "catalogModelEntries",
      "compactionBegin",
      "compactionEnd",
      "comparePluginVersions",
      "compareVersions",
      "computeKernelTabHashes",
      "createAgent",
      "createEditFileTool",
      "createExecCommandTool",
      "createInputCommandTool",
      "createInputSubagentTool",
      "createReadFileTool",
      "createSubagentTool",
      "createWriteFileTool",
      "defaultAgentsMd",
      "defaultProjectConfig",
      "defaultSystemConfig",
      "dualFormPatterns",
      "effectiveCommandPolicyRules",
      "effectiveMaxContextLength",
      "effectiveMaxOutputTokens",
      "effectivePluginTable",
      "effectivePricing",
      "emptyTokenCounts",
      "ensureUserMemoryDir",
      "ensureWorkspaceMemoryDir",
      "extractSummary",
      "fastModeProtocol",
      "findLatestTraceFile",
      "formatModelRef",
      "getModel",
      "groupHistoryToUniMessages",
      "groupPlugins",
      "hasMemoryPlaceholder",
      "hasSchedulesPlaceholder",
      "hasSkillsPlaceholder",
      "hasVaultPlaceholder",
      "hashKernelValue",
      "hookEvent",
      "hooksDir",
      "imageUrlMessage",
      "inlineData",
      "inlineThinking",
      "insertMemoryPlaceholder",
      "insertSchedulesPlaceholder",
      "insertSkillsPlaceholder",
      "insertVaultPlaceholder",
      "installHook",
      "installPlugin",
      "installSkill",
      "isAuthenticationError",
      "isCompleteModelMessage",
      "isEventMessage",
      "isFastModeUnsupportedError",
      "isFatalProviderRejection",
      "isHarnessInput",
      "isHookInput",
      "isIncompleteStreamError",
      "isKernelOutdated",
      "isMalformedJsonParseError",
      "isModelMessage",
      "isPartialPayload",
      "isSessionMeta",
      "isSteeredBackgroundNotice",
      "isSupersededTab",
      "isTemporaryWorkspace",
      "isValidId",
      "isValidVaultKey",
      "isWholeOriginBlock",
      "kernelTabHash",
      "latestSessionId",
      "libraryPlugin",
      "librarySkill",
      "listEndpointModels",
      "listInstalledHooks",
      "listInstalledSkills",
      "listScheduleNames",
      "loadAgentState",
      "loadAgentVault",
      "loadLibraryPlugins",
      "loadPluginGroups",
      "loadPreinstalledPlugins",
      "loadProjectConfig",
      "mapThinkingLevel",
      "markerBlock",
      "markerClose",
      "markerOpen",
      "matchAttachedFileLine",
      "matchAttachedImageLine",
      "matchDualForm",
      "mcpConnectBegin",
      "mcpConnectEnd",
      "mcpToolName",
      "memoryDir",
      "memoryScopeDir",
      "mergeOmniToUniMessage",
      "metaMaxTokens",
      "modelHomepageUrl",
      "modelVisiblePath",
      "normalizeVersion",
      "offPeakAt",
      "offPeakScheduledRefs",
      "parseBackgroundTaskDoneMessage",
      "parseCommandPolicy",
      "parseHandoffMessage",
      "parseMemoryFrontmatter",
      "parseModelSwitchMessage",
      "parseOrgTriggerMessage",
      "parsePluginTable",
      "parsePluginTables",
      "parsePluginVersion",
      "parsePreToolUseResult",
      "parseScheduledMessage",
      "parseSkillFrontmatter",
      "parseSkillsMessage",
      "parseStopHookResult",
      "parseTraceLines",
      "parseUserPromptResult",
      "parseUserSteeringText",
      "partialText",
      "partialThinking",
      "partialToolCall",
      "partialToolCallOutput",
      "pluginTableToToml",
      "pluginTablesToToml",
      "presetModelEntries",
      "presetPromotions",
      "projectConfigFromTable",
      "projectConfigPath",
      "projectDir",
      "providerClientType",
      "providerInfo",
      "provisionExampleBenchmark",
      "provisionProjectAgents",
      "readAgentsMd",
      "readScopeIndex",
      "readTrace",
      "readTraceTolerant",
      "readWorkspaceMarker",
      "reconnectDelayMs",
      "removeHook",
      "removeModel",
      "removeSkill",
      "removeVaultEntry",
      "renderProjectConfigToml",
      "replaceSkillDirectory",
      "requestBegin",
      "requestEnd",
      "resetSystemConfigToDefaults",
      "resolveContextWindow",
      "resolveMCPServer",
      "resolveMCPServers",
      "resolveModelEnv",
      "resolveModelRef",
      "resolveProviderModelEnv",
      "resolveRoot",
      "resolveSessionMemory",
      "resumeTrace",
      "runHookScript",
      "runPreToolUseHooks",
      "runStopHooks",
      "sanitizeTitle",
      "saveAgentVault",
      "saveProjectConfig",
      "scheduleDir",
      "scratchpadDir",
      "scriptPreToolUseHook",
      "scriptStopHook",
      "scriptUserPromptHook",
      "selectBuiltinToolsForModel",
      "sessionMeta",
      "sessionScratchpadDir",
      "setDefaultModel",
      "setVaultEntry",
      "setVisionModel",
      "skillMetadataSection",
      "skillsDir",
      "snapshotsDir",
      "startsWithMarker",
      "stripConversationMarkers",
      "stripLeadingMarkerBlocks",
      "stripMarkerBlocks",
      "stripToolCallIdSuffix",
      "subagentEvent",
      "systemConfigPath",
      "textMessage",
      "thinkingMessage",
      "tokenUsage",
      "toolCall",
      "toolCallOutput",
      "toolDefinitionsToSchemas",
      "toolListReady",
      "toolsDir",
      "tracesDir",
      "transcribeText",
      "transcribeThinking",
      "transcribeToolCall",
      "transcribeToolCallOutput",
      "transcribeUserInput",
      "translateEvents",
      "truncateTitle",
      "unwrapSyntheticBlock",
      "usageToTokenCounts",
      "userMemoryDir",
      "userSteeringText",
      "userText",
      "valueAtPath",
      "withOrigin",
      "workspaceMemoryKey",
      "workspaceMemoryKeyForRealPath",
      "workspacePluginRoot",
      "workspacesDir",
    ],
  },
  {
    key: "./omnimessage",
    dist: "./dist/omnimessage/index.js",
    source: "src/omnimessage/index.ts",
    load: () => import("../src/omnimessage/index.js"),
    values: [
      "ATTACHED_FILE_PREFIX",
      "ATTACHED_IMAGE_PREFIX",
      "MARKER_TAGS",
      "PartialAggregator",
      "TITLE_NOISE_TAGS",
      "TRANSCRIPT_TAGS",
      "abortEvent",
      "addTokenCounts",
      "aggregateAll",
      "approvalDecision",
      "assistantText",
      "attachedFileLine",
      "attachedImageLine",
      "buildBackgroundTaskDoneMessage",
      "buildContextSummaryText",
      "buildHandoffMessage",
      "buildModelSwitchMessage",
      "buildOrgTriggerMessage",
      "buildScheduledMessage",
      "buildSkillsMessage",
      "buildTurnAbortedBlock",
      "buildTurnRetriedBlock",
      "compactionBegin",
      "compactionEnd",
      "dualFormPatterns",
      "emptyTokenCounts",
      "extractSummary",
      "hookEvent",
      "imageUrlMessage",
      "inlineData",
      "inlineThinking",
      "isCompleteModelMessage",
      "isEventMessage",
      "isHarnessInput",
      "isHookInput",
      "isModelMessage",
      "isPartialPayload",
      "isSessionMeta",
      "isSteeredBackgroundNotice",
      "isWholeOriginBlock",
      "markerBlock",
      "markerClose",
      "markerOpen",
      "matchAttachedFileLine",
      "matchAttachedImageLine",
      "matchDualForm",
      "mcpConnectBegin",
      "mcpConnectEnd",
      "parseBackgroundTaskDoneMessage",
      "parseHandoffMessage",
      "parseModelSwitchMessage",
      "parseOrgTriggerMessage",
      "parseScheduledMessage",
      "parseSkillsMessage",
      "parseUserSteeringText",
      "partialText",
      "partialThinking",
      "partialToolCall",
      "partialToolCallOutput",
      "requestBegin",
      "requestEnd",
      "sessionMeta",
      "startsWithMarker",
      "stripConversationMarkers",
      "stripLeadingMarkerBlocks",
      "stripMarkerBlocks",
      "subagentEvent",
      "textMessage",
      "thinkingMessage",
      "tokenUsage",
      "toolCall",
      "toolCallOutput",
      "toolListReady",
      "transcribeText",
      "transcribeThinking",
      "transcribeToolCall",
      "transcribeToolCallOutput",
      "transcribeUserInput",
      "unwrapSyntheticBlock",
      "userSteeringText",
      "userText",
      "withOrigin",
    ],
  },
  {
    key: "./markers",
    dist: "./dist/omnimessage/markers/index.js",
    source: "src/omnimessage/markers/index.ts",
    load: () => import("../src/omnimessage/markers/index.js"),
    values: [
      "ATTACHED_FILE_PREFIX",
      "ATTACHED_IMAGE_PREFIX",
      "MARKER_TAGS",
      "TITLE_NOISE_TAGS",
      "TRANSCRIPT_TAGS",
      "attachedFileLine",
      "attachedImageLine",
      "buildBackgroundTaskDoneMessage",
      "buildContextSummaryText",
      "buildHandoffMessage",
      "buildModelSwitchMessage",
      "buildOrgTriggerMessage",
      "buildScheduledMessage",
      "buildSkillsMessage",
      "buildTurnAbortedBlock",
      "buildTurnRetriedBlock",
      "dualFormPatterns",
      "extractSummary",
      "isHookInput",
      "isSteeredBackgroundNotice",
      "isWholeOriginBlock",
      "markerBlock",
      "markerClose",
      "markerOpen",
      "matchAttachedFileLine",
      "matchAttachedImageLine",
      "matchDualForm",
      "parseBackgroundTaskDoneMessage",
      "parseHandoffMessage",
      "parseModelSwitchMessage",
      "parseOrgTriggerMessage",
      "parseScheduledMessage",
      "parseSkillsMessage",
      "parseUserSteeringText",
      "startsWithMarker",
      "stripConversationMarkers",
      "stripLeadingMarkerBlocks",
      "stripMarkerBlocks",
      "transcribeText",
      "transcribeThinking",
      "transcribeToolCall",
      "transcribeToolCallOutput",
      "transcribeUserInput",
      "unwrapSyntheticBlock",
      "userSteeringText",
    ],
  },
  {
    key: "./interfaces",
    dist: "./dist/interfaces/index.js",
    source: "src/interfaces/index.ts",
    load: () => import("../src/interfaces/index.js"),
    values: ["DETACHED_TOOL_NOTE_PREFIX", "SUBAGENT_THINKING_LEVELS", "THINKING_LEVEL_NAMES"],
  },
  {
    key: "./plugin",
    dist: "./dist/plugin/index.js",
    source: "src/plugin/index.ts",
    load: () => import("../src/plugin/index.js"),
    values: ["Bind", "Component", "Interface", "Module", "Provide", "Use"],
  },
  {
    key: "./context-limits",
    dist: "./dist/llm/context-limits.js",
    source: "src/llm/context-limits.ts",
    load: () => import("../src/llm/context-limits.js"),
    values: [
      "COMPACTION_HEADROOM",
      "DEFAULT_CONTEXT_WINDOW",
      "DEFAULT_MAX_CONTEXT_LENGTH",
      "MIN_OUTPUT_TOKENS",
      "MIN_USABLE_CONTEXT_WINDOW",
      "OUTPUT_SAFETY_MARGIN",
      "approximateMessagesTokens",
      "approximateTokens",
      "effectiveMaxContextLength",
      "effectiveMaxOutputTokens",
      "resolveContextWindow",
    ],
  },
  {
    key: "./model-catalog",
    dist: "./dist/state/model-catalog.js",
    source: "src/state/model-catalog.ts",
    load: () => import("../src/state/model-catalog.js"),
    values: [
      "APP_URL",
      "DEEPSEEK_OFF_PEAK",
      "MODELSCOPE_PROVIDER_ID",
      "MODEL_CATALOG",
      "MODEL_PROVIDERS",
      "PENGUIN_GO_BASE_URL",
      "PENGUIN_GO_PROVIDER_ID",
      "QWEN_OFF_PEAK",
      "attributionHeaders",
      "canonicalClientType",
      "catalogEntryFor",
      "catalogModelEntries",
      "effectivePricing",
      "fastModeProtocol",
      "modelHomepageUrl",
      "offPeakAt",
      "offPeakScheduledRefs",
      "presetModelEntries",
      "presetPromotions",
      "providerClientType",
      "providerInfo",
      "resolveModelEnv",
      "resolveProviderModelEnv",
    ],
  },
  {
    key: "./kernel",
    dist: "./dist/kernel/index.js",
    source: "src/kernel/index.ts",
    load: () => import("../src/kernel/index.js"),
    values: [
      "Bind",
      "BootError",
      "Component",
      "Interface",
      "Module",
      "ModuleBootError",
      "Provide",
      "Use",
      "assignable",
      "boot",
      "bootModules",
      "checkTree",
      "dataExtends",
      "defineIface",
      "defineModule",
      "describeProblem",
      "extendsExpr",
      "ifaceData",
      "ifaceKey",
      "initialDoc",
      "inlineRefs",
      "isJsonObject",
      "isKeyed",
      "keyed",
      "moduleDefOf",
      "moduleDefiner",
      "moduleMetaOf",
      "parseManifest",
      "satisfies",
      "schema",
      "show",
      "splitSlotKey",
      "tableOf",
      "type",
      "upgrade",
      "wire",
    ],
  },
];

/**
 * The `entry` list of tsup.config.ts, in source order: the build emits exactly one dist file per
 * declared subpath from exactly these sources.
 */
const TSUP_ENTRIES: string[] = [
  "src/index.ts",
  "src/omnimessage/index.ts",
  "src/omnimessage/markers/index.ts",
  "src/interfaces/index.ts",
  "src/plugin/index.ts",
  "src/state/model-catalog.ts",
  "src/llm/context-limits.ts",
  "src/kernel/index.ts",
];

/** One top-level export statement of src/index.ts, canonicalized so formatting is not surface. */
type StatementRecord =
  | { kind: "star"; from: string }
  | { kind: "type-star"; from: string }
  | { kind: "named"; from: string; names: string[] }
  | { kind: "type-named"; from: string; names: string[] }
  | { kind: "decl"; declaration: string };

/**
 * Every export statement of src/index.ts as it stands at 9eebc91c: 29 statements, of which 25
 * re-export from a module and 4 declare the release identity and buildInfo(). A statement that
 * adds, drops or renames a name changes its record; one that disappears changes the count.
 */
const BARREL_STATEMENTS: StatementRecord[] = [
  {
    kind: "star",
    from: "./omnimessage/index.js",
  },
  {
    kind: "star",
    from: "./interfaces/index.js",
  },
  {
    kind: "type-star",
    from: "./version-info.js",
  },
  {
    kind: "named",
    from: "./internal/ports.js",
    names: ["DEFAULT_DEV_SERVER_PORT", "DEFAULT_SERVER_PORT"],
  },
  {
    kind: "named",
    from: "./internal/server-lifecycle.js",
    names: ["SERVER_RESTART_EXIT_CODE"],
  },
  {
    kind: "star",
    from: "./state/index.js",
  },
  {
    kind: "star",
    from: "./llm/index.js",
  },
  {
    kind: "star",
    from: "./environment/index.js",
  },
  {
    kind: "star",
    from: "./trace/index.js",
  },
  {
    kind: "star",
    from: "./hooks/index.js",
  },
  {
    kind: "star",
    from: "./plugins/index.js",
  },
  {
    kind: "named",
    from: "./engine/context-engine.js",
    names: ["ContextEngine", "reconnectDelayMs"],
  },
  {
    kind: "type-named",
    from: "./engine/context-engine.js",
    names: [
      "CompactAvailability",
      "CompactionSettings",
      "ContextEngineDeps",
      "EngineInitialState",
      "OpenContextOptions",
      "OpenedContext",
      "RunOptions",
      "TraceSink",
    ],
  },
  {
    kind: "named",
    from: "./session.js",
    names: ["Session"],
  },
  {
    kind: "type-named",
    from: "./session.js",
    names: ["SessionConfig"],
  },
  {
    kind: "type-named",
    from: "./agent.js",
    names: ["AgentAssembly", "ModelRequestContext", "PromptSection"],
  },
  {
    kind: "named",
    from: "./internal/session-title.js",
    names: ["sanitizeTitle", "truncateTitle"],
  },
  {
    kind: "type-named",
    from: "./internal/session-title.js",
    names: ["SessionTitleResult"],
  },
  {
    kind: "named",
    from: "./internal/session-support.js",
    names: ["appendAttachmentLines"],
  },
  {
    kind: "named",
    from: "./internal/model-visible-path.js",
    names: ["modelVisiblePath"],
  },
  {
    kind: "named",
    from: "./internal/atomic-write.js",
    names: ["atomicWriteFile"],
  },
  {
    kind: "type-named",
    from: "./internal/atomic-write.js",
    names: ["AtomicWriteOptions"],
  },
  {
    kind: "named",
    from: "./agent.js",
    names: ["Agent", "createAgent", "metaMaxTokens"],
  },
  {
    kind: "type-named",
    from: "./agent.js",
    names: [
      "ControlEnvContext",
      "CreateAgentOptions",
      "CreateSessionOptions",
      "ResumeSessionOptions",
    ],
  },
  {
    kind: "decl",
    declaration: "export const VERSION",
  },
  {
    kind: "decl",
    declaration: "export const BUILD_DATE: string | null",
  },
  {
    kind: "decl",
    declaration: "export const BUILD_COMMIT: string | null",
  },
  {
    kind: "decl",
    declaration: "export function buildInfo(): BuildInfo",
  },
  {
    kind: "named",
    from: "./internal/version.js",
    names: ["compareVersions", "normalizeVersion"],
  },
];

/**
 * Reads a top-level `export` statement's text into its record. Whitespace and comments inside a
 * statement are not surface, a name or a module path is: the brace lists are compared as sorted
 * name sets, and a declaration keeps its head (its name and signature) but not a rewriteable
 * value (`VERSION = "0.2.13"` is stamped per release, so only the name is held).
 */
function parseBarrelStatements(source: string): StatementRecord[] {
  const lines = source.split("\n");
  const out: StatementRecord[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i]?.startsWith("export")) continue;
    let raw = (lines[i] ?? "").replace(/\/\/.*$/, "");
    const declaration = /^export (?:async )?(?:function|class)\b/.test(raw.trim());
    let j = i;
    while (j + 1 < lines.length) {
      const text = raw.trim();
      if (text.endsWith(";")) break;
      if (declaration && text.endsWith("{")) break;
      j += 1;
      raw += " " + (lines[j] ?? "").replace(/\/\/.*$/, "");
    }
    i = j;
    let statement = raw.replace(/\s+/g, " ").trim();
    if (statement.startsWith("export const ")) statement = statement.split("=")[0]!.trim();
    else if (declaration) statement = statement.slice(0, statement.indexOf("{")).trim();

    const star = /^export (type )?\* from "([^"]+)";$/.exec(statement);
    if (star) {
      out.push({ kind: star[1] ? "type-star" : "star", from: star[2]! });
      continue;
    }
    const named = /^export (type )?\{([^}]*)\} from "([^"]+)";$/.exec(statement);
    if (named) {
      const names = (named[2] ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => (name.includes(" as ") ? name.split(" as ").pop()!.trim() : name))
        .sort();
      out.push({ kind: named[1] ? "type-named" : "named", from: named[3]!, names });
      continue;
    }
    out.push({ kind: "decl", declaration: statement });
  }
  return out;
}

/** The block to paste into this file, so a failure carries its own fix. */
function recordBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

describe("the package's declared subpath exports", () => {
  it("declares exactly the recorded subpaths, each with a types and an import condition", async () => {
    const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8")) as {
      exports: Record<string, Record<string, string>>;
    };
    const declared = Object.keys(manifest.exports ?? {}).sort();
    expect(declared).toEqual(
      SUBPATHS.map((subpath) => subpath.key)
        .slice()
        .sort(),
    );
    for (const subpath of SUBPATHS) {
      const entry = manifest.exports[subpath.key]!;
      expect(entry.import, `the import condition of ${subpath.key}`).toBe(subpath.dist);
      expect(entry.types, `the types condition of ${subpath.key}`).toBe(
        subpath.dist.replace(/\.js$/, ".d.ts"),
      );
    }
  });

  it("builds each declared subpath from the recorded source entry, and the build emits them", async () => {
    // A subpath whose dist name cannot be mapped onto a source file is a broken declaration —
    // dist/omnimessage/index.js is built from src/omnimessage/index.ts, and only the spelling of
    // the directory changes.
    const sources: string[] = [];
    for (const subpath of SUBPATHS) {
      const source = path.join(packageDir, subpath.source);
      expect(subpath.dist.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts")).toBe(
        subpath.source,
      );
      await expect(readFile(source, "utf8")).resolves.toContain("export");
      sources.push(subpath.source);
    }
    // tsup's entry list is what emits those files; every entry is also declared, and every
    // declaration has an entry.
    const tsup = await readFile(path.join(packageDir, "tsup.config.ts"), "utf8");
    const entries = [...tsup.matchAll(/"(src\/[^"]+)"/g)].map((match) => match[1]!);
    expect(entries).toEqual(TSUP_ENTRIES);
    expect(TSUP_ENTRIES.slice().sort()).toEqual(sources.slice().sort());
  });

  it("ships exactly the recorded runtime names through each subpath", async () => {
    for (const subpath of SUBPATHS) {
      const shipped = Object.keys(await subpath.load()).sort();
      expect(shipped, `the runtime names of ${subpath.key}`).toEqual(subpath.values);
    }
  });

  it("stamps VERSION as a version string a consumer can parse", async () => {
    const barrel = await SUBPATHS[0]!.load();
    expect(typeof barrel.VERSION).toBe("string");
    expect(barrel.VERSION as string).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  });
});

describe("the package barrel (src/index.ts)", () => {
  it("carries exactly the recorded export statements", async () => {
    const source = await readFile(path.join(packageDir, "src/index.ts"), "utf8");
    const observed = parseBarrelStatements(source);
    expect(
      observed.length,
      `src/index.ts has ${observed.length} export statements; paste the observed set:\n${recordBlock(observed)}`,
    ).toBe(BARREL_STATEMENTS.length);
    expect(observed, "the export statements of src/index.ts").toEqual(BARREL_STATEMENTS);
  });

  it("re-exports every module path the records name, and no others", async () => {
    // the barrel's runtime names are pinned by the "." record above; this is the cross-check that
    // its source is the same module that record was taken from.
    expect(SUBPATHS[0]!.source).toBe("src/index.ts");
    const barrelPath = path.join(packageDir, SUBPATHS[0]!.source);
    const modules = new Set(
      BARREL_STATEMENTS.flatMap((record) => ("from" in record ? [record.from] : [])),
    );
    for (const rel of modules) {
      const source = path.resolve(path.dirname(barrelPath), rel.replace(/.js$/, ".ts"));
      await expect(readFile(source, "utf8")).resolves.toBeTruthy();
    }
  });
});

/*
 * The type half of the lock — the names behind these subpaths that exist only at compile time.
 *
 * Nothing runtime can see them, so their guard is `pnpm --filter @prismshadow/penguin-core
 * typecheck` (the package's tsconfig includes test/): a name dropped or renamed in the module
 * fails that build with "Module … has no exported member …". Adding a type is not an error here
 * — a new public type is backward compatible — so this half holds against drops and renames, not
 * against growth, and a deliberate addition still belongs in the lists below.
 *
 * The lists are sorted and hold, per subpath, every exported name that is not in that subpath's
 * runtime record above. Every specifier is aliased as `_<subpath>_<Name>` — the same public type
 * is reachable through several subpaths (`OmniMessage` through `./omnimessage` and through the
 * barrel), and two bare imports of one name in one file are a compile error (TS2300), which would
 * make this file fail its own guard. Read the prefix as the subpath that must keep exporting it.
 */
// . — 192 public names that exist only at compile time.
import type {
  AbortPayload as _barrel_AbortPayload,
  AgentAssembly as _barrel_AgentAssembly,
  AgentPreset as _barrel_AgentPreset,
  AgentState as _barrel_AgentState,
  ApprovalDecision as _barrel_ApprovalDecision,
  ApprovalDecisionPayload as _barrel_ApprovalDecisionPayload,
  ApproveFn as _barrel_ApproveFn,
  AtomicWriteOptions as _barrel_AtomicWriteOptions,
  BackgroundCommandInfo as _barrel_BackgroundCommandInfo,
  BackgroundSubagentInfo as _barrel_BackgroundSubagentInfo,
  BackgroundTaskDone as _barrel_BackgroundTaskDone,
  BackgroundTaskDoneEvent as _barrel_BackgroundTaskDoneEvent,
  BuildInfo as _barrel_BuildInfo,
  BuildRuntimeInfo as _barrel_BuildRuntimeInfo,
  BuiltinTool as _barrel_BuiltinTool,
  BuiltinToolFactory as _barrel_BuiltinToolFactory,
  ChatApprovalMode as _barrel_ChatApprovalMode,
  CommandPolicyConfig as _barrel_CommandPolicyConfig,
  CommandPolicyRule as _barrel_CommandPolicyRule,
  CompactAvailability as _barrel_CompactAvailability,
  CompactionBeginPayload as _barrel_CompactionBeginPayload,
  CompactionConfig as _barrel_CompactionConfig,
  CompactionEndPayload as _barrel_CompactionEndPayload,
  CompactionMode as _barrel_CompactionMode,
  CompactionReason as _barrel_CompactionReason,
  CompactionSettings as _barrel_CompactionSettings,
  CompleteModelMessage as _barrel_CompleteModelMessage,
  CompleteModelPayload as _barrel_CompleteModelPayload,
  ConfinedSpawn as _barrel_ConfinedSpawn,
  ContextEngineDeps as _barrel_ContextEngineDeps,
  ControlEnvContext as _barrel_ControlEnvContext,
  CreateAgentOptions as _barrel_CreateAgentOptions,
  CreateSessionOptions as _barrel_CreateSessionOptions,
  DefaultChatThinkingLevel as _barrel_DefaultChatThinkingLevel,
  EngineInitialState as _barrel_EngineInitialState,
  EnvironmentConfig as _barrel_EnvironmentConfig,
  EnvironmentInterface as _barrel_EnvironmentInterface,
  EnvironmentServices as _barrel_EnvironmentServices,
  ErrorCode as _barrel_ErrorCode,
  ErrorInfo as _barrel_ErrorInfo,
  EventMessage as _barrel_EventMessage,
  EventPayload as _barrel_EventPayload,
  FastModeProtocol as _barrel_FastModeProtocol,
  Fidelity as _barrel_Fidelity,
  GenerativeModelConfig as _barrel_GenerativeModelConfig,
  GenerativeModelParameters as _barrel_GenerativeModelParameters,
  HandoffOrigin as _barrel_HandoffOrigin,
  HarnessHistory as _barrel_HarnessHistory,
  HarnessHistoryEntry as _barrel_HarnessHistoryEntry,
  HarnessInfo as _barrel_HarnessInfo,
  HarnessSource as _barrel_HarnessSource,
  HookCommand as _barrel_HookCommand,
  HookDecision as _barrel_HookDecision,
  HookManifest as _barrel_HookManifest,
  HookPayload as _barrel_HookPayload,
  HookSubagentRequest as _barrel_HookSubagentRequest,
  HookSubagentSpawned as _barrel_HookSubagentSpawned,
  HookSubagentSpawner as _barrel_HookSubagentSpawner,
  HooksConfig as _barrel_HooksConfig,
  IdKind as _barrel_IdKind,
  IfacesSummary as _barrel_IfacesSummary,
  ImageUrlPayload as _barrel_ImageUrlPayload,
  InlineDataPayload as _barrel_InlineDataPayload,
  InlineThinkingPayload as _barrel_InlineThinkingPayload,
  InstalledHook as _barrel_InstalledHook,
  InstalledSkill as _barrel_InstalledSkill,
  KernelSupersededTabHashes as _barrel_KernelSupersededTabHashes,
  KernelTab as _barrel_KernelTab,
  KernelUpdateOptions as _barrel_KernelUpdateOptions,
  KernelUpdateResult as _barrel_KernelUpdateResult,
  LLMInterface as _barrel_LLMInterface,
  LLMOutcome as _barrel_LLMOutcome,
  LibraryHooks as _barrel_LibraryHooks,
  LibraryPlugin as _barrel_LibraryPlugin,
  LibrarySkill as _barrel_LibrarySkill,
  ListEndpointModelsOptions as _barrel_ListEndpointModelsOptions,
  LocatedTraceFile as _barrel_LocatedTraceFile,
  MCPServerConfig as _barrel_MCPServerConfig,
  MCPServerPermissionMode as _barrel_MCPServerPermissionMode,
  McpConnectBeginPayload as _barrel_McpConnectBeginPayload,
  McpConnectEndPayload as _barrel_McpConnectEndPayload,
  McpServerConnectResult as _barrel_McpServerConnectResult,
  McpToolProviderOptions as _barrel_McpToolProviderOptions,
  MemoryConfig as _barrel_MemoryConfig,
  MemoryTopicMetadata as _barrel_MemoryTopicMetadata,
  MessageOrigin as _barrel_MessageOrigin,
  ModelCatalogEntry as _barrel_ModelCatalogEntry,
  ModelEntry as _barrel_ModelEntry,
  ModelEnvInfo as _barrel_ModelEnvInfo,
  ModelMessage as _barrel_ModelMessage,
  ModelPayload as _barrel_ModelPayload,
  ModelPricing as _barrel_ModelPricing,
  ModelProviderBridgeAuth as _barrel_ModelProviderBridgeAuth,
  ModelProviderInfo as _barrel_ModelProviderInfo,
  ModelProviderOAuth as _barrel_ModelProviderOAuth,
  ModelRef as _barrel_ModelRef,
  ModelRequestContext as _barrel_ModelRequestContext,
  ModelSwitchOrigin as _barrel_ModelSwitchOrigin,
  OffPeakDiscount as _barrel_OffPeakDiscount,
  OmniMessage as _barrel_OmniMessage,
  OmniMessageType as _barrel_OmniMessageType,
  OmniPayload as _barrel_OmniPayload,
  OpenContextOptions as _barrel_OpenContextOptions,
  OpenedContext as _barrel_OpenedContext,
  OrgTriggerKind as _barrel_OrgTriggerKind,
  OrgTriggerOrigin as _barrel_OrgTriggerOrigin,
  ParseTraceLinesOptions as _barrel_ParseTraceLinesOptions,
  PartialModelMessage as _barrel_PartialModelMessage,
  PartialModelPayload as _barrel_PartialModelPayload,
  PartialTextPayload as _barrel_PartialTextPayload,
  PartialThinkingPayload as _barrel_PartialThinkingPayload,
  PartialToolCallOutputPayload as _barrel_PartialToolCallOutputPayload,
  PartialToolCallPayload as _barrel_PartialToolCallPayload,
  PluginCategory as _barrel_PluginCategory,
  PluginRequirement as _barrel_PluginRequirement,
  PluginTable as _barrel_PluginTable,
  PluginTables as _barrel_PluginTables,
  PreToolUseFn as _barrel_PreToolUseFn,
  PreToolUseHook as _barrel_PreToolUseHook,
  PreToolUseHookInput as _barrel_PreToolUseHookInput,
  PreToolUseHookResult as _barrel_PreToolUseHookResult,
  PreToolUseOutcome as _barrel_PreToolUseOutcome,
  ProcessExit as _barrel_ProcessExit,
  ProjectChatDefaults as _barrel_ProjectChatDefaults,
  ProjectConfig as _barrel_ProjectConfig,
  PromptSection as _barrel_PromptSection,
  ProxyEnvPolicy as _barrel_ProxyEnvPolicy,
  RequestBeginPayload as _barrel_RequestBeginPayload,
  RequestEndPayload as _barrel_RequestEndPayload,
  ResolveMCPServersResult as _barrel_ResolveMCPServersResult,
  ResolvedMCPServer as _barrel_ResolvedMCPServer,
  ResolvedMCPTransport as _barrel_ResolvedMCPTransport,
  ResolvedPluginGroup as _barrel_ResolvedPluginGroup,
  ResumeResult as _barrel_ResumeResult,
  ResumeSessionOptions as _barrel_ResumeSessionOptions,
  RetryDetail as _barrel_RetryDetail,
  Role as _barrel_Role,
  RollbackFailure as _barrel_RollbackFailure,
  RunCutoff as _barrel_RunCutoff,
  RunHookScriptOptions as _barrel_RunHookScriptOptions,
  RunOptions as _barrel_RunOptions,
  ScheduledOrigin as _barrel_ScheduledOrigin,
  SchedulesConfig as _barrel_SchedulesConfig,
  SessionConfig as _barrel_SessionConfig,
  SessionEnvironmentValues as _barrel_SessionEnvironmentValues,
  SessionHooks as _barrel_SessionHooks,
  SessionMemory as _barrel_SessionMemory,
  SessionMetaMessage as _barrel_SessionMetaMessage,
  SessionMetaPayload as _barrel_SessionMetaPayload,
  SessionTitleResult as _barrel_SessionTitleResult,
  SessionWorkspaceMemory as _barrel_SessionWorkspaceMemory,
  SkillMetadata as _barrel_SkillMetadata,
  SkillsConfig as _barrel_SkillsConfig,
  SkillsMessage as _barrel_SkillsMessage,
  SpawnConfiner as _barrel_SpawnConfiner,
  SpawnOptions as _barrel_SpawnOptions,
  StopHook as _barrel_StopHook,
  StopHookInput as _barrel_StopHookInput,
  StopHookResult as _barrel_StopHookResult,
  StopHooksOutcome as _barrel_StopHooksOutcome,
  StopReason as _barrel_StopReason,
  StreamEventType as _barrel_StreamEventType,
  SubagentHandle as _barrel_SubagentHandle,
  SubagentMessageOptions as _barrel_SubagentMessageOptions,
  SubagentMessageOutcome as _barrel_SubagentMessageOutcome,
  SubagentPayload as _barrel_SubagentPayload,
  SubagentRunner as _barrel_SubagentRunner,
  SystemConfig as _barrel_SystemConfig,
  TextPayload as _barrel_TextPayload,
  TextSender as _barrel_TextSender,
  ThinkingLevelName as _barrel_ThinkingLevelName,
  ThinkingPayload as _barrel_ThinkingPayload,
  TokenCounts as _barrel_TokenCounts,
  TokenUsagePayload as _barrel_TokenUsagePayload,
  ToolCallOutputPayload as _barrel_ToolCallOutputPayload,
  ToolCallPayload as _barrel_ToolCallPayload,
  ToolConfig as _barrel_ToolConfig,
  ToolDefinition as _barrel_ToolDefinition,
  ToolDefinitionConfig as _barrel_ToolDefinitionConfig,
  ToolDetachResult as _barrel_ToolDetachResult,
  ToolExecutionContext as _barrel_ToolExecutionContext,
  ToolExecutionRequest as _barrel_ToolExecutionRequest,
  ToolListReadyPayload as _barrel_ToolListReadyPayload,
  ToolPermission as _barrel_ToolPermission,
  TraceSink as _barrel_TraceSink,
  UserPromptHook as _barrel_UserPromptHook,
  UserPromptHookInput as _barrel_UserPromptHookInput,
  UserPromptHookResult as _barrel_UserPromptHookResult,
  VaultConfig as _barrel_VaultConfig,
  VersionReport as _barrel_VersionReport,
  VisionDescriberService as _barrel_VisionDescriberService,
  WriterOptions as _barrel_WriterOptions,
} from "../src/index.js";

// ./omnimessage — 59 public names that exist only at compile time.
import type {
  AbortPayload as _omnimessage_AbortPayload,
  ApprovalDecision as _omnimessage_ApprovalDecision,
  ApprovalDecisionPayload as _omnimessage_ApprovalDecisionPayload,
  BackgroundTaskDone as _omnimessage_BackgroundTaskDone,
  CompactionBeginPayload as _omnimessage_CompactionBeginPayload,
  CompactionEndPayload as _omnimessage_CompactionEndPayload,
  CompactionMode as _omnimessage_CompactionMode,
  CompactionReason as _omnimessage_CompactionReason,
  CompleteModelMessage as _omnimessage_CompleteModelMessage,
  CompleteModelPayload as _omnimessage_CompleteModelPayload,
  ErrorCode as _omnimessage_ErrorCode,
  ErrorInfo as _omnimessage_ErrorInfo,
  EventMessage as _omnimessage_EventMessage,
  EventPayload as _omnimessage_EventPayload,
  Fidelity as _omnimessage_Fidelity,
  HandoffOrigin as _omnimessage_HandoffOrigin,
  HookDecision as _omnimessage_HookDecision,
  HookPayload as _omnimessage_HookPayload,
  ImageUrlPayload as _omnimessage_ImageUrlPayload,
  InlineDataPayload as _omnimessage_InlineDataPayload,
  InlineThinkingPayload as _omnimessage_InlineThinkingPayload,
  McpConnectBeginPayload as _omnimessage_McpConnectBeginPayload,
  McpConnectEndPayload as _omnimessage_McpConnectEndPayload,
  McpServerConnectResult as _omnimessage_McpServerConnectResult,
  MessageOrigin as _omnimessage_MessageOrigin,
  ModelMessage as _omnimessage_ModelMessage,
  ModelPayload as _omnimessage_ModelPayload,
  ModelSwitchOrigin as _omnimessage_ModelSwitchOrigin,
  OmniMessage as _omnimessage_OmniMessage,
  OmniMessageType as _omnimessage_OmniMessageType,
  OmniPayload as _omnimessage_OmniPayload,
  OrgTriggerKind as _omnimessage_OrgTriggerKind,
  OrgTriggerOrigin as _omnimessage_OrgTriggerOrigin,
  PartialModelMessage as _omnimessage_PartialModelMessage,
  PartialModelPayload as _omnimessage_PartialModelPayload,
  PartialTextPayload as _omnimessage_PartialTextPayload,
  PartialThinkingPayload as _omnimessage_PartialThinkingPayload,
  PartialToolCallOutputPayload as _omnimessage_PartialToolCallOutputPayload,
  PartialToolCallPayload as _omnimessage_PartialToolCallPayload,
  RequestBeginPayload as _omnimessage_RequestBeginPayload,
  RequestEndPayload as _omnimessage_RequestEndPayload,
  RetryDetail as _omnimessage_RetryDetail,
  Role as _omnimessage_Role,
  ScheduledOrigin as _omnimessage_ScheduledOrigin,
  SessionMetaMessage as _omnimessage_SessionMetaMessage,
  SessionMetaPayload as _omnimessage_SessionMetaPayload,
  SkillsMessage as _omnimessage_SkillsMessage,
  StopReason as _omnimessage_StopReason,
  StreamEventType as _omnimessage_StreamEventType,
  SubagentPayload as _omnimessage_SubagentPayload,
  TextPayload as _omnimessage_TextPayload,
  TextSender as _omnimessage_TextSender,
  ThinkingPayload as _omnimessage_ThinkingPayload,
  TokenCounts as _omnimessage_TokenCounts,
  TokenUsagePayload as _omnimessage_TokenUsagePayload,
  ToolCallOutputPayload as _omnimessage_ToolCallOutputPayload,
  ToolCallPayload as _omnimessage_ToolCallPayload,
  ToolDefinition as _omnimessage_ToolDefinition,
  ToolListReadyPayload as _omnimessage_ToolListReadyPayload,
} from "../src/omnimessage/index.js";

// ./markers — 7 public names that exist only at compile time.
import type {
  BackgroundTaskDone as _markers_BackgroundTaskDone,
  HandoffOrigin as _markers_HandoffOrigin,
  ModelSwitchOrigin as _markers_ModelSwitchOrigin,
  OrgTriggerKind as _markers_OrgTriggerKind,
  OrgTriggerOrigin as _markers_OrgTriggerOrigin,
  ScheduledOrigin as _markers_ScheduledOrigin,
  SkillsMessage as _markers_SkillsMessage,
} from "../src/omnimessage/markers/index.js";

// ./interfaces — 32 public names that exist only at compile time.
import type {
  ApproveFn as _interfaces_ApproveFn,
  BackgroundCommandInfo as _interfaces_BackgroundCommandInfo,
  BackgroundSubagentInfo as _interfaces_BackgroundSubagentInfo,
  BackgroundTaskDoneEvent as _interfaces_BackgroundTaskDoneEvent,
  CommandPolicyConfig as _interfaces_CommandPolicyConfig,
  CommandPolicyRule as _interfaces_CommandPolicyRule,
  ConfinedSpawn as _interfaces_ConfinedSpawn,
  EnvironmentConfig as _interfaces_EnvironmentConfig,
  EnvironmentInterface as _interfaces_EnvironmentInterface,
  EnvironmentServices as _interfaces_EnvironmentServices,
  GenerativeModelConfig as _interfaces_GenerativeModelConfig,
  GenerativeModelParameters as _interfaces_GenerativeModelParameters,
  LLMInterface as _interfaces_LLMInterface,
  LLMOutcome as _interfaces_LLMOutcome,
  MCPServerConfig as _interfaces_MCPServerConfig,
  PreToolUseFn as _interfaces_PreToolUseFn,
  PreToolUseOutcome as _interfaces_PreToolUseOutcome,
  ProxyEnvPolicy as _interfaces_ProxyEnvPolicy,
  RunCutoff as _interfaces_RunCutoff,
  SpawnConfiner as _interfaces_SpawnConfiner,
  SubagentHandle as _interfaces_SubagentHandle,
  SubagentMessageOptions as _interfaces_SubagentMessageOptions,
  SubagentMessageOutcome as _interfaces_SubagentMessageOutcome,
  SubagentRunner as _interfaces_SubagentRunner,
  ThinkingLevelName as _interfaces_ThinkingLevelName,
  ToolConfig as _interfaces_ToolConfig,
  ToolDefinition as _interfaces_ToolDefinition,
  ToolDefinitionConfig as _interfaces_ToolDefinitionConfig,
  ToolDetachResult as _interfaces_ToolDetachResult,
  ToolExecutionRequest as _interfaces_ToolExecutionRequest,
  ToolPermission as _interfaces_ToolPermission,
  VisionDescriberService as _interfaces_VisionDescriberService,
} from "../src/interfaces/index.js";

// ./plugin — 19 public names that exist only at compile time.
import type {
  ClassCtx as _plugin_ClassCtx,
  ComponentMeta as _plugin_ComponentMeta,
  ConfinedArgv as _plugin_ConfinedArgv,
  ConfinedSandboxMode as _plugin_ConfinedSandboxMode,
  ModuleClass as _plugin_ModuleClass,
  ModuleMeta as _plugin_ModuleMeta,
  Opaque as _plugin_Opaque,
  Plugin as _plugin_Plugin,
  RunnerFailureRule as _plugin_RunnerFailureRule,
  SandboxDimension as _plugin_SandboxDimension,
  SandboxEnforcement as _plugin_SandboxEnforcement,
  SandboxMode as _plugin_SandboxMode,
  SandboxNetwork as _plugin_SandboxNetwork,
  SandboxPolicy as _plugin_SandboxPolicy,
  SandboxProvider as _plugin_SandboxProvider,
  SandboxProviderLoad as _plugin_SandboxProviderLoad,
  SandboxProviderSource as _plugin_SandboxProviderSource,
  SandboxSettings as _plugin_SandboxSettings,
  Slot as _plugin_Slot,
} from "../src/plugin/index.js";

// ./model-catalog — 7 public names that exist only at compile time.
import type {
  FastModeProtocol as _model_catalog_FastModeProtocol,
  ModelCatalogEntry as _model_catalog_ModelCatalogEntry,
  ModelEnvInfo as _model_catalog_ModelEnvInfo,
  ModelProviderBridgeAuth as _model_catalog_ModelProviderBridgeAuth,
  ModelProviderInfo as _model_catalog_ModelProviderInfo,
  ModelProviderOAuth as _model_catalog_ModelProviderOAuth,
  OffPeakDiscount as _model_catalog_OffPeakDiscount,
} from "../src/state/model-catalog.js";

// ./kernel — 54 public names that exist only at compile time.
import type {
  AnyIface as _kernel_AnyIface,
  AnyImpl as _kernel_AnyImpl,
  ApiOf as _kernel_ApiOf,
  BootModulesOptions as _kernel_BootModulesOptions,
  CheckResult as _kernel_CheckResult,
  ChildDecl as _kernel_ChildDecl,
  ChildRef as _kernel_ChildRef,
  ClassCtx as _kernel_ClassCtx,
  ComponentMeta as _kernel_ComponentMeta,
  ContextDecl as _kernel_ContextDecl,
  Contributed as _kernel_Contributed,
  Iface as _kernel_Iface,
  IfaceClass as _kernel_IfaceClass,
  IfaceDecl as _kernel_IfaceDecl,
  IfaceRegistry as _kernel_IfaceRegistry,
  IfaceTable as _kernel_IfaceTable,
  Impl as _kernel_Impl,
  Instance as _kernel_Instance,
  Json as _kernel_Json,
  JsonObject as _kernel_JsonObject,
  KeyedDecl as _kernel_KeyedDecl,
  KeyedHandle as _kernel_KeyedHandle,
  Manifest as _kernel_Manifest,
  ManifestNode as _kernel_ManifestNode,
  ManifestTable as _kernel_ManifestTable,
  Mismatch as _kernel_Mismatch,
  ModuleClass as _kernel_ModuleClass,
  ModuleCtx as _kernel_ModuleCtx,
  ModuleDef as _kernel_ModuleDef,
  ModuleImplOf as _kernel_ModuleImplOf,
  ModuleInstance as _kernel_ModuleInstance,
  ModuleMeta as _kernel_ModuleMeta,
  ModuleTree as _kernel_ModuleTree,
  NodeCtx as _kernel_NodeCtx,
  Opaque as _kernel_Opaque,
  Park as _kernel_Park,
  ParkedNode as _kernel_ParkedNode,
  ParseFail as _kernel_ParseFail,
  ParseResult as _kernel_ParseResult,
  Problem as _kernel_Problem,
  Published as _kernel_Published,
  Requirement as _kernel_Requirement,
  Resources as _kernel_Resources,
  Schema as _kernel_Schema,
  Sig as _kernel_Sig,
  Slot as _kernel_Slot,
  SlotDecl as _kernel_SlotDecl,
  TableLike as _kernel_TableLike,
  TypeExpr as _kernel_TypeExpr,
  TypeTable as _kernel_TypeTable,
  UpgradeBlocked as _kernel_UpgradeBlocked,
  UpgradeFailed as _kernel_UpgradeFailed,
  UpgradeResult as _kernel_UpgradeResult,
  UseOf as _kernel_UseOf,
} from "../src/kernel/index.js";
