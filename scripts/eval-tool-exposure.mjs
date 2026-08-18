#!/usr/bin/env node

/**
 * Explicitly opt-in live comparison of direct, automatic, and lazy tool exposure.
 *
 * The runner uses the production Environment, MCP provider, Session loop, GenerativeModel,
 * fixed lazy search/dispatch gateways, and a configurable-size stdio MCP server. It makes paid
 * model requests only when PENGUIN_TOOL_EXPOSURE_EVAL=1; `--dry-run`
 * validates the plan without network access.
 *
 * Usage:
 *   pnpm eval:tool-exposure -- --dry-run
 *   PENGUIN_TOOL_EXPOSURE_EVAL=1 pnpm eval:tool-exposure
 *   PENGUIN_TOOL_EXPOSURE_EVAL=1 pnpm eval:tool-exposure -- --runs=3 --json --check
 *   PENGUIN_TOOL_EXPOSURE_EVAL=1 pnpm eval:tool-exposure -- --sequence --extended --json
 *   PENGUIN_TOOL_EXPOSURE_EVAL=1 pnpm eval:tool-exposure -- --sequence --boundary --json
 *   PENGUIN_TOOL_EXPOSURE_EVAL=1 pnpm eval:tool-exposure -- --sequence --dynamic --json
 *
 * Optional environment:
 *   PENGUIN_TOOL_EXPOSURE_EVAL_MODEL, PENGUIN_TOOL_EXPOSURE_EVAL_API_KEY,
 *   PENGUIN_TOOL_EXPOSURE_EVAL_BASE_URL, PENGUIN_TOOL_EXPOSURE_EVAL_CLIENT_TYPE,
 *   PENGUIN_TOOL_EXPOSURE_EVAL_THINKING, PENGUIN_TOOL_EXPOSURE_EVAL_TOOL_COUNT,
 *   PENGUIN_TOOL_EXPOSURE_EVAL_MAX_TURNS, PENGUIN_TOOL_EXPOSURE_EVAL_CACHE_NAMESPACE.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Environment,
  GenerativeModel,
  TOOL_CALL_NAME,
  TOOL_SEARCH_NAME,
  Session,
  userText,
} from "../packages/core/dist/index.js";
import { schemaTokens } from "./lib/tool-exposure-fixtures.mjs";

const staticFixture = fileURLToPath(
  new URL("../packages/core/test/fixtures/mcp-tool-exposure-server.mjs", import.meta.url),
);
const dynamicFixture = fileURLToPath(
  new URL("../packages/core/test/fixtures/mcp-dynamic-catalog-server.mjs", import.meta.url),
);
const providerCandidates = [
  { key: "ANTHROPIC_API_KEY", modelId: "claude-sonnet-4-6" },
  { key: "DEEPSEEK_API_KEY", modelId: "deepseek-v4-flash" },
];
const provider = providerCandidates.find((candidate) => process.env[candidate.key]);
const modelId = process.env.PENGUIN_TOOL_EXPOSURE_EVAL_MODEL ?? provider?.modelId;
const apiKey =
  process.env.PENGUIN_TOOL_EXPOSURE_EVAL_API_KEY ??
  (provider ? process.env[provider.key] : undefined);
const baseUrl = process.env.PENGUIN_TOOL_EXPOSURE_EVAL_BASE_URL;
const clientType = process.env.PENGUIN_TOOL_EXPOSURE_EVAL_CLIENT_TYPE;
const thinkingLevel = process.env.PENGUIN_TOOL_EXPOSURE_EVAL_THINKING ?? "none";
const toolCount = Number(process.env.PENGUIN_TOOL_EXPOSURE_EVAL_TOOL_COUNT ?? 50);
const maxTurns = Number(process.env.PENGUIN_TOOL_EXPOSURE_EVAL_MAX_TURNS ?? 6);
const cacheNamespace = process.env.PENGUIN_TOOL_EXPOSURE_EVAL_CACHE_NAMESPACE?.trim();
const sequence = process.argv.includes("--sequence");
const extended = process.argv.includes("--extended");
const boundary = process.argv.includes("--boundary");
const dynamic = process.argv.includes("--dynamic");
const allTools = process.argv.includes("--all-tools");
if ([extended, boundary, dynamic, allTools].filter(Boolean).length > 1) {
  throw new Error("Choose at most one of --extended, --boundary, --dynamic, or --all-tools");
}
const runsArg = process.argv.find((arg) => arg.startsWith("--runs="));
const runs = Number(runsArg?.slice("--runs=".length) ?? 1);
const modesArg = process.argv.find((arg) => arg.startsWith("--modes="));
const requestedModes = (modesArg?.slice("--modes=".length) ?? "direct,auto,lazy")
  .split(",")
  .filter((mode) => mode !== "");
if (
  requestedModes.length === 0 ||
  requestedModes.some((mode) => !["direct", "auto", "lazy"].includes(mode))
) {
  throw new Error("--modes must contain direct, auto, and/or lazy");
}
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
if (!Number.isInteger(toolCount) || toolCount < 12) {
  throw new Error("PENGUIN_TOOL_EXPOSURE_EVAL_TOOL_COUNT must be an integer >= 12");
}
if (!Number.isInteger(maxTurns) || maxTurns < 1) {
  throw new Error("PENGUIN_TOOL_EXPOSURE_EVAL_MAX_TURNS must be a positive integer");
}

const toolTasks = [
  {
    id: "github-create-issue",
    prompt:
      "Create a GitHub repository issue titled 'Broken export' in prism/demo. Use a tool and do not merely describe the action.",
    target: "mcp__eval__github_create_issue",
  },
  {
    id: "calendar-free-busy",
    prompt:
      "Find a free calendar time slot for 2026-08-20. Use the appropriate tool and do not guess availability.",
    target: "mcp__eval__calendar_free_busy",
  },
  {
    id: "postgres-describe-table-zh",
    prompt: "请使用工具检查 Postgres 数据库 users table 的字段结构，不要自行猜测。",
    target: "mcp__eval__postgres_describe_table",
  },
];
const extendedTasks = [
  {
    id: "no-tool-warmup",
    prompt: "Reply with exactly READY. Do not use any tool.",
    target: null,
    answerIncludes: ["ready"],
  },
  toolTasks[0],
  {
    id: "github-create-follow-up",
    prompt:
      "Create one more issue in the same repository, titled 'CSV import fails'. Use the same external service.",
    target: "mcp__eval__github_create_issue",
  },
  toolTasks[1],
  toolTasks[2],
  {
    id: "no-tool-summary",
    prompt: "Without using any tool, list the three external services used in this conversation.",
    target: null,
    answerIncludes: ["github", "calendar", "postgres"],
  },
];
const boundaryTasks = [
  {
    id: "model-search-slack-post",
    prompt:
      "Tell #ops 'deployment complete' using the external integration. Perform the action rather than describing it.",
    target: "mcp__eval__slack_post_message",
  },
  {
    id: "ambiguous-github-search",
    prompt:
      "Find GitHub items mentioning 'Broken export' using external data. Do not create anything.",
    target: "mcp__eval__github_search_issues",
  },
  {
    id: "no-tool-explanation",
    prompt: "Explain what a database table is in one short sentence. Do not use any tool.",
    target: null,
  },
  {
    id: "two-tool-chain",
    prompt:
      "Create a GitHub issue titled 'Broken export' in prism/demo, then post 'Tracked: Broken export' to #ops. Use both external services.",
    targets: ["mcp__eval__github_create_issue", "mcp__eval__slack_post_message"],
  },
  {
    id: "fallback-no-match",
    prompt:
      "Look for an MCP capability that can restart a Kubernetes deployment. If none exists, say it is unavailable and do not call an unrelated tool.",
    targets: [],
    allowSearch: true,
  },
];
const dynamicTasks = [
  {
    id: "dynamic-initial",
    prompt:
      "Read the text 'alpha' through mutable. Use the external capability, then include the exact tool result in your answer.",
    target: "mcp__eval__mutable",
    answerIncludes: ["initial", "alpha"],
  },
  {
    id: "dynamic-add",
    prompt: "Use catalog control with action add.",
    target: "mcp__eval__catalog_control",
  },
  {
    id: "dynamic-use-added",
    prompt:
      "Run added with value 'beta'. Use the external capability, then include the exact tool result in your answer.",
    target: "mcp__eval__added",
    answerIncludes: ["added", "beta"],
  },
  {
    id: "dynamic-schema-update",
    prompt: "Use catalog control with action schema_v2.",
    target: "mcp__eval__catalog_control",
  },
  {
    id: "dynamic-use-schema-v2",
    prompt:
      "Run mutable with count 7. Use the external capability, then include the exact tool result in your answer.",
    target: "mcp__eval__mutable",
    answerIncludes: ["count", "7"],
  },
  {
    id: "dynamic-remove",
    prompt: "Use catalog control with action remove.",
    target: "mcp__eval__catalog_control",
  },
  {
    id: "dynamic-use-removed",
    prompt:
      "Call search_tools once with query 'mutable'. If no matching tool is returned, report that it is unavailable and do not dispatch.",
    targets: [],
    allowSearch: true,
  },
];
const allToolTasks = [
  {
    id: "builtin-read-file",
    prompt:
      "Read tool-exposure-note.txt from the workspace using a tool and report its exact content.",
    target: "read_file",
    answerIncludes: ["stable gateway fixture"],
  },
  toolTasks[0],
  toolTasks[2],
  {
    id: "all-tools-no-tool",
    prompt: "Reply with exactly NO_TOOL. Do not use any tool.",
    target: null,
    answerIncludes: ["no_tool"],
  },
];
const tasks = dynamic
  ? dynamicTasks
  : boundary
    ? boundaryTasks
    : extended
      ? extendedTasks
      : allTools
        ? allToolTasks
        : toolTasks;
const evaluationModes = dynamic ? ["lazy"] : [...new Set(requestedModes)];
const plan = {
  model: modelId ?? "not configured",
  thinking_level: thinkingLevel,
  runs_per_case: runs,
  cases: tasks.map(({ id, target, targets }) => ({ id, target, targets })),
  modes: evaluationModes,
  native_tools: dynamic ? "dynamic catalog" : toolCount,
  lazy_tool_surface: [TOOL_SEARCH_NAME, TOOL_CALL_NAME],
  scenario: dynamic
    ? "dynamic catalog lifecycle"
    : boundary
      ? "retrieval boundary cases"
      : allTools
        ? "built-in and MCP tools"
        : extended
          ? "extended multi-turn agent"
          : "three tool tasks",
  session_layout: sequence ? "one multi-task Session per mode" : "one Session per case",
  max_turns_per_task: maxTurns,
  cache_namespace: cacheNamespace || "shared/default",
  maximum_model_requests: tasks.length * runs * evaluationModes.length * maxTurns,
  paid_requests_enabled: process.env.PENGUIN_TOOL_EXPOSURE_EVAL === "1",
};

if (process.argv.includes("--dry-run")) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
} else {
  if (process.env.PENGUIN_TOOL_EXPOSURE_EVAL !== "1") {
    throw new Error(
      "Live requests are disabled. Set PENGUIN_TOOL_EXPOSURE_EVAL=1 explicitly or use --dry-run.",
    );
  }
  if (!modelId || !apiKey) {
    throw new Error(
      "No live model credentials found. Set ANTHROPIC_API_KEY or DEEPSEEK_API_KEY, or provide the PENGUIN_TOOL_EXPOSURE_EVAL_* overrides.",
    );
  }
  await runEvaluation();
}

async function removeEventually(dir, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error?.code;
      if (!new Set(["EBUSY", "ENOTEMPTY", "EPERM"]).has(code) || Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

function createEvaluationContext(mode, id, workspaceDir) {
  const cacheMarker = cacheNamespace ? `[Cache namespace: ${cacheNamespace}:${id}] ` : "";
  const systemPrompt =
    cacheMarker +
    "You are a tool-driven evaluation agent. Use tools to perform the requested action " +
    "and never invent a result. When search_tools is available, use it with concise capability " +
    "keywords, inspect the returned contracts, then call call_tool without inventing a tool_ref. " +
    "Otherwise use a matching visible native tool. If none is suitable, say the capability is " +
    "unavailable and do not call an unrelated or unlisted tool. " +
    "After a tool result, answer briefly.";
  const environment = new Environment({
    workspaceDir,
    toolConfig: {
      customTools: allTools
        ? [
            {
              name: "read_file",
              description: "Read a text file from the workspace.",
              permission: "r",
              parameters: {
                type: "object",
                properties: { file_path: { type: "string" } },
                required: ["file_path"],
                additionalProperties: false,
              },
            },
          ]
        : [],
      mcpServers: [
        {
          name: "eval",
          config: {
            command: process.execPath,
            args: [dynamic ? dynamicFixture : staticFixture],
            ...(dynamic
              ? {}
              : {
                  env: {
                    PENGUIN_TOOL_EXPOSURE_EVAL_TOOL_COUNT: String(toolCount),
                    ...(cacheNamespace
                      ? {
                          PENGUIN_TOOL_EXPOSURE_EVAL_SCHEMA_NAMESPACE: `${cacheNamespace}:${id}`,
                        }
                      : {}),
                  },
                }),
          },
        },
      ],
      toolExposure: mode,
    },
  });
  let initialTools = [];
  const session = new Session({
    meta: {
      session_id: `tool-exposure-${mode}-${id}`,
      provider: "evaluation",
      model_id: modelId,
      model_context_window: "unknown",
      system_prompt: systemPrompt,
      agent_state: workspaceDir,
      workspace: workspaceDir,
    },
    bootstrap: async () => {
      initialTools = await environment.listTools();
      return {
        tools: initialTools,
        llm: new GenerativeModel({
          modelId,
          apiKey,
          ...(baseUrl ? { baseUrl } : {}),
          ...(clientType ? { clientType } : {}),
          tools: initialTools,
          systemPrompt,
          maxTokens: 1024,
          thinkingLevel,
        }),
        mcp: environment.mcpConnectResults(),
      };
    },
    cancelBootstrap: () => environment.cancelMcpConnect(),
    mcpServers: environment.mcpServerNames(),
    environment,
    imagesDir: path.join(workspaceDir, "images"),
    modelHasVision: true,
    maxTurns,
  });

  return {
    mode,
    environment,
    session,
    initialTools: () => initialTools,
    initialToolsSignature: () => JSON.stringify(initialTools),
    ensureCatalog: async () => {
      if (initialTools.length === 0) initialTools = await environment.listTools();
    },
    dispose: () => session.dispose(),
  };
}

function taskTargets(task) {
  if (Array.isArray(task.targets)) return task.targets;
  return typeof task.target === "string" ? [task.target] : [];
}

async function runCase(context, task, repetition) {
  await context.ensureCatalog();
  const messages = [];
  const started = performance.now();
  for await (const message of context.session.run([userText(task.prompt)], {
    approve: async () => "allow",
  })) {
    messages.push(message);
  }

  const payloads = messages.map((message) => message.payload);
  const calls = payloads.filter(
    (payload) => payload.type === "tool_call" && payload.stop_reason === "completed",
  );
  const parsedCalls = calls.map((call) => {
    if (typeof call.arguments !== "string") return { call, arguments: null };
    try {
      return { call, arguments: JSON.parse(call.arguments) };
    } catch {
      return { call, arguments: null };
    }
  });
  const usages = payloads.filter((payload) => payload.type === "token_usage");
  const effectiveCalls = calls.flatMap((call) => {
    if (call.name !== TOOL_CALL_NAME) {
      return call.name === TOOL_SEARCH_NAME ? [] : [call.name];
    }
    if (typeof call.arguments !== "string") return [];
    try {
      const args = JSON.parse(call.arguments);
      return typeof args?.tool_name === "string" ? [args.tool_name] : [];
    } catch {
      return [];
    }
  });
  const answer = payloads
    .filter((payload) => payload.type === "text" && typeof payload.text === "string")
    .map((payload) => payload.text)
    .join("\n")
    .toLowerCase();
  const expectedTargets = taskTargets(task);
  const expectsNoTool = expectedTargets.length === 0;
  const wrongToolCalls = effectiveCalls.filter((name) => !expectedTargets.includes(name));
  const toolExpectationMet = expectsNoTool
    ? task.allowSearch === true
      ? calls.every((call) => call.name === TOOL_SEARCH_NAME)
      : calls.length === 0
    : expectedTargets.every((target) => effectiveCalls.includes(target)) &&
      wrongToolCalls.length === 0;
  const answerExpectationMet = (task.answerIncludes ?? []).every((term) =>
    answer.includes(term.toLowerCase()),
  );
  const cacheRead = usages.reduce((sum, usage) => sum + usage.request.cache_read, 0);
  const cacheWrite = usages.reduce((sum, usage) => sum + usage.request.cache_write, 0);
  const currentToolsSignature = JSON.stringify(await context.environment.listTools());
  return {
    mode: context.mode,
    case: task.id,
    repetition,
    success: toolExpectationMet && answerExpectationMet,
    tool_expectation_met: toolExpectationMet,
    answer_expectation_met: answerExpectationMet,
    requests: usages.length,
    search_calls: calls.filter((call) => call.name === TOOL_SEARCH_NAME).length,
    dispatch_calls: calls.filter((call) => call.name === TOOL_CALL_NAME).length,
    search_queries: parsedCalls.flatMap(({ call, arguments: args }) =>
      call.name === TOOL_SEARCH_NAME && typeof args?.query === "string" ? [args.query] : [],
    ),
    dispatch_tool_names: parsedCalls.flatMap(({ call, arguments: args }) =>
      call.name === TOOL_CALL_NAME && typeof args?.tool_name === "string" ? [args.tool_name] : [],
    ),
    actual_tool_calls: effectiveCalls.length,
    wrong_tool_calls: wrongToolCalls.length,
    unexpected_tool_calls: expectsNoTool
      ? calls.filter((call) => !(task.allowSearch === true && call.name === TOOL_SEARCH_NAME))
          .length
      : 0,
    surface_stable: currentToolsSignature === context.initialToolsSignature(),
    reported_request_tokens: usages.reduce((sum, usage) => sum + usage.request.total, 0),
    reported_cache_read_tokens: cacheRead,
    reported_cache_write_tokens: cacheWrite,
    reported_uncached_plus_output_tokens:
      cacheWrite + usages.reduce((sum, usage) => sum + usage.request.output, 0),
    reported_cache_read_ratio:
      cacheRead + cacheWrite === 0 ? 0 : Number((cacheRead / (cacheRead + cacheWrite)).toFixed(3)),
    output_tokens: usages.reduce((sum, usage) => sum + usage.request.output, 0),
    duration_ms: Math.round(performance.now() - started),
    initial_schema_tokens: schemaTokens(context.initialTools()),
  };
}

async function evaluateCase(mode, task, repetition, workspaceDir) {
  const context = createEvaluationContext(mode, `${task.id}-${repetition}`, workspaceDir);
  try {
    return await runCase(context, task, repetition);
  } finally {
    context.dispose();
  }
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageRateOrNull(values) {
  if (values.length === 0) return null;
  return Number(average(values.map(Number)).toFixed(3));
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

function summarize(results, mode, caseId) {
  const selected = results.filter(
    (result) => result.mode === mode && (caseId === undefined || result.case === caseId),
  );
  const requestTokens = selected.map((result) => result.reported_request_tokens);
  const cacheRead = selected.map((result) => result.reported_cache_read_tokens);
  const cacheWrite = selected.map((result) => result.reported_cache_write_tokens);
  const output = selected.map((result) => result.output_tokens);
  const uncachedPlusOutput = selected.map((result) => result.reported_uncached_plus_output_tokens);
  const durations = selected.map((result) => result.duration_ms);
  const searchedRuns = selected.filter((result) => result.search_calls > 0);
  return {
    runs: selected.length,
    success_rate: Number(average(selected.map((result) => Number(result.success))).toFixed(3)),
    tool_expectation_rate: Number(
      average(selected.map((result) => Number(result.tool_expectation_met))).toFixed(3),
    ),
    answer_expectation_rate: Number(
      average(selected.map((result) => Number(result.answer_expectation_met))).toFixed(3),
    ),
    average_requests: Number(average(selected.map((result) => result.requests)).toFixed(2)),
    average_reported_request_tokens: Math.round(
      average(selected.map((result) => result.reported_request_tokens)),
    ),
    average_wrong_tool_calls: Number(
      average(selected.map((result) => result.wrong_tool_calls)).toFixed(2),
    ),
    average_search_calls: Number(average(selected.map((result) => result.search_calls)).toFixed(2)),
    average_dispatch_calls: Number(
      average(selected.map((result) => result.dispatch_calls)).toFixed(2),
    ),
    total_actual_tool_calls: selected.reduce((sum, result) => sum + result.actual_tool_calls, 0),
    explicit_search_rate: Number(
      average(selected.map((result) => Number(result.search_calls > 0))).toFixed(3),
    ),
    searched_task_success_rate: averageRateOrNull(searchedRuns.map((result) => result.success)),
    average_unexpected_tool_calls: Number(
      average(selected.map((result) => result.unexpected_tool_calls)).toFixed(2),
    ),
    surface_stability_rate: Number(
      average(selected.map((result) => Number(result.surface_stable))).toFixed(3),
    ),
    average_reported_cache_read_tokens: Math.round(average(cacheRead)),
    average_reported_cache_write_tokens: Math.round(average(cacheWrite)),
    average_output_tokens: Math.round(average(output)),
    average_uncached_plus_output_tokens: Math.round(average(uncachedPlusOutput)),
    reported_cache_read_ratio: Number(
      (
        cacheRead.reduce((sum, value) => sum + value, 0) /
        Math.max(
          1,
          [...cacheRead, ...cacheWrite].reduce((sum, value) => sum + value, 0),
        )
      ).toFixed(3),
    ),
    p50_reported_request_tokens: percentile(requestTokens, 0.5),
    p95_reported_request_tokens: percentile(requestTokens, 0.95),
    average_duration_ms: Math.round(average(durations)),
    p50_duration_ms: percentile(durations, 0.5),
    p95_duration_ms: percentile(durations, 0.95),
  };
}

async function runEvaluation() {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "penguin-tool-exposure-eval-"));
  const results = [];
  try {
    if (allTools) {
      await writeFile(
        path.join(workspaceDir, "tool-exposure-note.txt"),
        "stable gateway fixture\n",
        "utf8",
      );
    }
    if (sequence) {
      for (let repetition = 1; repetition <= runs; repetition += 1) {
        const contexts = Object.fromEntries(
          evaluationModes.map((mode) => [
            mode,
            createEvaluationContext(mode, `sequence-${repetition}`, workspaceDir),
          ]),
        );
        try {
          for (const [taskIndex, task] of tasks.entries()) {
            const offset = (repetition + taskIndex) % evaluationModes.length;
            const modes = [...evaluationModes.slice(offset), ...evaluationModes.slice(0, offset)];
            for (const mode of modes) {
              process.stderr.write(
                `[tool-exposure eval] ${task.id} ${mode} ${repetition}/${runs} sequence\n`,
              );
              results.push(await runCase(contexts[mode], task, repetition));
            }
          }
        } finally {
          for (const context of Object.values(contexts)) context.dispose();
        }
      }
    } else {
      // Interleave modes per case/repetition to reduce temporal provider-load bias.
      for (let repetition = 1; repetition <= runs; repetition += 1) {
        for (const [taskIndex, task] of tasks.entries()) {
          const offset = (repetition + taskIndex) % evaluationModes.length;
          const modes = [...evaluationModes.slice(offset), ...evaluationModes.slice(0, offset)];
          for (const mode of modes) {
            process.stderr.write(`[tool-exposure eval] ${task.id} ${mode} ${repetition}/${runs}\n`);
            results.push(await evaluateCase(mode, task, repetition, workspaceDir));
          }
        }
      }
    }
  } finally {
    await removeEventually(workspaceDir);
  }

  const summary = Object.fromEntries(
    evaluationModes.map((mode) => [mode, summarize(results, mode)]),
  );
  const direct = summary.direct;
  const lazy = summary.lazy;
  const byCase = Object.fromEntries(
    tasks.map((task) => [
      task.id,
      Object.fromEntries(evaluationModes.map((mode) => [mode, summarize(results, mode, task.id)])),
    ]),
  );
  const report = {
    plan,
    summary,
    by_case: byCase,
    deltas:
      direct && lazy
        ? {
            success_rate: Number((lazy.success_rate - direct.success_rate).toFixed(3)),
            average_requests: Number((lazy.average_requests - direct.average_requests).toFixed(2)),
            reported_request_tokens_pct: Number(
              (
                (lazy.average_reported_request_tokens / direct.average_reported_request_tokens -
                  1) *
                100
              ).toFixed(1),
            ),
            cache_write_tokens_pct: Number(
              (
                (lazy.average_reported_cache_write_tokens /
                  Math.max(1, direct.average_reported_cache_write_tokens) -
                  1) *
                100
              ).toFixed(1),
            ),
            output_tokens_pct: Number(
              (
                (lazy.average_output_tokens / Math.max(1, direct.average_output_tokens) - 1) *
                100
              ).toFixed(1),
            ),
            uncached_plus_output_tokens_pct: Number(
              (
                (lazy.average_uncached_plus_output_tokens /
                  Math.max(1, direct.average_uncached_plus_output_tokens) -
                  1) *
                100
              ).toFixed(1),
            ),
            average_duration_pct: Number(
              ((lazy.average_duration_ms / direct.average_duration_ms - 1) * 100).toFixed(1),
            ),
          }
        : null,
    results,
  };

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `\nTool exposure live comparison (${modelId}, ${runs} run(s) per case)\n\n`,
    );
    process.stdout.write(
      "Mode    Overall  Tool behavior  Answer  Avg requests  Avg search  Avg request tokens  Uncached+output  Surface  Avg latency\n",
    );
    for (const [mode, summary] of Object.entries(report.summary)) {
      process.stdout.write(
        `${mode.padEnd(7)} ${(summary.success_rate * 100).toFixed(1).padStart(7)}%  ` +
          `${`${(summary.tool_expectation_rate * 100).toFixed(1)}%`.padStart(13)}  ` +
          `${`${(summary.answer_expectation_rate * 100).toFixed(1)}%`.padStart(6)}  ` +
          `${summary.average_requests.toFixed(2).padStart(12)}  ` +
          `${summary.average_search_calls.toFixed(2).padStart(10)}  ` +
          `${String(summary.average_reported_request_tokens).padStart(18)}  ` +
          `${String(summary.average_uncached_plus_output_tokens).padStart(15)}  ` +
          `${`${(summary.surface_stability_rate * 100).toFixed(1)}%`.padStart(7)}  ` +
          `${`${summary.average_duration_ms}ms`.padStart(11)}\n`,
      );
    }
    if (lazy) {
      process.stdout.write(
        `\nLazy routing: actual tool calls ${lazy.total_actual_tool_calls}, ` +
          `tasks with explicit search ${(lazy.explicit_search_rate * 100).toFixed(1)}%, ` +
          `searched-task success ${
            lazy.searched_task_success_rate === null
              ? "—"
              : `${(lazy.searched_task_success_rate * 100).toFixed(1)}%`
          }\n`,
      );
    }
    if (report.deltas) process.stdout.write(`\nLazy - direct: ${JSON.stringify(report.deltas)}\n`);
  }

  if (process.argv.includes("--check")) {
    const commonPasses = Object.values(summary).every(
      (item) =>
        item.tool_expectation_rate === 1 &&
        item.answer_expectation_rate === 1 &&
        item.surface_stability_rate === 1 &&
        item.average_wrong_tool_calls === 0 &&
        item.average_unexpected_tool_calls === 0,
    );
    const comparisonPasses =
      direct === undefined ||
      lazy === undefined ||
      (lazy.tool_expectation_rate >= direct.tool_expectation_rate - 0.02 &&
        lazy.answer_expectation_rate >= direct.answer_expectation_rate - 0.02);
    const gateway = lazy ?? summary.auto;
    const gatewayMode = lazy ? "lazy" : summary.auto ? "auto" : null;
    const scenarioPasses = dynamic
      ? byCase["dynamic-use-added"].lazy.success_rate === 1 &&
        byCase["dynamic-use-schema-v2"].lazy.success_rate === 1 &&
        byCase["dynamic-use-removed"].lazy.average_search_calls >= 1
      : boundary
        ? gateway !== undefined &&
          gatewayMode !== null &&
          gateway.explicit_search_rate > 0 &&
          gateway.searched_task_success_rate === 1 &&
          byCase["no-tool-explanation"][gatewayMode].success_rate === 1 &&
          byCase["two-tool-chain"][gatewayMode].success_rate === 1
        : gateway === undefined ||
          (gateway.average_search_calls > 0 &&
            (direct === undefined ||
              gateway.average_reported_request_tokens < direct.average_reported_request_tokens));
    const passes = commonPasses && comparisonPasses && scenarioPasses;
    if (!passes) process.exitCode = 1;
  }
}
