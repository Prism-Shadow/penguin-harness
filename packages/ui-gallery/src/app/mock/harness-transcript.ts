/**
 * The demo Session that carries every row the harness writes into a conversation — the notices,
 * banners and dividers that no person typed and no model wrote — so the gallery can frame them
 * in every theme, in the order a real Session produces them:
 *
 * 1. a handoff opener (`[handoff_from]`), then a prompt with skills (`[use_skills]`) and an
 *    attached file (`[attached file: …]`);
 * 2. the first run's MCP connect row, one server connected and one refused;
 * 3. two `run_in_background` commands: the first one's completion notice starts a Task of its
 *    own (the Session sat idle), the second one's fails and is steered into that running Task;
 * 4. a run the weekly schedule fired into the Session (`[scheduled_task]`), whose first request
 *    reconnects once;
 * 5. a reply the person interrupts, then a request the provider refuses outright;
 * 6. the model switch that follows: its summarize compaction (thinking and result) and the
 *    divider the next context's `session_meta` draws;
 * 7. a goal run on the new model: the round-1 protocol behind the person's objective, a steering
 *    message inside that round, the stop hook's injected round 2, and the goal banner;
 * 8. every Task's stats line.
 *
 * Plus the small desk Session an organization's scheduler opened (`[org_trigger]`), which the
 * development list never shows.
 *
 * Every marker block comes from core's own producers, so the rows parse exactly as the harness
 * writes them; the protocol prose inside the blocks stays English, as the harness writes it,
 * while the person's and the model's words follow the frame's language.
 */
import {
  attachedFileLine,
  buildBackgroundTaskDoneMessage,
  buildContextSummaryText,
  buildHandoffMessage,
  buildOrgTriggerMessage,
  buildScheduledMessage,
  buildSkillsMessage,
  markerBlock,
  MARKER_TAGS,
  userSteeringText,
} from "@prismshadow/penguin-core/markers";
import type { BackgroundTaskDone } from "@prismshadow/penguin-core/markers";
import { IDS } from "./ids";
import {
  abortEvent,
  assistantText,
  event,
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
import type { Lang, OmniMessage } from "./types";

const DAY = 86_400_000;
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** The model the Session switches to once DeepSeek refuses it: the Session row's model since. */
export const SWITCHED_MODEL: ModelRef = {
  provider: "anthropic",
  modelId: "claude-sonnet-5",
  contextWindow: 1_000_000,
};

/** Seconds from the scheduled fire to the stop hook ending the goal: the last record. */
const END_SEC = 880;

/**
 * When the harness Session ran. The weekly link check fired into it nine days ago — the fire
 * before the schedule's last one (two days ago, on a seven-day period) — so its activity sits
 * below every other conversation of the list and leaves the rows above it where they were.
 */
export function harnessTimeline(now: number): {
  startedAt: number;
  firedAt: number;
  endedAt: number;
} {
  const firedAt = now - 9 * DAY;
  return { startedAt: firedAt - 100 * MIN, firedAt, endedAt: firedAt + END_SEC * 1000 };
}

/** When the organization's calendar event opened the desk Session, and its last record. */
export function orgDeskTimeline(now: number): { startedAt: number; endedAt: number } {
  const startedAt = now - 3 * DAY - 7 * 3_600_000;
  return { startedAt, endedAt: startedAt + 24_000 };
}

const AGENT_DIR = `/home/demo/.penguin/data/projects/${IDS.project}/agents/${IDS.agents.docs}`;
const SCRATCHPAD = `${AGENT_DIR}/scratchpad/${IDS.sessions.harness}`;
const DRAFT = `${SCRATCHPAD}/release-0.2.13-draft.md`;
const GOAL_FILE = `${SCRATCHPAD}/GOAL.json`;
const SYNC = { id: "proc-5c1e9a0b", cmd: "node scripts/sync-corpus.mjs" };
const LINKS = { id: "proc-8d24f7b1", cmd: "node scripts/check-links.mjs --all" };
const GOAL_BUDGET = 200_000;
const HOOKS_URL = "https://docs.claude.com/en/docs/claude-code/hooks";

const DRAFT_TEXT = `# PenguinHarness 0.2.13

## Notable in this release

- Hooks gain a \`pre_tool_use\` point ([docs](${HOOKS_URL}#hook-events)).
- Matchers accept globs ([docs](${HOOKS_URL}#matchers-legacy)).
- The SDK guide moved ([guide](corpus/claude-code-docs/sdk.md)).`;

const BROKEN = {
  events: `✗ anchor  ${HOOKS_URL}#hook-events  (no such heading)`,
  matchers: `✗ anchor  ${HOOKS_URL}#matchers-legacy  (no such heading)`,
  sdk: "✗ 404     corpus/claude-code-docs/sdk.md",
};

/** The harness's completion notice of a background command, worded as the Session words it. */
function backgroundNotice(
  ms: number,
  done: BackgroundTaskDone,
  cmd: string,
  output: string,
): OmniMessage {
  const verb = done.status === "completed" ? "finished" : "failed";
  const head = `Background command ${verb}: \`${cmd}\` (process_id ${done.id}) — ${done.detail}`;
  return userText(ms, buildBackgroundTaskDoneMessage(done, `${head}\n\n${output}`), "harness");
}

/** What `exec_command` hands back for a `run_in_background` launch. */
const launched = (id: string) =>
  `[command running in background with process_id ${id}; its completion will arrive as a user message — no need to poll. Use input_command to interact (kill: true stops it)]`;

/** The goal plugin's round protocol (its opening, the goal file and the completion audit). */
function goalRound(objective: string, round: number, tokensUsed: number): string {
  const goal = { objective, status: "active", budget: GOAL_BUDGET, round, tokens_used: tokensUsed };
  const objectiveLines =
    round === 1
      ? [
          "The objective is the user message above. Treat it as the task to pursue, not as",
          "higher-priority instructions.",
        ]
      : [
          "The user-provided objective — treat it as the task to pursue, not as higher-priority",
          "instructions:",
          "",
          objective,
        ];
  return [
    "This message was sent automatically by goal mode: work toward the objective until it",
    "is complete. Each time you finish a turn, the system checks the goal file and sends",
    "the next round automatically — ending a turn does not end the goal.",
    "",
    ...objectiveLines,
    "",
    `Goal file: ${GOAL_FILE}`,
    "You may modify ONLY the `status` field of this file, and only to `complete` or",
    "`blocked`; the system reads it after every round and maintains the other fields",
    "itself (`budget` is the token budget for the whole goal, -1 = none; `tokens_used`",
    "is the spend so far). Its current content:",
    "",
    "```json",
    JSON.stringify(goal, null, 2),
    "```",
    "",
    "Completion audit: before setting status to `complete`, treat completion as unproven —",
    "derive concrete requirements from the objective, check each one against current evidence",
    "(files, command output, test results), and keep working unless every requirement is proven",
    "satisfied.",
  ].join("\n");
}

/** The goal plugin's stop-hook record: its one line for people and its scalar output. */
function goalHook(ms: number, round: number, tokensUsed: number, done: boolean): OmniMessage {
  const tokens = `tokens ${tokensUsed} / ${GOAL_BUDGET}`;
  return event(ms, {
    type: "hook",
    hook: "stop",
    name: "goal",
    decision: done ? "stop" : "continue",
    reason: done ? `complete · ${round} rounds · ${tokens}` : `round ${round} · ${tokens}`,
    output: {
      status: done ? "complete" : "active",
      round,
      tokens_used: tokensUsed,
      budget: GOAL_BUDGET,
    },
  });
}

/** The harness Session's whole Trace, both contexts, as the history read returns it. */
export function harnessTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const L = <T>(zh: T, en: T): T => (lang === "zh" ? zh : en);
  const { startedAt, firedAt } = harnessTimeline(now);
  const a = (sec: number) => startedAt + sec * 1000;
  const b = (sec: number) => firedAt + sec * 1000;
  const id = IDS.sessions.harness;
  const objective = L(
    "把草稿里坏掉的三条链接修好，一直做到 check-links 全部通过。",
    "Fix the three broken links in the draft, and keep going until check-links passes.",
  );
  const summary = L(
    `用户从发布说明助手交接过来，要修好 0.2.13 发布说明草稿（${DRAFT}）里的链接。
- 语料库已同步：上游改了 hooks.md 和 mcp.md，sdk.md 改名为 agent-sdk.md。
- 草稿里坏掉的三条：hooks#hook-events（现为 #hook-points）、hooks#matchers-legacy（并入 #matchers）、sdk.md（现为 agent-sdk.md）。
- 不要改写 hooks.md 的导语。`,
    `The user, handed over from Release Notes, wants the links in the 0.2.13 release-notes draft (${DRAFT}) fixed.
- The corpus is synced: hooks.md and mcp.md changed upstream, and sdk.md was renamed agent-sdk.md.
- Broken in the draft: hooks#hook-events (now #hook-points), hooks#matchers-legacy (merged into #matchers), sdk.md (now agent-sdk.md).
- Do not rewrite the hooks.md intro.`,
  );
  const checkLinks = (description: string) => ({ cmd: LINKS.cmd, description });

  const history: OmniMessage[] = [
    // ---- The handoff, the prompt and the first run's bootstrap -------------------------------
    meta(a(0), id, ref, IDS.workspace),
    userText(
      a(0),
      buildHandoffMessage({
        agentId: IDS.agents.notes,
        agentName: L("发布说明助手", "Release Notes"),
        sessionId: IDS.sessions.notes[0],
        sessionTitle: L("0.2.13 发布说明", "0.2.13 release notes"),
        workspace: "/home/demo/projects/release-notes",
      }),
    ),
    userText(
      a(0),
      `${buildSkillsMessage(
        ["claude-code-expert", "docs-sync"],
        L(
          "0.2.13 的发布说明引用了 corpus/claude-code-docs/hooks.md。先从上游同步语料库，再检查附件草稿里的每条链接是否还能打开，告诉我哪些坏了。",
          "The 0.2.13 notes cite corpus/claude-code-docs/hooks.md. Sync the corpus from upstream, check that every link in the attached draft still opens, and tell me what broke.",
        ),
      )}\n\n${attachedFileLine(DRAFT)}`,
    ),
    event(a(0.2), { type: "mcp_connect_begin", servers: ["filesystem", "docs-search"] }),
    event(a(1.6), {
      type: "mcp_connect_end",
      status: "fatal",
      results: [
        {
          server: "filesystem",
          transport: "stdio",
          status: "completed",
          duration_ms: 640,
          tools: 3,
        },
        {
          server: "docs-search",
          transport: "http",
          status: "fatal",
          duration_ms: 1_380,
          error_code: "connect_failed",
          error_message: "fetch failed: connect ECONNREFUSED 127.0.0.1:8765",
        },
      ],
    }),
    event(a(1.7), {
      type: "tool_list_ready",
      tools: [
        { name: "read_file", description: "Read a file from the Workspace." },
        { name: "edit_file", description: "Replace one exact string in a file." },
        { name: "exec_command", description: "Run a shell command in the Workspace." },
        {
          name: "mcp__filesystem__read_text_file",
          description: "Read a file as text, optionally its first or last lines.",
        },
        {
          name: "mcp__filesystem__list_directory",
          description: "List the entries of a directory.",
        },
        {
          name: "mcp__filesystem__search_files",
          description: "Find files whose names match a pattern.",
        },
      ],
    }),

    // ---- Task: read the draft, start both jobs in the background -----------------------------
    requestBegin(a(2)),
    thinking(
      a(8),
      L(
        "草稿既链到 corpus/ 也链到上游文档站。先同步更要紧：今天 404 的链接上游可能已经修了。同步和链接检查都要跑一阵，放到后台，同时先读草稿。",
        "The draft links into corpus/ and to the upstream docs site. Syncing first matters: a link that breaks today may already be fixed upstream. Both the sync and the link check take a while, so they go to the background while I read the draft.",
      ),
    ),
    toolCall(a(9), "call_read_draft", "read_file", { path: DRAFT }),
    requestEnd(a(9.1)),
    toolOutput(a(9.4), "call_read_draft", DRAFT_TEXT),
    requestBegin(a(9.8)),
    toolCall(a(14), "call_sync", "exec_command", {
      cmd: SYNC.cmd,
      description: L("同步语料库", "Sync the corpus"),
      run_in_background: true,
    }),
    toolCall(a(14.5), "call_links", "exec_command", {
      ...checkLinks(L("检查全部链接", "Check every link")),
      run_in_background: true,
    }),
    requestEnd(a(14.6)),
    toolOutput(a(14.9), "call_sync", launched(SYNC.id)),
    toolOutput(a(15), "call_links", launched(LINKS.id)),
    requestBegin(a(15.3)),
    assistantText(
      a(24),
      L(
        `两个任务都在后台跑：语料库同步（\`${SYNC.id}\`）和链接检查（\`${LINKS.id}\`）。草稿一共三条链接，两条指向 \`hooks.md\` 的小节，一条指向 SDK 指南；两边都跑完我再汇报。`,
        `Both jobs are running in the background: the corpus sync (\`${SYNC.id}\`) and the link check (\`${LINKS.id}\`). The draft has three links — two into sections of \`hooks.md\`, one to the SDK guide; I'll report once both finish.`,
      ),
    ),
    tokenUsage(a(24.1), 21_600, 8_100),
    requestEnd(a(24.1)),

    // ---- Task: the sync's notice starts it; the link check's failure is steered in -----------
    backgroundNotice(
      a(190),
      { kind: "command", id: SYNC.id, status: "completed", detail: "exit code 0" },
      SYNC.cmd,
      [
        "Synced 214 Markdown files from upstream.",
        "  changed  corpus/claude-code-docs/hooks.md",
        "  changed  corpus/claude-code-docs/mcp.md",
        "  renamed  corpus/claude-code-docs/sdk.md → corpus/claude-code-docs/agent-sdk.md",
      ].join("\n"),
    ),
    requestBegin(a(190.3)),
    thinking(
      a(195),
      L(
        "上游改了 hooks.md，草稿引用的锚点可能已经挪了位置。先看新的小节标题。",
        "hooks.md changed upstream, so the anchors the draft cites may have moved. Let me look at the new headings.",
      ),
    ),
    toolCall(a(196), "call_read_hooks", "read_file", { path: "corpus/claude-code-docs/hooks.md" }),
    requestEnd(a(196.1)),
    toolOutput(
      a(196.4),
      "call_read_hooks",
      "# Hooks\n\n## Configure hooks\n## Hook points\n## Matchers\n## Debugging hooks",
    ),
    backgroundNotice(
      a(197),
      {
        kind: "command",
        id: LINKS.id,
        status: "failed",
        detail: "exit code 1",
        delivery: "steering",
      },
      LINKS.cmd,
      [BROKEN.events, BROKEN.matchers, BROKEN.sdk, "211 links checked, 3 broken."].join("\n"),
    ),
    requestBegin(a(197.2)),
    assistantText(
      a(214),
      L(
        `同步完成；链接检查在 211 条里发现 3 条坏链，正好都在草稿里：

| 链接 | 上游的变化 |
| --- | --- |
| \`hooks#hook-events\` | 这一节现在叫 **Hook points** |
| \`hooks#matchers-legacy\` | 并入了 **Matchers** |
| \`sdk.md\` | 改名为 \`agent-sdk.md\` |

\`corpus/claude-code-docs/hooks.md\` 里的其他链接都还能打开。`,
        `The sync finished, and the link check failed on 3 of 211 links — all three of them in the draft:

| Link | What changed upstream |
| --- | --- |
| \`hooks#hook-events\` | the section is now **Hook points** |
| \`hooks#matchers-legacy\` | merged into **Matchers** |
| \`sdk.md\` | renamed to \`agent-sdk.md\` |

Every other link in \`corpus/claude-code-docs/hooks.md\` still resolves.`,
      ),
    ),
    tokenUsage(a(214.1), 33_900, 9_400),
    requestEnd(a(214.1)),

    // ---- Task: the weekly schedule fires; the first request reconnects once -------------------
    userText(
      b(0),
      buildScheduledMessage(
        "weekly-link-check",
        iso(firedAt),
        L("检查语料库里的所有链接。", "Check every link in the corpus."),
      ),
      "server",
    ),
    requestBegin(b(0.3)),
    event(b(6.3), {
      type: "request_end",
      status: "retryable",
      error_code: "network",
      error_message: "503 Service Unavailable: upstream connect error",
      attempt: 1,
      retry_in_ms: 4_000,
    }),
    requestBegin(b(10.3)),
    toolCall(
      b(13),
      "call_weekly_links",
      "exec_command",
      checkLinks(L("检查全部链接", "Check every link")),
    ),
    event(b(13.1), { type: "request_end", status: "completed", attempt: 2 }),
    toolOutput(
      b(41),
      "call_weekly_links",
      [BROKEN.events, BROKEN.matchers, BROKEN.sdk, "211 links checked, 3 broken."].join("\n"),
    ),
    requestBegin(b(41.3)),
    assistantText(
      b(47),
      L(
        "坏的还是之前那 3 条，这周没有新坏掉的链接。",
        "The same three links as before are broken; nothing new broke this week.",
      ),
    ),
    tokenUsage(b(47.1), 45_200, 9_800),
    requestEnd(b(47.1)),

    // ---- Task: the person interrupts the reply ------------------------------------------------
    userText(
      b(600),
      L("顺便把 hooks.md 的导语也改写一下。", "Rewrite the intro of hooks.md while you're at it."),
    ),
    requestBegin(b(600.3)),
    assistantText(
      b(607),
      L(
        "导语现在先介绍各个钩子点，再引导读者去看",
        "The intro now opens with the hook points and sends readers to",
      ),
      "aborted",
    ),
    event(b(607.1), { type: "request_end", status: "aborted" }),
    abortEvent(b(607.1)),

    // ---- Task: the provider refuses the request ----------------------------------------------
    userText(
      b(660),
      L(
        "导语别动了，只修草稿里那三条链接。",
        "Leave the intro alone — just fix the three links in the draft.",
      ),
    ),
    requestBegin(b(660.3)),
    event(b(662.8), {
      type: "request_end",
      status: "fatal",
      error_code: "rejected",
      error_message: "402 Insufficient Balance",
    }),

    // ---- The model switch: a summarize compaction, then the next context on the new model -----
    event(b(720), {
      type: "compaction_begin",
      reason: "manual",
      mode: "summarize",
      context: 9_800,
      turns: 10,
    }),
    requestBegin(b(720.2)),
    thinking(
      b(727),
      L(
        "下一个上下文需要：草稿的路径、三条坏链和上游各自换成了什么，以及用户说过不要改 hooks.md 的导语。",
        "The next context needs the draft's path, the three broken links and what replaced each upstream, and that the user asked to leave the hooks.md intro alone.",
      ),
    ),
    assistantText(b(741), markerBlock(MARKER_TAGS.summary, summary)),
    tokenUsage(b(741.1), 54_100, 8_900),
    requestEnd(b(741.1)),
    event(b(741.3), {
      type: "compaction_end",
      reason: "manual",
      mode: "summarize",
      status: "completed",
    }),
    meta(b(741.4), id, SWITCHED_MODEL, IDS.workspace),

    // ---- Goal round 1: the objective, the protocol behind it, a steering message inside ------
    userText(b(780), buildContextSummaryText(summary)),
    userText(b(780), objective),
    userText(b(780), goalRound(objective, 1, 0), "harness"),
    requestBegin(b(780.4)),
    thinking(
      b(787),
      L(
        "摘要里三条都列了。两个锚点是直接改名；SDK 指南要换成新文件名。",
        "The summary lists all three. The two anchors are a straight rename; the SDK guide needs its new file name.",
      ),
    ),
    toolCall(b(789), "call_fix_events", "edit_file", {
      path: DRAFT,
      old_string: "hooks#hook-events",
      new_string: "hooks#hook-points",
    }),
    toolCall(b(789.3), "call_fix_matchers", "edit_file", {
      path: DRAFT,
      old_string: "hooks#matchers-legacy",
      new_string: "hooks#matchers",
    }),
    requestEnd(b(789.4)),
    toolOutput(b(789.6), "call_fix_events", "Edited release-0.2.13-draft.md (+1 -1)."),
    toolOutput(b(789.7), "call_fix_matchers", "Edited release-0.2.13-draft.md (+1 -1)."),
    userText(
      b(789.8),
      userSteeringText(L("用新的锚点，别用重定向。", "Use the new anchors, not redirects.")),
    ),
    requestBegin(b(790)),
    toolCall(
      b(793),
      "call_round1_links",
      "exec_command",
      checkLinks(L("重新检查链接", "Re-check the links")),
    ),
    requestEnd(b(793.1)),
    toolOutput(b(821), "call_round1_links", `${BROKEN.sdk}\n211 links checked, 1 broken.`),
    requestBegin(b(821.3)),
    assistantText(
      b(829),
      L(
        "两个锚点都指向了新的小节（`#hook-points`、`#matchers`）。还剩一条：`sdk.md` 在上游改名为 `agent-sdk.md`，下一轮处理。",
        "Both anchors now point at the new headings (`#hook-points`, `#matchers`). One link is still broken: `sdk.md`, renamed upstream to `agent-sdk.md` — that one is next.",
      ),
    ),
    tokenUsage(b(829.1), 79_800, 13_700),
    requestEnd(b(829.1)),
    goalHook(b(829.6), 2, 18_200, false),

    // ---- Goal round 2: injected by the stop hook; the goal ends complete ---------------------
    userText(b(830), goalRound(objective, 2, 18_200), "harness"),
    requestBegin(b(830.4)),
    thinking(
      b(835),
      L(
        "第 2 轮：只剩 SDK 那条。修好、重跑检查，通过了才把目标标为完成。",
        "Round 2: only the SDK link is left. Fix it, re-run the check, and mark the goal complete only if it passes.",
      ),
    ),
    toolCall(b(836), "call_fix_sdk", "edit_file", {
      path: DRAFT,
      old_string: "(corpus/claude-code-docs/sdk.md)",
      new_string: "(corpus/claude-code-docs/agent-sdk.md)",
    }),
    requestEnd(b(836.1)),
    toolOutput(b(836.4), "call_fix_sdk", "Edited release-0.2.13-draft.md (+1 -1)."),
    requestBegin(b(836.7)),
    toolCall(
      b(839),
      "call_round2_links",
      "exec_command",
      checkLinks(L("重新检查链接", "Re-check the links")),
    ),
    requestEnd(b(839.1)),
    toolOutput(b(866), "call_round2_links", "211 links checked, 0 broken."),
    requestBegin(b(866.3)),
    toolCall(b(869), "call_goal_done", "edit_file", {
      path: GOAL_FILE,
      old_string: '"status": "active"',
      new_string: '"status": "complete"',
    }),
    requestEnd(b(869.1)),
    toolOutput(b(869.4), "call_goal_done", "Edited GOAL.json (+1 -1)."),
    requestBegin(b(869.7)),
    assistantText(
      b(878),
      L(
        "211 条链接现在都能打开。草稿的三条引用分别指向 `hooks#hook-points`、`hooks#matchers` 和 `corpus/claude-code-docs/agent-sdk.md`，目标已标为完成。",
        "All 211 links open now. The draft's three citations point at `hooks#hook-points`, `hooks#matchers` and `corpus/claude-code-docs/agent-sdk.md`, and the goal is marked complete.",
      ),
    ),
    tokenUsage(b(878.1), 101_400, 15_200),
    requestEnd(b(878.1)),
    goalHook(b(END_SEC), 2, 31_900, true),
  ];

  return {
    running: false,
    history,
    // The banner as it reads the moment the goal settles: the server tells only a page that was
    // open then, the demo tells every visit, so the banner is there to be framed.
    goalEvents: [
      { type: "goal_started", sessionId: id, objective, budget: GOAL_BUDGET },
      { type: "goal_finished", sessionId: id, outcome: "complete", rounds: 2, used: 31_900 },
    ],
  };
}

/** The desk Session an organization's calendar event opened for the release-notes Agent. */
export function orgDeskTranscript(lang: Lang, now: number, ref: ModelRef): Transcript {
  const L = <T>(zh: T, en: T): T => (lang === "zh" ? zh : en);
  const { startedAt } = orgDeskTimeline(now);
  const s = (sec: number) => startedAt + sec * 1000;
  const weekAgo = iso(startedAt - 7 * DAY).slice(0, 10);
  const sessionMeta: OmniMessage = {
    timestamp: iso(s(0)),
    type: "session_meta",
    payload: {
      session_id: IDS.sessions.orgDesk,
      provider: ref.provider,
      model_id: ref.modelId,
      model_context_window: ref.contextWindow,
      system_prompt:
        "You are Release Notes. Draft release notes from the changelog, in both languages.",
      agent_state: `/home/demo/.penguin/data/projects/${IDS.project}/agents/${IDS.agents.notes}/agent_state`,
      workspace: "/home/demo/projects/release-notes",
      // A desk Session is a person's conversation; its row's `org` client is what marks it.
      source: "user",
    },
  };
  return {
    running: false,
    history: [
      sessionMeta,
      userText(
        s(0),
        buildOrgTriggerMessage(
          {
            org: "docs-team",
            employee: `${IDS.agents.notes} (Release editor, reports to ${IDS.agents.docs})`,
            kind: "event",
            event: "weekly-digest",
            firedAt: iso(s(0)),
            budget: "1.84 / 10.00 USD (18%)",
          },
          L(
            "汇总本周合并的 PR，整理成一段发布摘要。",
            "Summarize the PRs merged this week as a short release digest.",
          ),
        ),
        "server",
      ),
      requestBegin(s(0.3)),
      thinking(
        s(4),
        L(
          "先列出本周合并的 PR，再按用户能感知到的变化分组。",
          "List this week's merged PRs first, then group them by what a user would notice.",
        ),
      ),
      toolCall(s(5), "call_merged", "exec_command", {
        cmd: `gh pr list --state merged --search 'merged:>=${weekAgo}' --limit 20`,
        description: L("列出本周合并的 PR", "List this week's merged PRs"),
      }),
      requestEnd(s(5.1)),
      toolOutput(
        s(7),
        "call_merged",
        "#812  Hooks: a pre_tool_use point\n#809  Matchers accept globs\n#804  Fix the SDK guide links",
      ),
      requestBegin(s(7.3)),
      assistantText(
        s(23.9),
        L(
          "本周合并 3 个 PR：hooks 新增 `pre_tool_use` 钩子点（#812），匹配器支持通配符（#809），SDK 指南的链接已修复（#804）。",
          "Three PRs merged this week: hooks gain a `pre_tool_use` point (#812), matchers accept globs (#809), and the SDK guide's links are fixed (#804).",
        ),
      ),
      tokenUsage(s(24), 6_900, 6_900),
      requestEnd(s(24)),
    ],
  };
}
