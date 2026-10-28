/**
 * The demo's self-evolution round: the General Agent improves the docs Agent on its Benchmark
 * with the Default RSI Toolkit's `agent-optimization` Skill, in the order the Skill prescribes —
 * read the Reference evaluation, read the weakest case's Test Trace, state a hypothesis, snapshot
 * the Agent State, make one edit (the candidate version), evaluate every case in parallel through
 * `agent-evaluation` subagents, accept the candidate on a strictly higher score and append its
 * evaluation to the scoreboard.
 *
 * The scores here are the fixtures' too: the Benchmark's scoreboard carries the Reference and the
 * accepted candidate with exactly these per-case numbers (fixtures.ts reads `RSI_ROUND`), and the
 * docs Agent's version and AGENTS.md are the candidate's. The evaluators' messages ride in the
 * parent's history with their `origin`, as a reopened Session rebuilds them, and each evaluator
 * and each Test Session the evaluators ran also has a history of its own. The protocol text the
 * Skills prescribe (an evaluator's request and its YAML result) stays English in both languages,
 * as the Skills write it; the person's and the agents' prose follows the frame's language.
 */
import { buildSkillsMessage } from "@prismshadow/amsp/markers";
import { IDS } from "./ids";
import {
  approvalDecision,
  assistantText,
  meta,
  requestBegin,
  requestEnd,
  thinking,
  tokenUsage,
  toolCall,
  toolOutput,
  userText,
} from "./transcripts";
import type { ModelRef, Transcript } from "./transcripts";
import type { Lang } from "./types";

const MIN = 60_000;
const DAY = 86_400_000;

const PROJECT_DIR = `/home/demo/.penguin/data/projects/${IDS.project}`;
/** The same directory as a shell writes it: what the commands `cd` into. */
const PROJECT_SH = `~/.penguin/data/projects/${IDS.project}`;
const DOCS_DIR = `${PROJECT_DIR}/agents/${IDS.agents.docs}`;
/** The General Agent's temporary Workspace, where the round ran. */
export const RSI_WORKSPACE = `${PROJECT_DIR}/agents/${IDS.agents.general}/workspaces/tmp-4be1c09d`;

/** One case of the round: its id, and its score before and after. */
interface RsiCase {
  id: string;
  /** The Reference (v14) score. */
  before: number;
  /** The candidate (v15) run: score, cost in USD, duration. */
  after: { score: number; cost: number; durationMs: number };
}

/**
 * The round's numbers: the Reference version and its scores, the candidate version and its run
 * of each case. The averages are derived, as the Skill writes them.
 */
export const RSI_ROUND = {
  benchmarkId: IDS.benchmarks.docs,
  reference: 14,
  candidate: 15,
  cases: [
    { id: "CASE-001-hooks", before: 64, after: { score: 88, cost: 0.0162, durationMs: 52_310 } },
    { id: "CASE-002-mcp", before: 84, after: { score: 86, cost: 0.0141, durationMs: 47_820 } },
    { id: "CASE-003-memory", before: 80, after: { score: 84, cost: 0.0187, durationMs: 61_450 } },
    {
      id: "CASE-004-citations",
      before: 96,
      after: { score: 96, cost: 0.0128, durationMs: 44_960 },
    },
  ] satisfies RsiCase[],
} as const;

const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/** The Reference's average score. */
export const rsiReferenceScore = (): number => mean(RSI_ROUND.cases.map((c) => c.before));

/** The accepted candidate's evaluation, rounded as the Skill writes a scoreboard entry. */
export function rsiCandidateEvaluation(): { score: number; cost: number; durationMs: number } {
  const runs = RSI_ROUND.cases.map((c) => c.after);
  return {
    score: Math.round(mean(runs.map((r) => r.score)) * 100) / 100,
    cost: Math.round(mean(runs.map((r) => r.cost)) * 1e6) / 1e6,
    durationMs: Math.round(mean(runs.map((r) => r.durationMs))),
  };
}

/** Seconds from the round's start to its last record. */
const END_SEC = 214;
/** Seconds from the start to the scoreboard append: the accepted evaluation's time. */
const APPEND_SEC = 189;

/**
 * When the round ran: a little over three hours ago, below the conversations of this morning;
 * the Reference evaluation it starts from is two days old.
 */
export function rsiTimeline(now: number): {
  startedAt: number;
  evaluatedAt: number;
  endedAt: number;
  referenceAt: number;
} {
  const startedAt = now - 192 * MIN;
  return {
    startedAt,
    evaluatedAt: startedAt + APPEND_SEC * 1000,
    endedAt: startedAt + END_SEC * 1000,
    referenceAt: now - 2 * DAY,
  };
}

/** The Benchmark's own titles, as the fixtures name them. */
export const rsiSummary = (lang: Lang): { title: string; text: string } =>
  lang === "zh"
    ? {
        title: "先打开功能页再回答",
        text: "AGENTS.md 加了一条规则：回答配置类问题前，先打开该功能自己的文档页并引用其中的设置；hooks 用例从 64 分升到 88 分。",
      }
    : {
        title: "Opens the feature's page before answering",
        text: "One AGENTS.md rule: open the feature's own page and quote the setting before answering a configuration question. The hooks case went from 64 to 88.",
      };

/** The docs Agent's AGENTS.md: the Reference's text, and the rule the candidate adds. */
export function docsAgentsMd(lang: Lang, name: string): { reference: string; rule: string } {
  return lang === "zh"
    ? {
        reference: `# ${name}\n\n回答前先检索语料库；引用格式为 \`[n] path\`。`,
        rule: "回答某个功能的配置问题之前，先打开 corpus/ 里这个功能自己的页面（hooks 对应 hooks.md，MCP 对应 mcp.md），引用其中的设置。",
      }
    : {
        reference: `# ${name}\n\nSearch the corpus before answering; cite as \`[n] path\`.`,
        rule: "Before answering a question about configuring a feature, open that feature's own page in corpus/ (hooks → hooks.md, MCP → mcp.md) and quote the setting from it.",
      };
}

/** An ISO timestamp to the second, as `date -u` prints one into a scoreboard. */
const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The request an optimizer sends an evaluator, word for word as `agent-optimization` gives it. */
function evaluatorPrompt(caseId: string): string {
  return [
    `Caller agent: ${IDS.agents.general}`,
    "",
    "Use the `agent-evaluation` Skill. Run the specified Test Agent on the specified Case exactly once, then score that single execution.",
    "protocol_version: 1",
    `case_id: ${caseId}`,
    "run: 1",
    `expected_version: ${RSI_ROUND.candidate}`,
    `test_agent_id: ${IDS.agents.docs}`,
    `benchmark_id: ${RSI_ROUND.benchmarkId}`,
    "provider: deepseek",
    "model_id: deepseek-flash",
  ].join("\n");
}

/** An evaluator's result: the protocol YAML `agent-evaluation` returns, and nothing else. */
function evaluatorResult(index: number): string {
  const c = RSI_ROUND.cases[index]!;
  return [
    "protocol_version: 1",
    "status: ok",
    `case_id: ${c.id}`,
    "run: 1",
    `agent_id: ${IDS.agents.docs}`,
    `expected_version: ${RSI_ROUND.candidate}`,
    "provider: deepseek",
    "model_id: deepseek-flash",
    "thinking_level: medium",
    `score: ${c.after.score}`,
    `cost: ${c.after.cost}`,
    `duration_ms: ${c.after.durationMs}`,
    `session_id: ${IDS.sessions.tests[index]}`,
  ].join("\n");
}

/** The prompt `penguin run` hands the Test Agent, the same for every case. */
const TEST_MESSAGE =
  "Read README.md in the current Workspace and complete the task exactly as specified there.";

/** A case's isolated Test Workspace under the docs Agent. */
export const rsiTestWorkspace = (index: number): string =>
  `${DOCS_DIR}/workspaces/eval-${RSI_ROUND.cases[index]!.id.toLowerCase()}-v${RSI_ROUND.candidate}`;

/** The evaluator's launch of the Test Agent, in the separate statements the Skill asks for. */
function launchCommand(index: number): string {
  const workspace = `$PROJECT_DIR/agents/${IDS.agents.docs}/workspaces/eval-${RSI_ROUND.cases[index]!.id.toLowerCase()}-v${RSI_ROUND.candidate}`;
  return [
    `PROJECT_DIR=${PROJECT_DIR}`,
    'PROJECT_ID="$(basename "$PROJECT_DIR")"',
    'export PENGUIN_HOME="$(dirname "$PROJECT_DIR")"',
    `penguin run --message "${TEST_MESSAGE}" \\`,
    '  --provider deepseek --model-id deepseek-flash --project-id "$PROJECT_ID" \\',
    `  --agent-id ${IDS.agents.docs} --workspace "${workspace}" \\`,
    "  --approve allow-all",
  ].join("\n");
}

interface Copy {
  title: string;
  prompt: string;
  readReference: string;
  readTrace: string;
  snapshot: string;
  append: string;
  thinking: [string, string, string, string, string];
  evaluate: (caseId: string) => string;
  answer: string;
  /** Per case, in case order: the question its statement asks, and the Test Agent's v15 answer. */
  cases: Array<{ question: string; answer: string }>;
  evaluatorThinking: string;
  run: (caseId: string) => string;
}

const COPY: Record<Lang, Copy> = {
  en: {
    title: "Improve Docs Expert on Docs QA v1",
    prompt:
      "Improve Docs Expert on Docs QA v1: reach 85 or more, one run per case, at most two rounds.",
    readReference: "Read the newest evaluation",
    readTrace: "List the files the hooks case opened",
    snapshot: "Snapshot Agent State v14",
    append: "Append the v15 evaluation and check it",
    thinking: [
      "Every input is given: Test Agent docs-expert, the published Benchmark docs-qa-v1, target 85, one run per case, two rounds at most. The Reference is the newest complete evaluation of docs-expert there, and it has to match the agent's current version. Read the scoreboard first.",
      "v14 has one complete evaluation, on deepseek-flash with medium thinking: 81, under the target. CASE-001-hooks lost the most at 64. Its Test Trace shows what the agent read before it answered.",
      "It answered the hooks question from settings.md and overview.md and never opened hooks.md, so the matcher syntax was missing from the answer. Candidate v15 is one rule in AGENTS.md: before answering a configuration question, open the feature's own page and quote the setting from it. Prediction: in CASE-001 the agent opens and cites hooks.md, and the other cases stay about where they are. Snapshot v14 before editing.",
      "Candidate v15 is in place. Evaluate the four cases in parallel, one run each, on the Reference runtime: deepseek / deepseek-flash, medium thinking.",
      "All four results are valid and ran on the Reference runtime. The v15 average is (88 + 86 + 84 + 96) / 4 = 88.5, strictly above 81, so v15 is accepted and its evaluation goes into the scoreboard. CASE-001 went from 64 to 88, as predicted.",
    ],
    evaluate: (caseId) => `Evaluate ${caseId} on v15`,
    answer: `Docs Expert is now **v15** and scores **88.5** on Docs QA v1, up from 81. The first round reached the target of 85, so I stopped there.

| Case | v14 | v15 |
| --- | --- | --- |
| CASE-001-hooks | 64 | 88 |
| CASE-002-mcp | 84 | 86 |
| CASE-003-memory | 80 | 84 |
| CASE-004-citations | 96 | 96 |
| **Average** | **81** | **88.5** |

- **Change**: one rule in \`AGENTS.md\`. Before answering a configuration question, open that feature's page in \`corpus/\` and quote the setting from it.
- **Why**: on the hooks case, v14 answered from \`settings.md\` and never opened \`hooks.md\`.
- **Decision**: accepted, since the score is strictly higher. The prediction held too: CASE-001 now opens and cites \`hooks.md\`.
- **Runs**: the Reference is v14's one-run evaluation, and v15 ran each case once. The v15 evaluation is in \`scoreboard.yaml\`; to roll back, the v14 snapshot is \`snapshots/v14.tar.gz\`.`,
    cases: [
      {
        question: "How are hooks configured?",
        answer:
          "Hooks are configured in `hooks.json` under the Agent State, one entry per hook point; an entry's `matcher` picks the tools it applies to [1].\n\n[1] corpus/claude-code-docs/hooks.md",
      },
      {
        question: "Connect an MCP server",
        answer:
          "Declare the server under `tools.mcpServers` in `system_config.yaml`, with its command and arguments for stdio or its URL for HTTP [1].\n\n[1] corpus/claude-code-docs/mcp.md",
      },
      {
        question: "When memory is written",
        answer:
          "When a Session ends: each memory is a Markdown file with a frontmatter name and description, listed in the scope's MEMORY.md [1].\n\n[1] corpus/claude-code-docs/memory.md",
      },
      {
        question: "Citations must open a real file",
        answer:
          "A hit is cited only if its source file exists: the corpus walk is filtered with `fs.existsSync` before ranking [1].\n\n[1] src/rag.ts",
      },
    ],
    evaluatorThinking:
      "The request is complete and docs-expert is at version 15, as expected. Copy the statement into a fresh Workspace and run the Test Agent once.",
    run: (caseId) => `Run docs-expert on ${caseId}`,
  },
  zh: {
    title: "在文档问答 v1 上优化文档专家",
    prompt: "在「文档问答 v1」上优化文档专家：目标 85 分以上，每题跑 1 次，最多两轮。",
    readReference: "读取最新一条评估",
    readTrace: "列出 hooks 用例读过的文件",
    snapshot: "给 Agent State v14 做快照",
    append: "追加 v15 的评估并核对",
    thinking: [
      "输入都齐了：被测智能体 docs-expert，已发布的 Benchmark docs-qa-v1，目标 85，每题 1 次，最多两轮。Reference 是 docs-expert 在这套 Benchmark 上最新的完整评估，版本要和它当前的一致。先读 scoreboard。",
      "v14 只有一条完整评估，deepseek-flash、medium 思考，81 分，没到目标。失分最多的是 CASE-001-hooks，64 分。看它的 Test Trace，Agent 答题前读了哪些文件。",
      "它答 hooks 题时只读了 settings.md 和 overview.md，没打开 hooks.md，所以答案里缺了 matcher 的写法。候选 v15 只改一处：在 AGENTS.md 加一条规则，回答配置类问题前先打开这个功能自己的文档页，引用里面的设置。预期 CASE-001 会打开并引用 hooks.md，其他用例基本不变。改之前先给 v14 做快照。",
      "候选 v15 已就位。四个用例并行评测，每题 1 次，沿用 Reference 的运行配置：deepseek / deepseek-flash，medium 思考。",
      "四个结果都有效，运行配置与 Reference 一致。v15 平均 (88 + 86 + 84 + 96) / 4 = 88.5，严格高于 81，保留 v15，把这次评估追加进 scoreboard。CASE-001 从 64 分升到 88 分，和预期一致。",
    ],
    evaluate: (caseId) => `评测 v15 的 ${caseId}`,
    answer: `文档专家现在是 **v15**，在「文档问答 v1」上得 **88.5** 分，原来是 81 分。第一轮就达到了 85 分的目标，所以到此为止。

| 用例 | v14 | v15 |
| --- | --- | --- |
| CASE-001-hooks | 64 | 88 |
| CASE-002-mcp | 84 | 86 |
| CASE-003-memory | 80 | 84 |
| CASE-004-citations | 96 | 96 |
| **平均** | **81** | **88.5** |

- **改动**：\`AGENTS.md\` 加了一条规则：回答配置类问题前，先打开 \`corpus/\` 里这个功能的页面，引用其中的设置。
- **依据**：v14 答 hooks 题时只读了 \`settings.md\`，没有打开 \`hooks.md\`。
- **结论**：保留，总分严格提高。预期也成立：CASE-001 现在会打开并引用 \`hooks.md\`。
- **运行次数**：Reference 是 v14 的单次评估，v15 每题跑了 1 次。v15 的评估已写入 \`scoreboard.yaml\`；要回退的话，v14 的快照是 \`snapshots/v14.tar.gz\`。`,
    cases: [
      {
        question: "hooks 是怎么配置的？",
        answer:
          "hooks 在 Agent State 下的 `hooks.json` 里配置，每个钩子点一条；每条的 `matcher` 决定它作用于哪些工具 [1]。\n\n[1] corpus/claude-code-docs/hooks.md",
      },
      {
        question: "接入一个 MCP 服务器",
        answer:
          "在 `system_config.yaml` 的 `tools.mcpServers` 下声明服务器：stdio 写命令和参数，HTTP 写 URL [1]。\n\n[1] corpus/claude-code-docs/mcp.md",
      },
      {
        question: "记忆何时写入",
        answer:
          "Session 结束时写入：每条记忆是一个带 frontmatter 名称和描述的 Markdown 文件，列在所在范围的 MEMORY.md 里 [1]。\n\n[1] corpus/claude-code-docs/memory.md",
      },
      {
        question: "引用必须指向真实文件",
        answer:
          "只有源文件存在的命中才会被引用：排序前先用 `fs.existsSync` 过滤语料库扫描结果 [1]。\n\n[1] src/rag.ts",
      },
    ],
    evaluatorThinking:
      "请求字段齐全，docs-expert 的版本是 15，与预期一致。把题面复制进新的工作区，运行一次被测智能体。",
    run: (caseId) => `在 ${caseId} 上运行 docs-expert`,
  },
};

/** The round's conversation title. */
export const rsiTitle = (lang: Lang): string => COPY[lang].title;

/** The request that starts the self-evolution example. */
export const rsiPrompt = (lang: Lang): string => COPY[lang].prompt;

/** The accepted round's summary, shared by the saved and streamed conversations. */
export const rsiAnswer = (lang: Lang): string => COPY[lang].answer;

/** A Test Session's title: the question its case asks. */
export const rsiTestTitle = (lang: Lang, index: number): string =>
  COPY[lang].cases[index]!.question;

/** The evaluator subagent's title: what its parent's call says it does. */
export const rsiEvaluatorTitle = (lang: Lang, index: number): string =>
  COPY[lang].evaluate(RSI_ROUND.cases[index]!.id);

/** The General Agent's system prompt, as its session_meta records it. */
const GENERAL_PROMPT = "You are the General Agent. Complete the user's requests with your tools.";

/** When the round's request calls the evaluator of case `index`: the four calls stream a beat apart. */
const callSec = (index: number) => 54 + index * 0.4;

/** When evaluator `index` starts (right after its call is approved) and how long its Test Agent runs. */
function evaluatorTimes(startedAt: number, index: number) {
  const c = RSI_ROUND.cases[index]!;
  const start = startedAt + (callSec(index) + 0.1) * 1000;
  const launched = start + 6_000;
  const returned = launched + c.after.durationMs;
  return { start, launched, returned, answered: returned + 7_500 };
}

/** One evaluator's own history: its request, the launch, the result. */
function evaluatorHistory(lang: Lang, startedAt: number, ref: ModelRef, index: number) {
  const c = COPY[lang];
  const caseId = RSI_ROUND.cases[index]!.id;
  const id = IDS.sessions.evaluators[index]!;
  const t = evaluatorTimes(startedAt, index);
  const call = `call_launch_${index + 1}`;
  return [
    meta(t.start, id, ref, RSI_WORKSPACE, {
      agentId: IDS.agents.general,
      systemPrompt: GENERAL_PROMPT,
      source: "subagent",
    }),
    userText(t.start, evaluatorPrompt(caseId), "parent_agent"),
    requestBegin(t.start + 2_000),
    thinking(t.start + 4_500, c.evaluatorThinking),
    toolCall(t.start + 5_800, call, "exec_command", {
      cmd: launchCommand(index),
      description: c.run(caseId),
    }),
    requestEnd(t.start + 5_900),
    approvalDecision(t.launched - 50, call, "allow"),
    toolOutput(t.returned, call, c.cases[index]!.answer),
    requestBegin(t.returned + 300),
    assistantText(t.answered, evaluatorResult(index)),
    tokenUsage(t.answered + 100, 21_400 + index * 1_300, 9_800),
    requestEnd(t.answered + 100),
  ];
}

/** An evaluator subagent's own Session history (its child Session, opened from the parent). */
export function rsiEvaluatorTranscript(
  lang: Lang,
  now: number,
  ref: ModelRef,
  index: number,
): Transcript {
  return {
    running: false,
    history: evaluatorHistory(lang, rsiTimeline(now).startedAt, ref, index),
  };
}

/** A Test Session an evaluator ran: the docs Agent at v15, reading the statement and answering. */
export function rsiTestTranscript(
  lang: Lang,
  now: number,
  ref: ModelRef,
  index: number,
): Transcript {
  const c = COPY[lang].cases[index]!;
  const t = evaluatorTimes(rsiTimeline(now).startedAt, index);
  const id = IDS.sessions.tests[index]!;
  const s = (ms: number) => t.launched + ms;
  const call = `call_statement_${index + 1}`;
  const done = RSI_ROUND.cases[index]!.after.durationMs;
  return {
    running: false,
    history: [
      meta(s(0), id, ref, rsiTestWorkspace(index), { source: "cli" }),
      userText(s(0), TEST_MESSAGE),
      requestBegin(s(300)),
      toolCall(s(4_000), call, "read_file", { path: "README.md" }),
      requestEnd(s(4_100)),
      toolOutput(s(4_300), call, `# ${c.question}\n`),
      requestBegin(s(4_600)),
      assistantText(s(done - 200), c.answer),
      tokenUsage(s(done - 100), 14_600, 9_200),
      requestEnd(s(done)),
    ],
  };
}

/** The scoreboard entry the round appends, as its heredoc spells it. */
function appendedEvaluation(lang: Lang, evaluatedAt: number): string {
  const summary = rsiSummary(lang);
  const total = rsiCandidateEvaluation();
  const cases = RSI_ROUND.cases.flatMap((c, i) => [
    `      - case: ${c.id}`,
    `        score: ${c.after.score}`,
    `        cost: ${c.after.cost}`,
    `        duration_ms: ${c.after.durationMs}`,
    "        runs:",
    `          - score: ${c.after.score}`,
    `            cost: ${c.after.cost}`,
    `            duration_ms: ${c.after.durationMs}`,
    `            session_id: ${IDS.sessions.tests[i]}`,
  ]);
  return [
    `  - time: ${isoSeconds(evaluatedAt)}`,
    `    agent_id: ${IDS.agents.docs}`,
    `    version: ${RSI_ROUND.candidate}`,
    "    provider: deepseek",
    "    model_id: deepseek-flash",
    "    thinking_level: medium",
    "    summary_title: >-",
    `      ${summary.title}`,
    "    summary: >-",
    `      ${summary.text}`,
    `    score: ${total.score}`,
    `    cost: ${total.cost}`,
    `    duration_ms: ${total.durationMs}`,
    "    cases:",
    ...cases,
  ].join("\n");
}

/** The Reference evaluation, as the one-line read of the scoreboard prints it. */
function referenceReadout(): string {
  return [
    `${IDS.agents.docs} ${RSI_ROUND.reference} deepseek-flash medium ${rsiReferenceScore()}`,
    ...RSI_ROUND.cases.map((c) => `${c.id} ${c.before}`),
  ].join("\n");
}

/** The round itself: the General Agent's Session, the evaluators' messages riding in it. */
export function rsiTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const c = COPY[lang];
  const { startedAt, evaluatedAt, endedAt, referenceAt } = rsiTimeline(now);
  const s = (sec: number) => startedAt + sec * 1000;
  const id = IDS.sessions.optimize;
  const agentsMd = docsAgentsMd(lang, lang === "zh" ? "文档专家" : "Docs Expert");
  const traceDay = new Date(referenceAt).toISOString().slice(0, 10);

  // The engine approves each call as soon as it has streamed and starts it at once, so a call,
  // its approval and its evaluator's opening records come one after another — which is also how
  // the chat binds a child to its call — while the next call is still streaming. The children's
  // further messages carry the child's id as `origin`, and a call's output is its child's final
  // text, once it returns.
  const children = RSI_ROUND.cases.map((_, i) =>
    evaluatorHistory(lang, startedAt, ref, i).map((msg) => ({
      ...msg,
      origin: [IDS.sessions.evaluators[i]!],
    })),
  );
  const calls = RSI_ROUND.cases.flatMap((item, i) => [
    toolCall(s(callSec(i)), `call_evaluate_${i + 1}`, "run_subagent", {
      description: c.evaluate(item.id),
      prompt: evaluatorPrompt(item.id),
      agent_id: IDS.agents.general,
    }),
    approvalDecision(s(callSec(i) + 0.05), `call_evaluate_${i + 1}`, "allow"),
    ...children[i]!.slice(0, 2),
  ]);
  const rest = children
    .flatMap((child, i) => [
      ...child.slice(2),
      toolOutput(
        evaluatorTimes(startedAt, i).answered + 200,
        `call_evaluate_${i + 1}`,
        evaluatorResult(i),
      ),
    ])
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  return {
    running: false,
    history: [
      meta(s(0), id, ref, RSI_WORKSPACE, {
        agentId: IDS.agents.general,
        systemPrompt: GENERAL_PROMPT,
      }),
      userText(s(0), buildSkillsMessage(["agent-optimization"], c.prompt)),
      requestBegin(s(0.4)),
      thinking(s(7), c.thinking[0]),
      toolCall(s(8), "call_scoreboard", "exec_command", {
        cmd: [
          `cd ${PROJECT_SH}/benchmarks/${RSI_ROUND.benchmarkId}`,
          "python3 -c \"import yaml; e = yaml.safe_load(open('scoreboard.yaml'))['evaluations'][-1]; print(e['agent_id'], e['version'], e['model_id'], e['thinking_level'], e['score']); [print(c['case'], c['score']) for c in e['cases']]\"",
        ].join("\n"),
        description: c.readReference,
      }),
      requestEnd(s(8.1)),
      toolOutput(s(8.4), "call_scoreboard", referenceReadout()),
      requestBegin(s(8.7)),
      thinking(s(15), c.thinking[1]),
      toolCall(s(16), "call_trace", "exec_command", {
        cmd: `cd ${PROJECT_SH}/agents/${IDS.agents.docs}/traces/${traceDay}\ngrep -oh '"path":"[^"]*"' ${IDS.sessions.benchmark}_*.jsonl | sort | uniq -c`,
        description: c.readTrace,
      }),
      requestEnd(s(16.1)),
      toolOutput(
        s(16.6),
        "call_trace",
        '      2 "path":"corpus/claude-code-docs/settings.md"\n      1 "path":"corpus/claude-code-docs/overview.md"',
      ),
      requestBegin(s(17)),
      thinking(s(31), c.thinking[2]),
      toolCall(s(32), "call_snapshot", "exec_command", {
        cmd: `cd ${PROJECT_SH}/agents/${IDS.agents.docs}\ntar --exclude=.vault.toml -czf snapshots/v${RSI_ROUND.reference}.tar.gz agent_state\ntar -tzf snapshots/v${RSI_ROUND.reference}.tar.gz | head -4`,
        description: c.snapshot,
      }),
      requestEnd(s(32.1)),
      toolOutput(
        s(33.2),
        "call_snapshot",
        "agent_state/\nagent_state/AGENTS.md\nagent_state/system_config.yaml\nagent_state/skills/",
      ),
      requestBegin(s(33.5)),
      toolCall(s(41), "call_rule", "edit_file", {
        path: `${DOCS_DIR}/agent_state/AGENTS.md`,
        old_string: agentsMd.reference,
        new_string: `${agentsMd.reference}\n\n${agentsMd.rule}`,
      }),
      requestEnd(s(41.1)),
      toolOutput(s(41.3), "call_rule", `Edited ${DOCS_DIR}/agent_state/AGENTS.md (+2 -0).`),
      requestBegin(s(41.6)),
      toolCall(s(46), "call_version", "edit_file", {
        path: `${DOCS_DIR}/agent_state/system_config.yaml`,
        old_string: `version: ${RSI_ROUND.reference}`,
        new_string: `version: ${RSI_ROUND.candidate}`,
      }),
      requestEnd(s(46.1)),
      toolOutput(
        s(46.3),
        "call_version",
        `Edited ${DOCS_DIR}/agent_state/system_config.yaml (+1 -1).`,
      ),
      requestBegin(s(46.6)),
      thinking(s(52), c.thinking[3]),
      ...calls,
      requestEnd(s(callSec(RSI_ROUND.cases.length - 1) + 0.3)),
      ...rest,
      requestBegin(s(APPEND_SEC - 18)),
      thinking(s(APPEND_SEC - 4), c.thinking[4]),
      toolCall(s(APPEND_SEC - 1), "call_append", "exec_command", {
        cmd: [
          `cd ${PROJECT_SH}/benchmarks/${RSI_ROUND.benchmarkId}`,
          "cat >> scoreboard.yaml <<'EOF'",
          appendedEvaluation(lang, evaluatedAt),
          "EOF",
          "python3 -c \"import yaml; e = yaml.safe_load(open('scoreboard.yaml'))['evaluations'][-1]; print(e['agent_id'], e['version'], e['score'])\"",
        ].join("\n"),
        description: c.append,
      }),
      requestEnd(s(APPEND_SEC - 0.9)),
      toolOutput(
        s(APPEND_SEC + 0.6),
        "call_append",
        `${IDS.agents.docs} ${RSI_ROUND.candidate} ${rsiCandidateEvaluation().score}`,
      ),
      requestBegin(s(APPEND_SEC + 1)),
      assistantText(endedAt - 300, c.answer),
      tokenUsage(endedAt - 200, 186_400, 24_100),
      requestEnd(endedAt - 200),
    ],
  };
}
