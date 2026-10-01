/**
 * The demo conversations as OmniMessage transcripts, in both languages, plus the scripted
 * reply a sent message streams. Every message is built by the small builders below, so the
 * envelopes (timestamps, roles, stop reasons) are always well-formed, and the running states
 * the gallery exists to show are set up the way the server produces them:
 *
 * - a tool call with no `tool_call_output` yet is a running tool (the card's timer ticks);
 * - an open `partial_thinking` fragment, carried as the live tail, is running thinking;
 * - an open `partial_text` fragment, carried the same way, is a reply streaming in;
 * - a tool call the stream has escalated with `approval_request` is waiting on a human.
 */
import type { GoalServerEvent } from "@prismshadow/penguin-server/api";
import { IDS } from "./ids";
import type { Lang, OmniMessage, PayloadOf, ToolCallMessage } from "./types";

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

const iso = (ms: number) => new Date(ms).toISOString();

const model = <T extends PayloadOf<"text" | "thinking" | "tool_call" | "tool_call_output">>(
  ms: number,
  payload: T,
): OmniMessage => ({ timestamp: iso(ms), type: "model_msg", payload });

export const event = (ms: number, payload: OmniMessage["payload"]): OmniMessage => ({
  timestamp: iso(ms),
  type: "event_msg",
  payload,
});

export const meta = (
  ms: number,
  sessionId: string,
  ref: { provider: string; modelId: string; contextWindow: number },
  workspace: string,
): OmniMessage => ({
  timestamp: iso(ms),
  type: "session_meta",
  payload: {
    session_id: sessionId,
    provider: ref.provider,
    model_id: ref.modelId,
    model_context_window: ref.contextWindow,
    system_prompt: "You are Docs Expert. Cite a real file for every claim.",
    agent_state: `/home/demo/.penguin/data/projects/${IDS.project}/agents/${IDS.agents.docs}/agent_state`,
    workspace,
  },
});

/** A user-role text; `sender` names who wrote it when the person did not (absent = the person). */
export const userText = (ms: number, text: string, sender?: "harness" | "server"): OmniMessage =>
  model(ms, { type: "text", role: "user", text, ...(sender ? { sender } : {}) });

export const assistantText = (
  ms: number,
  text: string,
  stopReason: "completed" | "aborted" = "completed",
): OmniMessage => model(ms, { type: "text", role: "assistant", text, stop_reason: stopReason });

export const thinking = (ms: number, text: string): OmniMessage =>
  model(ms, { type: "thinking", role: "assistant", thinking: text, stop_reason: "completed" });

export const toolCall = (
  ms: number,
  id: string,
  name: string,
  args: Record<string, unknown>,
): ToolCallMessage => ({
  timestamp: iso(ms),
  type: "model_msg",
  payload: {
    type: "tool_call",
    role: "assistant",
    name,
    arguments: JSON.stringify(args),
    tool_call_id: id,
    stop_reason: "completed",
  },
});

export const toolOutput = (ms: number, id: string, output: string): OmniMessage =>
  model(ms, {
    type: "tool_call_output",
    role: "user",
    output,
    tool_call_id: id,
    stop_reason: "completed",
  });

export const requestBegin = (ms: number): OmniMessage => event(ms, { type: "request_begin" });

export const requestEnd = (ms: number): OmniMessage =>
  event(ms, { type: "request_end", status: "completed" });

export const tokenUsage = (ms: number, sessionTotal: number, requestTotal: number): OmniMessage =>
  event(ms, {
    type: "token_usage",
    session: {
      cache_read: Math.round(sessionTotal * 0.62),
      cache_write: Math.round(sessionTotal * 0.09),
      output: Math.round(sessionTotal * 0.29),
      total: sessionTotal,
    },
    request: {
      cache_read: Math.round(requestTotal * 0.7),
      cache_write: Math.round(requestTotal * 0.05),
      output: Math.round(requestTotal * 0.25),
      total: requestTotal,
    },
  });

export const approvalDecision = (ms: number, id: string, decision: "allow" | "deny"): OmniMessage =>
  event(ms, { type: "approval_decision", decision, tool_call_id: id });

export const abortEvent = (ms: number): OmniMessage =>
  event(ms, { type: "abort", error_code: "user_abort" });

/** A streaming fragment; `event_type` says whether it opens, extends or closes the fragment. */
export const partial = (
  ms: number,
  payload:
    | PayloadOf<"partial_text">
    | PayloadOf<"partial_thinking">
    | PayloadOf<"partial_tool_call">
    | PayloadOf<"partial_tool_call_output">,
): OmniMessage => ({ timestamp: iso(ms), type: "model_msg", payload });

// ---------------------------------------------------------------------------------------------
// The content, per language
// ---------------------------------------------------------------------------------------------

const RAG_EXCERPT = `export function buildIndex(root: string): Index {
  const files = walk(root).filter((f) => f.endsWith(".md"));
  const docs = files.map((f) => ({ source: f, text: fs.readFileSync(f, "utf8") }));
  return bm25(docs, { k1: 1.2, b: 0.75 });
}

export function rank(question: string, index: Index): Hit[] {
  return index.query(question).slice(0, 6);
}`;

const RAG_OLD = `  const files = walk(root).filter((f) => f.endsWith(".md"));`;
const RAG_NEW = `  const files = walk(root)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => fs.existsSync(f)); // a citation must open a real file`;

const TEST_OUTPUT = ` RUN  v3.2.6 /home/demo/projects/docs-expert

 ✓ test/rag.test.ts (6 tests) 412ms
   ✓ indexes every markdown file under corpus/
   ✓ ranks hooks.md first for a hooks question
   ✓ never cites a file that does not exist

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  14:02:11
   Duration  1.08s`;

interface Copy {
  done: { prompt: string; thinking: string; answer: string; title: string };
  runningTool: { prompt: string; thinking: string; readOutput: string; title: string };
  thinking: { prompt: string; sentences: string[]; title: string };
  approval: { prompt: string; thinking: string; title: string; allowed: string; denied: string };
  /** The streaming Session's turn; the library's streaming board plays its answer too. */
  streaming: { prompt: string; thinking: string; title: string; answer: string };
  reply: { thinking: string; text: string[]; title: string };
  older: Record<string, { prompt: string; answer: string }>;
}

const COPY: Record<Lang, Copy> = {
  en: {
    done: {
      title: "Index the hooks docs",
      prompt:
        "Add corpus/claude-code-docs/hooks.md to the BM25 index and make sure every citation points at a real file.",
      thinking:
        "The index is built in src/rag.ts from a recursive walk of corpus/. hooks.md is already under that directory, so the question is why it never surfaces: the walk probably filters on the extension before the file exists on disk in the test fixture. I should read the file first, then guard the citation path rather than the ranking.",
      answer: `Done — \`hooks.md\` is indexed and citations are guarded.

| Change | File | Effect |
| --- | --- | --- |
| Filter the walk on \`fs.existsSync\` | \`src/rag.ts\` | A citation can only name a file that opens |
| Re-ran the retrieval tests | \`test/rag.test.ts\` | 6 passed, 412 ms |

The hooks question now ranks the right file first:

\`\`\`ts
rank("How do I configure hooks?", index)[0].source;
// => "corpus/claude-code-docs/hooks.md"
\`\`\`

Nothing else in the corpus changed, so the index rebuild took 12.4 ms [1].

[1] corpus/claude-code-docs/hooks.md`,
    },
    runningTool: {
      title: "Check every link in the docs",
      prompt: "Check every link in corpus/ and list the ones that 404.",
      thinking:
        "There is a link checker in scripts/check-links.mjs. Let me confirm what it covers before running it over the whole corpus, since a full run takes a while.",
      readOutput: `#!/usr/bin/env node
// Walks every .md under corpus/, extracts links, HEADs each URL with a 10s timeout.
// --all also follows relative links to files in the repository.`,
    },
    thinking: {
      title: "Plan the 0.3 release notes",
      prompt: "Read CHANGELOG.md and draft the structure of the 0.3 release notes.",
      sentences: [
        "The changelog has forty-one unreleased entries. ",
        "Grouping them by the surface they touch reads better than by type: the chat, the Agents page, the Evaluation Center, machines. ",
        "Three entries carry a Breaking marker, so the notes need a compatibility section up front. ",
        "The migration entries reference each other; I should name the one a reader has to act on and fold the rest under it. ",
        "The highlight is remote machines — every other entry is a refinement. ",
        "Let me outline: one paragraph of lead, Highlights with three items, then Notable by surface, then Requirements. ",
      ],
    },
    approval: {
      title: "Publish the docs package",
      prompt: "The tests pass. Publish the docs package to npm.",
      thinking:
        "Publishing is irreversible and touches a registry outside the workspace, so this call goes through approval even though the session allows most commands.",
      allowed:
        "Published `@penguinharness/docs-expert@2026.9.14.1`. The registry lists the new version and the tarball is 48.2 KB.",
      denied:
        "Not published. The package is built and ready in `dist/`; run the publish yourself when you want it out.",
    },
    streaming: {
      title: "Explain the citation guard",
      prompt: "Walk me through how the retriever decides what it may cite.",
      thinking:
        "I read src/rag.ts earlier in this session, so I can answer from it: the ranking, then the existence check that guards every citation.",
      answer: `The retriever answers in two passes: it ranks the corpus with BM25, then drops every hit whose source file no longer exists, so a citation always opens a real file.

- **Walk**: \`buildIndex\` reads every Markdown file under \`corpus/\`.
- **Rank**: \`rank\` keeps the six best matches for the question.
- **Guard**: a hit is cited only if \`fs.existsSync\` finds its file.

\`\`\`ts
const hits = rank("How do I configure hooks?", index);
const cited = hits.filter((hit) => fs.existsSync(hit.source));
\`\`\`

To change what comes first, tune \`k1\` and \`b\` in \`src/rag.ts\`; the guard stays as it is.`,
    },
    reply: {
      title: "A question about the corpus",
      thinking:
        "The answer is in the corpus. Let me open the retrieval module to quote the exact rule rather than paraphrase it.",
      text: [
        "Here is what the corpus says.\n\n",
        "The retrieval module ranks the six best matches and keeps only the ones whose source file exists, ",
        "so every citation in an answer opens a real file — that is the rule `src/rag.ts` enforces on line 4.\n\n",
        "If you want the ranking itself changed, the BM25 parameters (`k1`, `b`) are the place to start.",
      ],
    },
    older: {
      [IDS.sessions.older[0]]: {
        prompt: "Sync the corpus from the docs repository.",
        answer: "Synced 214 Markdown files; 3 changed since last time.",
      },
      [IDS.sessions.older[1]]: {
        prompt: "Write an onboarding note for the docs expert.",
        answer: "Drafted docs/onboarding.md with the three questions people ask first.",
      },
      [IDS.sessions.older[2]]: {
        prompt: "Which benchmark cases fail most often?",
        answer: "CASE-003 (hooks configuration) fails in 2 of 3 runs; the rest pass.",
      },
      [IDS.sessions.older[3]]: {
        prompt: "Connect the filesystem MCP server.",
        answer: "Connected `filesystem` (3 tools). The session now reads corpus/ through it.",
      },
      [IDS.sessions.archived]: {
        prompt: "Migrate the old index format.",
        answer: "Migrated; the legacy loader is removed.",
      },
      [IDS.sessions.schedule]: {
        prompt: "[scheduled] Nightly corpus sync.",
        answer: "Nothing changed upstream tonight.",
      },
      [IDS.sessions.subagent]: {
        prompt: "Check the links in hooks.md.",
        answer: "All 14 links answer 200.",
      },
      [IDS.sessions.benchmark]: {
        prompt: "CASE-001: how are hooks configured?",
        answer:
          "Hooks are configured in hooks.json under the Agent State, one entry per hook point [1].",
      },
      [IDS.sessions.notes[0]]: {
        prompt: "Draft the release notes for 0.2.13.",
        answer: "Drafted; see changelog/0.2.13/RELEASE.md.",
      },
      [IDS.sessions.notes[1]]: {
        prompt: "List the breaking changes since 0.2.10.",
        answer: "Three: the plugin version spelling, the trace window and the goal state file.",
      },
    },
  },
  zh: {
    done: {
      title: "为 hooks 文档建立索引",
      prompt:
        "把 corpus/claude-code-docs/hooks.md 加进 BM25 索引，并确认每条引用都指向真实存在的文件。",
      thinking:
        "索引在 src/rag.ts 里由 corpus/ 的递归扫描建立。hooks.md 本来就在这个目录下，所以问题是它为什么从不被命中：扫描大概在测试夹具落盘之前就按扩展名过滤了。先读文件，再守住引用这一步，而不是改排序。",
      answer: `完成——\`hooks.md\` 已进入索引，引用也加了校验。

| 改动 | 文件 | 效果 |
| --- | --- | --- |
| 扫描时按 \`fs.existsSync\` 过滤 | \`src/rag.ts\` | 引用只会指向能打开的文件 |
| 重跑检索测试 | \`test/rag.test.ts\` | 6 项通过，412 ms |

关于 hooks 的问题现在会把正确的文件排在第一位：

\`\`\`ts
rank("如何配置 hooks？", index)[0].source;
// => "corpus/claude-code-docs/hooks.md"
\`\`\`

语料库里其他文件没有变化，索引重建用时 12.4 ms [1]。

[1] corpus/claude-code-docs/hooks.md`,
    },
    runningTool: {
      title: "检查文档里的全部链接",
      prompt: "检查 corpus/ 里的所有链接，列出返回 404 的那些。",
      thinking:
        "scripts/check-links.mjs 里有一个链接检查器。整个语料库跑一遍要花些时间，先确认它覆盖了什么再运行。",
      readOutput: `#!/usr/bin/env node
// 遍历 corpus/ 下的每个 .md，提取链接，对每个 URL 发 HEAD 请求，超时 10s。
// --all 会同时跟进指向仓库内文件的相对链接。`,
    },
    thinking: {
      title: "规划 0.3 发布说明",
      prompt: "读一下 CHANGELOG.md，起草 0.3 发布说明的结构。",
      sentences: [
        "变更日志里有四十一条未发布的条目。",
        "按它们触及的界面分组比按类型分组更好读：对话、智能体页、评估中心、机器。",
        "有三条带 Breaking 标记，所以说明开头需要一节兼容性说明。",
        "迁移相关的条目互相引用；应该点名读者必须动手的那一条，其余折叠在它下面。",
        "亮点是远程机器——其他条目都是打磨。",
        "先列提纲：一段导语，三条 Highlights，然后按界面分的 Notable，最后是 Requirements。",
      ],
    },
    approval: {
      title: "发布文档包",
      prompt: "测试通过了。把文档包发布到 npm。",
      thinking:
        "发布不可撤销，而且会触及工作区之外的注册表，所以即使这个会话允许大多数命令，这一步也要经过审批。",
      allowed:
        "已发布 `@penguinharness/docs-expert@2026.9.14.1`。注册表已列出新版本，压缩包 48.2 KB。",
      denied: "没有发布。包已经构建好放在 `dist/`，需要时自行运行发布命令即可。",
    },
    streaming: {
      title: "讲解引用校验",
      prompt: "讲讲检索模块是怎么决定哪些内容可以引用的。",
      thinking:
        "这个会话前面读过 src/rag.ts，可以直接据此回答：先是排序，再是守住每条引用的存在性校验。",
      answer: `检索分两步回答：先用 BM25 给语料库排序，再丢掉源文件已经不存在的命中，所以每条引用都能打开一个真实文件。

- **扫描**：\`buildIndex\` 读取 \`corpus/\` 下的每个 Markdown 文件。
- **排序**：\`rank\` 为问题保留最匹配的六条。
- **校验**：只有 \`fs.existsSync\` 找得到文件的命中才会被引用。

\`\`\`ts
const hits = rank("如何配置 hooks？", index);
const cited = hits.filter((hit) => fs.existsSync(hit.source));
\`\`\`

想调整排在前面的结果，就改 \`src/rag.ts\` 里的 \`k1\` 和 \`b\`；校验这一步保持不变。`,
    },
    reply: {
      title: "关于语料库的一个问题",
      thinking: "答案在语料库里。打开检索模块，引用原文里的规则，而不是转述。",
      text: [
        "语料库里是这样写的。\n\n",
        "检索模块会取排名最高的六条匹配，只保留源文件真实存在的那些，",
        "所以回答里的每条引用都能打开一个真实文件——这就是 `src/rag.ts` 第 4 行守住的规则。\n\n",
        "如果你想改的是排序本身，BM25 的参数（`k1`、`b`）是起点。",
      ],
    },
    older: {
      [IDS.sessions.older[0]]: {
        prompt: "从文档仓库同步语料库。",
        answer: "已同步 214 个 Markdown 文件，其中 3 个自上次以来有变化。",
      },
      [IDS.sessions.older[1]]: {
        prompt: "给文档专家写一份上手说明。",
        answer: "已起草 docs/onboarding.md，收录了大家最先问的三个问题。",
      },
      [IDS.sessions.older[2]]: {
        prompt: "哪些评估用例最常失败？",
        answer: "CASE-003（hooks 配置）三次里失败两次，其余通过。",
      },
      [IDS.sessions.older[3]]: {
        prompt: "接入 filesystem MCP 服务器。",
        answer: "已连接 `filesystem`（3 个工具）。会话现在通过它读取 corpus/。",
      },
      [IDS.sessions.archived]: {
        prompt: "迁移旧的索引格式。",
        answer: "已迁移；旧的加载器已移除。",
      },
      [IDS.sessions.schedule]: {
        prompt: "[定时] 每晚同步语料库。",
        answer: "今晚上游没有变化。",
      },
      [IDS.sessions.subagent]: {
        prompt: "检查 hooks.md 里的链接。",
        answer: "14 条链接全部返回 200。",
      },
      [IDS.sessions.benchmark]: {
        prompt: "CASE-001：hooks 是怎么配置的？",
        answer: "hooks 在 Agent State 下的 hooks.json 里配置，每个钩子点一条 [1]。",
      },
      [IDS.sessions.notes[0]]: {
        prompt: "起草 0.2.13 的发布说明。",
        answer: "已起草；见 changelog/0.2.13/RELEASE.md。",
      },
      [IDS.sessions.notes[1]]: {
        prompt: "列出 0.2.10 以来的破坏性变更。",
        answer: "三条：插件版本号写法、轨迹窗口和目标状态文件。",
      },
    },
  },
};

export const copyFor = (lang: Lang): Copy => COPY[lang];

// ---------------------------------------------------------------------------------------------
// The transcripts
// ---------------------------------------------------------------------------------------------

export interface ModelRef {
  provider: string;
  modelId: string;
  contextWindow: number;
}

/** The tool call ids the stream events name, so the store can decide them. */
export const TOOL_CALL_IDS = {
  runningCommand: "call_running_links",
  pendingPublish: "call_publish",
} as const;

export interface Transcript {
  history: OmniMessage[];
  /** An open thinking fragment the live tail carries (running thinking). */
  openThinking?: { startedAt: number; text: string };
  /** An open text fragment the live tail carries (a reply streaming in). */
  openText?: { startedAt: number; text: string };
  /** A tool call awaiting a human decision. */
  pendingApproval?: ToolCallMessage;
  /** Goal-mode events a fresh subscription is told after the run state (the goal banner's). */
  goalEvents?: GoalServerEvent[];
  running: boolean;
}

/** The finished Task: a minute and a bit of work, ended a while ago. */
export function doneTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const c = COPY[lang].done;
  const t0 = now - 42 * 60_000;
  const s = (sec: number) => t0 + sec * 1000;
  return {
    running: false,
    history: [
      meta(s(0), IDS.sessions.done, ref, IDS.workspace),
      userText(s(0), c.prompt),
      requestBegin(s(0.4)),
      thinking(s(6), c.thinking),
      toolCall(s(7), "call_read_rag", "read_file", { path: "src/rag.ts" }),
      requestEnd(s(7.1)),
      toolOutput(s(7.5), "call_read_rag", RAG_EXCERPT),
      requestBegin(s(7.8)),
      toolCall(s(14), "call_edit_rag", "edit_file", {
        path: "src/rag.ts",
        old_string: RAG_OLD,
        new_string: RAG_NEW,
      }),
      requestEnd(s(14.1)),
      toolOutput(s(14.6), "call_edit_rag", "Edited src/rag.ts (+3 -1)."),
      requestBegin(s(15)),
      toolCall(s(18), "call_test", "exec_command", {
        cmd: "pnpm vitest run test/rag.test.ts",
        description: lang === "zh" ? "运行检索测试" : "Run the retrieval tests",
      }),
      requestEnd(s(18.1)),
      toolOutput(s(20.2), "call_test", TEST_OUTPUT),
      requestBegin(s(20.5)),
      assistantText(s(31), c.answer),
      tokenUsage(s(31.2), 43_800, 12_400),
      requestEnd(s(31.2)),
    ],
  };
}

/** A Task mid-run: a command executing, its output still to come. */
export function runningToolTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const c = COPY[lang].runningTool;
  const t0 = now - 95_000;
  const s = (sec: number) => t0 + sec * 1000;
  return {
    running: true,
    history: [
      meta(s(0), IDS.sessions.runningTool, ref, IDS.workspace),
      userText(s(0), c.prompt),
      requestBegin(s(0.3)),
      thinking(s(4), c.thinking),
      toolCall(s(5), "call_read_checker", "read_file", { path: "scripts/check-links.mjs" }),
      requestEnd(s(5.1)),
      toolOutput(s(5.4), "call_read_checker", c.readOutput),
      requestBegin(s(5.7)),
      toolCall(s(9), TOOL_CALL_IDS.runningCommand, "exec_command", {
        cmd: "node scripts/check-links.mjs --all",
        description: lang === "zh" ? "检查全部链接" : "Check every link",
      }),
      requestEnd(s(9.1)),
    ],
  };
}

/** A Task mid-run: the model thinking; the fragment is open and keeps growing. */
export function thinkingTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const c = COPY[lang].thinking;
  const t0 = now - 50_000;
  const s = (sec: number) => t0 + sec * 1000;
  return {
    running: true,
    openThinking: { startedAt: s(8), text: c.sentences.slice(0, 2).join("") },
    history: [
      meta(s(0), IDS.sessions.thinking, ref, IDS.workspace),
      userText(s(0), c.prompt),
      requestBegin(s(0.3)),
      toolCall(s(3), "call_read_changelog", "read_file", { path: "CHANGELOG.md" }),
      requestEnd(s(3.1)),
      toolOutput(
        s(3.5),
        "call_read_changelog",
        "# Changelog\n\n## Unreleased\n\n41 entries in changelog/unreleased/ …",
      ),
      requestBegin(s(4)),
    ],
  };
}

/**
 * A Task mid-run whose reply is streaming: the prompt and the settled thinking are history; the
 * answer itself is played by the store, in a loop, while the Session is watched.
 */
export function streamingTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const c = COPY[lang].streaming;
  const t0 = now - 20_000;
  const s = (sec: number) => t0 + sec * 1000;
  return {
    running: true,
    history: [
      meta(s(0), IDS.sessions.streaming, ref, IDS.workspace),
      userText(s(0), c.prompt),
      requestBegin(s(0.3)),
      thinking(s(5), c.thinking),
    ],
  };
}

/** A Task waiting on a human: the publish command awaits approval. */
export function approvalTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const c = COPY[lang].approval;
  const t0 = now - 30_000;
  const s = (sec: number) => t0 + sec * 1000;
  const call = toolCall(s(6), TOOL_CALL_IDS.pendingPublish, "exec_command", {
    cmd: "pnpm publish --access public",
    description: lang === "zh" ? "发布到 npm" : "Publish to npm",
  });
  return {
    running: true,
    pendingApproval: call,
    history: [
      meta(s(0), IDS.sessions.approval, ref, IDS.workspace),
      userText(s(0), c.prompt),
      requestBegin(s(0.3)),
      thinking(s(5), c.thinking),
      call,
    ],
  };
}

/** A short finished exchange for the rows that only fill the list. */
export function shortTranscript(
  lang: Lang,
  sessionId: string,
  startedAt: number,
  ref: ModelRef,
): Transcript {
  const c = COPY[lang].older[sessionId] ?? { prompt: sessionId, answer: "Done." };
  const s = (sec: number) => startedAt + sec * 1000;
  return {
    running: false,
    history: [
      meta(s(0), sessionId, ref, IDS.workspace),
      userText(s(0), c.prompt),
      requestBegin(s(0.3)),
      assistantText(s(6), c.answer),
      tokenUsage(s(6.1), 8_200, 8_200),
      requestEnd(s(6.1)),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// The scripted reply
// ---------------------------------------------------------------------------------------------

/** One step of a script: what to publish, `at` ms after the script starts. */
export interface ScriptStep {
  at: number;
  msg: OmniMessage;
}

/** Splits text into word-sized chunks so a stream reads as one. */
function chunks(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

/**
 * The reply a sent message streams: thinking, one tool call with its output, then the answer,
 * each arriving as the server streams it (fragments first, the complete message closing each),
 * ending with the usage and the request's end. Timestamps are stamped when the step runs.
 */
export function scriptedReply(lang: Lang, callId: string): ScriptStep[] {
  const c = COPY[lang].reply;
  const steps: ScriptStep[] = [];
  let at = 250;
  const push = (msg: OmniMessage) => steps.push({ at, msg });
  const p = (ms: number, payload: Parameters<typeof partial>[1]) => partial(ms, payload);

  push(requestBegin(0));
  at += 300;
  push(p(0, { type: "partial_thinking", role: "assistant", event_type: "start", thinking: "" }));
  for (const chunk of chunks(c.thinking)) {
    at += 70;
    push(
      p(0, { type: "partial_thinking", role: "assistant", event_type: "delta", thinking: chunk }),
    );
  }
  at += 120;
  push(p(0, { type: "partial_thinking", role: "assistant", event_type: "stop", thinking: "" }));
  push(thinking(0, c.thinking));

  at += 400;
  const args = JSON.stringify({ path: "src/rag.ts" });
  push(
    p(0, {
      type: "partial_tool_call",
      role: "assistant",
      event_type: "start",
      name: "read_file",
      arguments: "",
      tool_call_id: callId,
    }),
  );
  at += 200;
  push(
    p(0, {
      type: "partial_tool_call",
      role: "assistant",
      event_type: "delta",
      name: "read_file",
      arguments: args,
      tool_call_id: callId,
    }),
  );
  at += 100;
  push(
    p(0, {
      type: "partial_tool_call",
      role: "assistant",
      event_type: "stop",
      name: "read_file",
      arguments: "",
      tool_call_id: callId,
    }),
  );
  push(toolCall(0, callId, "read_file", { path: "src/rag.ts" }));
  push(requestEnd(0));
  at += 1400;
  push(toolOutput(0, callId, RAG_EXCERPT));
  at += 300;
  push(requestBegin(0));

  at += 500;
  push(p(0, { type: "partial_text", role: "assistant", event_type: "start", text: "" }));
  for (const part of c.text) {
    for (const chunk of chunks(part)) {
      at += 45;
      push(p(0, { type: "partial_text", role: "assistant", event_type: "delta", text: chunk }));
    }
  }
  at += 150;
  push(p(0, { type: "partial_text", role: "assistant", event_type: "stop", text: "" }));
  push(assistantText(0, c.text.join("")));
  push(tokenUsage(0, 51_300, 7_500));
  push(requestEnd(0));
  return steps;
}

/** The title the model gives a conversation after its first turn. */
export const replyTitle = (lang: Lang): string => COPY[lang].reply.title;

/** What the approval session's command says once decided. */
export function approvalOutcome(
  lang: Lang,
  decision: "allow" | "deny",
): {
  output: string;
  text: string;
} {
  const c = COPY[lang].approval;
  return decision === "allow"
    ? {
        output:
          "npm notice publishing @penguinharness/docs-expert@2026.9.14.1\nnpm notice 48.2 KB dist/index.js\n+ @penguinharness/docs-expert@2026.9.14.1",
        text: c.allowed,
      }
    : { output: "Tool call denied by user.", text: c.denied };
}

/** The Markdown answer the streaming Session streams, and the library's streaming board plays. */
export const streamingAnswer = (lang: Lang): string => COPY[lang].streaming.answer;

/** The sentences the thinking session keeps adding, one per beat, cycling. */
export const thinkingBeats = (lang: Lang): readonly string[] => COPY[lang].thinking.sentences;
