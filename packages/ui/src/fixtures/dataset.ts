/**
 * Assembles one locale's dataset from its prose and the shared, locale-independent values in
 * `shared.ts`. The structure — which items a turn holds, in what order, with which ids, states
 * and numbers — lives here once, so `en` and `zh` cannot drift apart in shape: a locale file
 * supplies words, never structure.
 */
import {
  ACCENT_SWATCHES,
  AGENT_ID,
  APP_URL,
  BM25_FORMULA,
  CHANNEL_MESSAGES,
  CMD_APP,
  CMD_COLLECT,
  CMD_TEST,
  EDIT_ARGS,
  EDIT_DIFF,
  INDEX_HTML_PATH,
  MODEL_ROWS,
  OUTPUT_APP,
  OUTPUT_COLLECT,
  OUTPUT_EDIT,
  OUTPUT_READ,
  OUTPUT_READ_INDEX,
  OUTPUT_TEST_FAILED,
  OUTPUT_WRITE,
  PANEL_MENU,
  PLUGIN_LIBRARY,
  RAG_PATH,
  RAG_TS_AFTER,
  MESSAGE_MENU,
  PALETTE_COMMANDS,
  PLUGIN_KEYS,
  PLUGIN_ROWS,
  READ_LIMIT,
  READ_OFFSET,
  REVIEWER_AGENT_ID,
  RUN_COMMAND,
  SESSION_ID,
  SLASH_COMMANDS,
  SUBAGENT_SESSION_ID,
  TEST_PATH,
  TEST_TS,
  TREE_BLOCK,
  TURN1_LANES,
  TURN1_SPAN_MS,
  TURN2_LANES,
  TURN2_SPAN_MS,
  TURN2_START_MS,
  USAGE_SERIES,
  USER_ID,
  VAULT_KEYS,
  VAULT_ROWS,
  WORKSPACE,
  WRITE_DIFF,
  clock,
  iso,
  workspaceTree,
} from "./shared";
import type { PluginKey, VaultKey } from "./shared";
import type { ToneName } from "../tokens";
import type {
  AppCopy,
  CalendarEventFixture,
  ChatItem,
  CommandGroupFixture,
  DocsAnswerFixture,
  EmployeeFixture,
  FixtureAgent,
  FixtureLang,
  Fixtures,
  FormFieldFixture,
  FormGroupFixture,
  MenuEntryFixture,
  NoticeFixture,
  PlanStepFixture,
  PluginFixture,
  TicketFixture,
  ToolCallItem,
  TypeSpecimens,
  VaultEntryFixture,
} from "./types";

/** Everything a locale writes. Keys name the slot a string fills; see `buildFixtures`. */
export interface FixtureProse {
  copy: AppCopy;
  userName: string;
  agents: Record<"default" | "reviewer", Omit<FixtureAgent, "id">>;
  session: {
    title: string;
    turn1: {
      prompt: string;
      thinking1: string;
      text1: string;
      collectDescription: string;
      thinking2: string;
      text2: string;
      appDescription: string;
      /** The settled answer; `{tree}`, `{run}` and `{url}` are filled from the shared values. */
      answer: string;
    };
    turn2: {
      prompt: string;
      thinking: string;
      editDescription: string;
      writeDescription: string;
      text: string;
      thinking2: string;
      reviewDescription: string;
      reviewPrompt: string;
      testDescription: string;
      /** The reviewer's own run: its thinking, and the reply still streaming in. */
      reviewThinking: string;
      reviewReadDescription: string;
      reviewReply: string;
      /** What the agent says when the citation test fails on a file renamed upstream. */
      failedReply: string;
    };
    draft: string;
  };
  /** Titles and relative times of the other sessions in the sidebar. */
  sidebar: {
    groupWorkspace: string;
    groupEarlier: string;
    now: string;
    rows: Record<
      "tokenizer" | "hooks" | "trace" | "weekly" | "deploy",
      { title: string; time: string }
    >;
  };
  modelNotes: Partial<Record<string, string>>;
  notesFileName: string;
  company: {
    orgName: string;
    mission: string;
    employees: Record<"ceo" | "eng" | "docs" | "qa" | "ops", { name: string; title: string }>;
    tickets: Record<
      "citations" | "tokenizer" | "zhQueries" | "deploy" | "evalSet" | "cache" | "pdf" | "readme",
      { title: string; blocked?: string }
    >;
    events: Record<
      "standup" | "triage" | "review" | "evalRun" | "retro" | "report",
      { title: string; prompt: string }
    >;
    /** The group chat's messages, one per entry of `CHANNEL_MESSAGES`. */
    channel: Record<(typeof CHANNEL_MESSAGES)[number]["key"], string>;
  };
  /**
   * The sets K-redesign §4.6 adds. Only their words live here: the colours, versions, icons,
   * shortcuts and series are locale-independent and come from `shared.ts`.
   */
  notices: {
    /** One per tone, in the contract's order: success, attention, danger, done, neutral, info. */
    byTone: Readonly<Record<ToneName, { title: string; body: string; action?: string }>>;
    toasts: readonly { tone: ToneName; title: string; body: string; action?: string }[];
  };
  forms: {
    title: string;
    description: string;
    /** In render order; exactly one carries `error` and exactly one is `disabled`. */
    fields: readonly FormFieldFixture[];
    search: { label: string; placeholder: string };
    groups: readonly FormGroupFixture[];
    errorSummary: string;
    submit: string;
    cancel: string;
    /** One label per preset in `ACCENT_SWATCHES`, in its order. */
    swatchLabels: readonly string[];
  };
  menus: Record<"copy" | "fork" | "export" | "delete", string> & {
    panels: Record<(typeof PANEL_MENU)[number]["key"], { label: string; description: string }>;
  };
  slashCommands: Record<(typeof SLASH_COMMANDS)[number]["key"], string>;
  docsAnswer: Omit<DocsAnswerFixture, "formula">;
  vault: Record<VaultKey, { kind: string; updated: string }>;
  plugins: Record<PluginKey, { description: string }>;
  palette: {
    groups: Record<"commands" | "sessions", string>;
    commands: Record<"newChat" | "switchModel" | "settings" | "search", string>;
    hints: Record<"newChat" | "switchModel" | "settings" | "search", string>;
    /** The two Sessions the palette offers, with when they last ran. */
    sessions: readonly { title: string; hint: string }[];
  };
  usage: {
    days: readonly string[];
    buckets: Record<"cacheRead" | "cacheWrite" | "output", string>;
  };
  specimens: TypeSpecimens;
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);

export function buildFixtures(lang: FixtureLang, prose: FixtureProse): Fixtures {
  const { copy, session: s } = prose;
  const t1 = s.turn1;
  const t2 = s.turn2;
  const at = (offsetMs: number) => iso(offsetMs);

  const agents: FixtureAgent[] = [
    { id: AGENT_ID, ...prose.agents.default },
    { id: REVIEWER_AGENT_ID, ...prose.agents.reviewer },
  ];

  const answer = t1.answer
    .replace("{tree}", TREE_BLOCK)
    .replace("{run}", RUN_COMMAND)
    .replace("{url}", APP_URL);

  const e = prose.company.employees;
  const employees: EmployeeFixture[] = [
    { agentId: "ceo", ...e.ceo, reportsTo: null, state: "idle", budgetUsd: 120, spendUsd: 41.37 },
    {
      agentId: "rag-engineer",
      ...e.eng,
      reportsTo: "ceo",
      state: "running",
      budgetUsd: 60,
      spendUsd: 27.9,
    },
    {
      agentId: "docs-curator",
      ...e.docs,
      reportsTo: "ceo",
      state: "idle",
      budgetUsd: 20,
      spendUsd: 6.12,
    },
    { agentId: "qa-lead", ...e.qa, reportsTo: "rag-engineer", state: "running", spendUsd: 4.83 },
    {
      agentId: "release-ops",
      ...e.ops,
      reportsTo: "ceo",
      state: "paused",
      budgetUsd: 5,
      spendUsd: 5.02,
    },
  ];

  const tk = prose.company.tickets;
  const tickets: TicketFixture[] = [
    {
      ticketId: "2026-09-14-citation-links",
      ...tk.citations,
      status: "in_progress",
      ownerAgentId: "rag-engineer",
      priority: "P0",
      dueIso: "2026-09-16",
      running: true,
      costUsd: 2.31,
      sessionCount: 2,
    },
    {
      ticketId: "2026-09-13-tokenizer-flake",
      ...tk.tokenizer,
      status: "review",
      ownerAgentId: "qa-lead",
      priority: "P1",
      running: false,
      costUsd: 0.87,
      sessionCount: 1,
    },
    {
      ticketId: "2026-09-12-chinese-queries",
      ...tk.zhQueries,
      status: "in_progress",
      ownerAgentId: "docs-curator",
      priority: "P1",
      dueIso: "2026-09-18",
      running: false,
      costUsd: 1.46,
      sessionCount: 3,
    },
    {
      ticketId: "2026-09-15-deploy-preview",
      ...tk.deploy,
      status: "proposed",
      ownerAgentId: "release-ops",
      priority: "P2",
      running: false,
      costUsd: 0,
      sessionCount: 0,
    },
    {
      ticketId: "2026-09-15-eval-set",
      ...tk.evalSet,
      status: "proposed",
      ownerAgentId: "qa-lead",
      priority: "P1",
      dueIso: "2026-09-22",
      running: false,
      costUsd: 0,
      sessionCount: 0,
    },
    {
      ticketId: "2026-09-10-prompt-cache",
      ...tk.cache,
      status: "done",
      ownerAgentId: "rag-engineer",
      priority: "P1",
      running: false,
      costUsd: 3.08,
      sessionCount: 2,
    },
    {
      ticketId: "2026-09-09-pdf-ingest",
      ...tk.pdf,
      status: "rejected",
      ownerAgentId: "docs-curator",
      priority: "P2",
      running: false,
      costUsd: 0.42,
      sessionCount: 1,
    },
    {
      ticketId: "2026-09-11-readme-quickstart",
      ...tk.readme,
      status: "done",
      ownerAgentId: "docs-curator",
      priority: "P2",
      running: false,
      costUsd: 0.64,
      sessionCount: 1,
    },
  ];

  const ev = prose.company.events;
  const events: CalendarEventFixture[] = [
    {
      name: "daily-standup",
      agentId: "ceo",
      ...ev.standup,
      startAtIso: "2026-09-14T01:00:00.000Z",
      durationMin: 30,
      period: "1d",
      enabled: true,
      nextFireAtIso: "2026-09-17T01:00:00.000Z",
      lastOutcome: "fired",
    },
    {
      name: "ticket-triage",
      agentId: "rag-engineer",
      ...ev.triage,
      startAtIso: "2026-09-14T02:00:00.000Z",
      durationMin: 45,
      period: "1d",
      enabled: true,
      nextFireAtIso: "2026-09-17T02:00:00.000Z",
      lastOutcome: "queued",
    },
    {
      name: "code-review",
      agentId: "qa-lead",
      ...ev.review,
      startAtIso: "2026-09-15T06:00:00.000Z",
      durationMin: 60,
      period: "2d",
      enabled: true,
      nextFireAtIso: "2026-09-17T06:00:00.000Z",
      lastOutcome: "fired",
    },
    {
      name: "eval-run",
      agentId: "qa-lead",
      ...ev.evalRun,
      startAtIso: "2026-09-16T08:30:00.000Z",
      durationMin: 90,
      enabled: true,
      nextFireAtIso: "2026-09-16T08:30:00.000Z",
    },
    {
      name: "weekly-retro",
      agentId: "ceo",
      ...ev.retro,
      startAtIso: "2026-09-18T09:00:00.000Z",
      durationMin: 60,
      period: "7d",
      enabled: true,
      nextFireAtIso: "2026-09-18T09:00:00.000Z",
      lastOutcome: "missed",
    },
    {
      name: "spend-report",
      agentId: "release-ops",
      ...ev.report,
      startAtIso: "2026-09-19T03:00:00.000Z",
      durationMin: 30,
      period: "7d",
      enabled: false,
      lastOutcome: "paused",
    },
  ];

  const sb = prose.sidebar;

  const data: Omit<Fixtures, "plan" | "failedRun"> = {
    lang,
    copy,
    user: { id: USER_ID, name: prose.userName, isAdmin: true },
    agents,
    session: {
      id: SESSION_ID,
      title: s.title,
      agentId: AGENT_ID,
      model: { provider: "deepseek", modelId: "deepseek-v4-pro" },
      workspace: WORKSPACE,
      runCommand: RUN_COMMAND,
      createdAtIso: at(0),
      running: true,
      totals: { tokens: 43_830, costUsd: 0.0231, elapsedMs: 71_840 },
      context: { tokens: 27_310, window: 1_000_000 },
      composer: {
        draft: s.draft,
        chips: [
          { kind: "file", label: "src/rag.ts", lines: "L37-40" },
          { kind: "skill", label: "penguin-sdk" },
        ],
        approvalMode: "read-only",
        thinkingLevel: "medium",
      },
      turns: [
        {
          index: 1,
          running: false,
          items: [
            { kind: "user", id: "u1", text: t1.prompt, atIso: at(0) },
            { kind: "thinking", id: "th1", text: t1.thinking1, state: "done", durationMs: 2_380 },
            { kind: "text", id: "tx1", markdown: t1.text1, atIso: at(2_380) },
            {
              kind: "tool_call",
              id: "tc1",
              toolCallId: "call_01J8Z6K2WQ",
              name: "exec_command",
              alias: copy.chat.toolAliases.exec_command,
              subtitle: t1.collectDescription,
              state: "done",
              durationMs: 15_790,
              argumentsJson: json({ cmd: CMD_COLLECT, description: t1.collectDescription }),
              output: OUTPUT_COLLECT,
              decision: { verdict: "allow", source: "auto" },
            },
            { kind: "thinking", id: "th2", text: t1.thinking2, state: "done", durationMs: 1_890 },
            { kind: "text", id: "tx2", markdown: t1.text2, atIso: at(20_310) },
            {
              kind: "tool_call",
              id: "tc2",
              toolCallId: "call_01J8Z6M9FD",
              name: "exec_command",
              alias: copy.chat.toolAliases.exec_command,
              subtitle: t1.appDescription,
              state: "done",
              durationMs: 1_360,
              argumentsJson: json({ cmd: CMD_APP, description: t1.appDescription }),
              output: OUTPUT_APP,
              decision: { verdict: "allow", source: "auto" },
            },
            { kind: "text", id: "tx3", markdown: answer, atIso: at(22_040) },
          ],
          stats: {
            toolCalls: 2,
            inputTokens: 15_620,
            cacheReadTokens: 12_410,
            cacheWriteTokens: 3_210,
            outputTokens: 1_938,
            costUsd: 0.0121,
            elapsedMs: TURN1_SPAN_MS,
            outputTps: 71,
          },
        },
        {
          index: 2,
          running: true,
          items: [
            {
              kind: "user",
              id: "u2",
              text: t2.prompt,
              atIso: at(TURN2_START_MS),
              attachments: [{ kind: "file", label: "src/rag.ts", lines: "L37-40" }],
            },
            { kind: "thinking", id: "th3", text: t2.thinking, state: "done", durationMs: 3_140 },
            {
              kind: "tool_call",
              id: "tc3",
              toolCallId: "call_01J8Z7A1XR",
              name: "read_file",
              alias: copy.chat.toolAliases.read_file,
              subtitle: "…/src/rag.ts",
              state: "done",
              durationMs: 421,
              argumentsJson: json({ file_path: RAG_PATH, offset: READ_OFFSET, limit: READ_LIMIT }),
              output: OUTPUT_READ,
              decision: { verdict: "allow", source: "auto" },
            },
            {
              kind: "tool_call",
              id: "tc4",
              toolCallId: "call_01J8Z7C4NB",
              name: "edit_file",
              alias: copy.chat.toolAliases.edit_file,
              subtitle: t2.editDescription,
              state: "done",
              durationMs: 1_444,
              argumentsJson: json({
                description: t2.editDescription,
                file_path: RAG_PATH,
                old_string: EDIT_ARGS.oldString,
                new_string: EDIT_ARGS.newString,
              }),
              output: OUTPUT_EDIT,
              decision: { verdict: "allow", source: "manual" },
              diff: EDIT_DIFF,
            },
            {
              kind: "tool_call",
              id: "tc5",
              toolCallId: "call_01J8Z7H6QK",
              name: "write_file",
              alias: copy.chat.toolAliases.write_file,
              subtitle: t2.writeDescription,
              state: "done",
              durationMs: 3_653,
              argumentsJson: json({
                description: t2.writeDescription,
                file_path: TEST_PATH,
                content: TEST_TS,
              }),
              output: OUTPUT_WRITE,
              decision: { verdict: "allow", source: "manual" },
              diff: WRITE_DIFF,
            },
            { kind: "text", id: "tx4", markdown: t2.text, atIso: at(TURN2_START_MS + 10_720) },
            { kind: "thinking", id: "th4", text: t2.thinking2, state: "done", durationMs: 470 },
            {
              kind: "tool_call",
              id: "tc6",
              toolCallId: "call_01J8Z7P0TE",
              name: "run_subagent",
              alias: copy.chat.toolAliases.run_subagent,
              subtitle: t2.reviewDescription,
              state: "running",
              elapsedMs: TURN2_SPAN_MS - 11_640,
              argumentsJson: json({
                description: t2.reviewDescription,
                agent_id: REVIEWER_AGENT_ID,
                prompt: t2.reviewPrompt,
              }),
              decision: { verdict: "allow", source: "auto" },
              subagent: {
                sessionId: SUBAGENT_SESSION_ID,
                shortId: SUBAGENT_SESSION_ID.slice(-6),
                agentId: REVIEWER_AGENT_ID,
                agentName: prose.agents.reviewer.name,
                running: true,
                pendingApproval: false,
                task: t2.reviewDescription,
                transcript: [
                  {
                    kind: "user",
                    id: "sub-u1",
                    text: t2.reviewPrompt,
                    atIso: at(TURN2_START_MS + 11_780),
                  },
                  {
                    kind: "thinking",
                    id: "sub-th1",
                    text: t2.reviewThinking,
                    state: "done",
                    durationMs: 2_060,
                  },
                  {
                    kind: "tool_call",
                    id: "sub-tc1",
                    toolCallId: "call_01J8Z7R8MC",
                    name: "read_file",
                    alias: copy.chat.toolAliases.read_file,
                    subtitle: t2.reviewReadDescription,
                    state: "done",
                    durationMs: 388,
                    argumentsJson: json({
                      description: t2.reviewReadDescription,
                      file_path: INDEX_HTML_PATH,
                    }),
                    output: OUTPUT_READ_INDEX,
                    decision: { verdict: "allow", source: "auto" },
                  },
                  {
                    kind: "text",
                    id: "sub-tx1",
                    markdown: t2.reviewReply,
                    streaming: true,
                    atIso: at(TURN2_START_MS + 19_400),
                  },
                ],
              },
            },
            {
              kind: "tool_call",
              id: "tc7",
              toolCallId: "call_01J8Z7P3VA",
              name: "exec_command",
              alias: copy.chat.toolAliases.exec_command,
              subtitle: t2.testDescription,
              // Read-only approval mode: a command waits for the user. The settled figure is
              // the argument-generation segment; the wait itself is not counted.
              state: "waiting",
              durationMs: 620,
              argumentsJson: json({ cmd: CMD_TEST, description: t2.testDescription }),
            },
          ],
        },
      ],
    },
    sessionGroups: [
      {
        key: "workspace:claude-code-expert",
        label: sb.groupWorkspace,
        items: [
          {
            id: SESSION_ID,
            title: s.title,
            agentId: AGENT_ID,
            timeLabel: sb.now,
            updatedAtIso: at(TURN2_START_MS + TURN2_SPAN_MS),
            running: true,
          },
          {
            id: "ses_5c0de4f1a9b27730",
            title: sb.rows.tokenizer.title,
            agentId: AGENT_ID,
            timeLabel: sb.rows.tokenizer.time,
            updatedAtIso: "2026-09-14T04:11:52.000Z",
            pinned: true,
          },
          {
            id: "ses_91aa6e2d3f0b4c18",
            title: sb.rows.hooks.title,
            agentId: REVIEWER_AGENT_ID,
            timeLabel: sb.rows.hooks.time,
            updatedAtIso: "2026-09-14T01:40:05.000Z",
            unread: true,
          },
        ],
      },
      {
        key: "time:earlier",
        label: sb.groupEarlier,
        items: [
          {
            id: "ses_0d47b2c9e81f5a63",
            title: sb.rows.trace.title,
            agentId: AGENT_ID,
            timeLabel: sb.rows.trace.time,
            updatedAtIso: "2026-09-13T09:26:44.000Z",
          },
          {
            id: "ses_e3f09a7b12c64d85",
            title: sb.rows.weekly.title,
            agentId: AGENT_ID,
            timeLabel: sb.rows.weekly.time,
            updatedAtIso: "2026-09-12T10:00:00.000Z",
            scheduled: true,
          },
          {
            id: "ses_7a2b5c8d9e0f1a2b",
            title: sb.rows.deploy.title,
            agentId: REVIEWER_AGENT_ID,
            timeLabel: sb.rows.deploy.time,
            updatedAtIso: "2026-09-10T15:37:21.000Z",
          },
        ],
      },
    ],
    trace: {
      files: [
        { label: "#001", dateIso: "2026-09-14", sizeBytes: 48_213 },
        { label: "#002", dateIso: "2026-09-14", sizeBytes: 12_907 },
      ],
      activeFile: 0,
      overall: {
        turns: 2,
        toolCalls: 7,
        compactions: 0,
        inputTokens: 40_540,
        cacheReadTokens: 33_720,
        outputTokens: 3_290,
        costUsd: 0.0231,
        elapsedMs: 71_840,
        outputTps: 68,
      },
      turns: [
        {
          index: 1,
          toolCalls: 2,
          inputTokens: 15_620,
          cacheReadTokens: 12_410,
          outputTokens: 1_938,
          costUsd: 0.0121,
          elapsedMs: TURN1_SPAN_MS,
          outputTps: 71,
          spanMs: TURN1_SPAN_MS,
          lanes: TURN1_LANES.map((lane) => ({ ...lane, segments: [...lane.segments] })),
          events: [
            {
              time: clock(0),
              atIso: at(0),
              messageType: "model_msg",
              payloadType: "text",
              summary: t1.prompt,
            },
            {
              time: clock(12),
              atIso: at(12),
              messageType: "event_msg",
              payloadType: "request_begin",
              summary: "deepseek/deepseek-v4-pro · 14 messages · 9 tools",
            },
            {
              time: clock(2_380),
              atIso: at(2_380),
              messageType: "model_msg",
              payloadType: "thinking",
              summary: t1.thinking1,
            },
            {
              time: clock(2_610),
              atIso: at(2_610),
              messageType: "model_msg",
              payloadType: "text",
              summary: t1.text1,
            },
            {
              time: clock(3_420),
              atIso: at(3_420),
              messageType: "model_msg",
              payloadType: "tool_call",
              summary: `exec_command ${JSON.stringify({ cmd: CMD_COLLECT.split("\n")[0] })}`,
            },
            {
              time: clock(3_431),
              atIso: at(3_431),
              messageType: "event_msg",
              payloadType: "request_end",
              summary: "in 15.6k · cache 12.4k · out 612",
              stopReason: "tool_use",
            },
            {
              time: clock(3_436),
              atIso: at(3_436),
              messageType: "event_msg",
              payloadType: "approval_decision",
              summary: "allow · auto",
            },
            {
              time: clock(18_400),
              atIso: at(18_400),
              messageType: "model_msg",
              payloadType: "tool_call_output",
              summary: OUTPUT_COLLECT.split("\n")[0]!,
              stopReason: "completed",
            },
            {
              time: clock(21_880),
              atIso: at(21_880),
              messageType: "model_msg",
              payloadType: "tool_call",
              summary: `exec_command ${JSON.stringify({ cmd: CMD_APP.split("\n")[0] })}`,
            },
            {
              time: clock(21_950),
              atIso: at(21_950),
              messageType: "model_msg",
              payloadType: "tool_call_output",
              summary: OUTPUT_APP,
              stopReason: "completed",
            },
            {
              time: clock(25_840),
              atIso: at(25_840),
              messageType: "model_msg",
              payloadType: "text",
              summary: answer.split("\n")[0]!,
              stopReason: "completed",
            },
            {
              time: clock(25_851),
              atIso: at(25_851),
              messageType: "event_msg",
              payloadType: "token_usage",
              summary: "cacheRead 12.4k · cacheWrite 3.2k · output 1.9k",
            },
          ],
        },
        {
          index: 2,
          toolCalls: 5,
          inputTokens: 24_920,
          cacheReadTokens: 21_310,
          outputTokens: 1_352,
          costUsd: 0.011,
          elapsedMs: TURN2_SPAN_MS,
          outputTps: 64,
          spanMs: TURN2_SPAN_MS,
          lanes: TURN2_LANES.map((lane) => ({ ...lane, segments: [...lane.segments] })),
          events: [
            {
              time: clock(TURN2_START_MS),
              atIso: at(TURN2_START_MS),
              messageType: "model_msg",
              payloadType: "text",
              summary: t2.prompt,
            },
            {
              time: clock(TURN2_START_MS + 3_520),
              atIso: at(TURN2_START_MS + 3_520),
              messageType: "model_msg",
              payloadType: "tool_call",
              summary: `read_file ${JSON.stringify({ file_path: RAG_PATH, offset: READ_OFFSET, limit: READ_LIMIT })}`,
            },
            {
              time: clock(TURN2_START_MS + 6_214),
              atIso: at(TURN2_START_MS + 6_214),
              messageType: "model_msg",
              payloadType: "tool_call_output",
              summary: OUTPUT_EDIT.split("\n")[0]!,
              stopReason: "completed",
            },
            {
              time: clock(TURN2_START_MS + 11_780),
              atIso: at(TURN2_START_MS + 11_780),
              messageType: "session_meta",
              payloadType: "subagent",
              summary: `${REVIEWER_AGENT_ID} · ${SUBAGENT_SESSION_ID}`,
              fromSubagent: true,
            },
            {
              time: clock(TURN2_START_MS + 12_400),
              atIso: at(TURN2_START_MS + 12_400),
              messageType: "model_msg",
              payloadType: "tool_call",
              summary: `exec_command ${JSON.stringify({ cmd: CMD_TEST })}`,
            },
          ],
        },
      ],
    },
    models: MODEL_ROWS.map((row) => {
      const note = prose.modelNotes[row.modelId];
      return note === undefined ? { ...row } : { ...row, note };
    }),
    fileTree: workspaceTree(prose.notesFileName),
    filePreview: { path: RAG_PATH, language: "typescript", content: RAG_TS_AFTER },
    notices: {
      byTone: Object.fromEntries(
        Object.entries(prose.notices.byTone).map(([tone, n]) => [tone, { tone, ...n }]),
      ) as Fixtures["notices"]["byTone"],
      toasts: prose.notices.toasts.map((t): NoticeFixture => ({ ...t })),
    },
    forms: {
      title: prose.forms.title,
      description: prose.forms.description,
      fields: prose.forms.fields,
      search: prose.forms.search,
      groups: prose.forms.groups,
      errorSummary: prose.forms.errorSummary,
      submit: prose.forms.submit,
      cancel: prose.forms.cancel,
      swatches: ACCENT_SWATCHES.map((swatch, i) => ({
        ...swatch,
        label: prose.forms.swatchLabels[i]!,
      })),
    },
    menus: {
      message: MESSAGE_MENU.map((entry): MenuEntryFixture =>
        entry === "separator"
          ? "separator"
          : {
              icon: entry.icon,
              label: prose.menus[entry.key],
              ...(entry.shortcut === undefined ? {} : { shortcut: entry.shortcut }),
              ...(entry.danger === undefined ? {} : { danger: entry.danger }),
            },
      ),
      panels: PANEL_MENU.map((panel): MenuEntryFixture => ({
        icon: panel.icon,
        ...prose.menus.panels[panel.key],
      })),
    },
    vault: VAULT_KEYS.map((key): VaultEntryFixture => ({
      ...VAULT_ROWS[key],
      ...prose.vault[key],
    })),
    plugins: PLUGIN_KEYS.map((key): PluginFixture => ({
      ...PLUGIN_ROWS[key],
      ...prose.plugins[key],
    })),
    pluginLibrary: { ...PLUGIN_LIBRARY },
    commandPalette: [
      {
        label: prose.palette.groups.commands,
        items: PALETTE_COMMANDS.map((command) => ({
          icon: command.icon,
          label: prose.palette.commands[command.key],
          hint: prose.palette.hints[command.key],
          ...(command.keys === undefined ? {} : { keys: command.keys }),
        })),
      },
      {
        label: prose.palette.groups.sessions,
        items: prose.palette.sessions.map((session, i) => ({
          agentId: i === 0 ? AGENT_ID : REVIEWER_AGENT_ID,
          label: session.title,
          hint: session.hint,
        })),
      },
    ] satisfies CommandGroupFixture[],
    slashCommands: SLASH_COMMANDS.map((command) => ({
      name: command.name,
      description: prose.slashCommands[command.key],
      icon: command.icon,
    })),
    usage: {
      days: prose.usage.days,
      cacheRead: USAGE_SERIES.cacheRead,
      cacheWrite: USAGE_SERIES.cacheWrite,
      output: USAGE_SERIES.output,
      buckets: prose.usage.buckets,
    },
    company: {
      org: {
        id: "docs-expert-co",
        name: prose.company.orgName,
        mission: prose.company.mission,
        timezone: "Asia/Shanghai",
        spend: { period: "2026-09", costUsd: 41.37, budgetUsd: 120 },
      },
      employees,
      tickets,
      calendar: { weekStartIso: "2026-09-14", events },
      channel: {
        messages: CHANNEL_MESSAGES.map((message) => ({
          from: message.from,
          time: message.time,
          text: prose.company.channel[message.key],
        })),
      },
    },
    docsAnswer: { ...prose.docsAnswer, formula: BM25_FORMULA },
    specimens: prose.specimens,
  };

  return {
    ...data,
    plan: planSteps(
      data.session.turns.flatMap((turn) => turn.items),
      [tk.pdf.title, tk.deploy.title],
    ),
    failedRun: failedRun(data.session.turns[1]!.items, t2.failedReply),
  };
}

/** A tool call of the dataset by its item id; the dataset is built above, so a miss is a bug. */
function callById(items: readonly ChatItem[], id: string): ToolCallItem {
  const call = items.find(
    (item): item is ToolCallItem => item.kind === "tool_call" && item.id === id,
  );
  if (!call) throw new Error(`fixture tool call ${id} is missing`);
  return call;
}

/**
 * The Task's to-do list: the calls the session made, by their descriptions and states, then two
 * steps that went wrong on the way — an import that failed and a packaging run that was stopped.
 */
function planSteps(
  items: readonly ChatItem[],
  [failed, stopped]: readonly [string, string],
): PlanStepFixture[] {
  const step = (id: string): PlanStepFixture => {
    const call = callById(items, id);
    return {
      title: call.subtitle ?? call.alias,
      state: call.state,
      ...(call.state === "done" && call.durationMs !== undefined
        ? { durationMs: call.durationMs }
        : {}),
      ...(call.state === "running" && call.elapsedMs !== undefined
        ? { elapsedMs: call.elapsedMs }
        : {}),
    };
  };
  return [
    step("tc1"),
    step("tc2"),
    step("tc6"),
    step("tc7"),
    { title: failed, state: "failed", durationMs: 4_200 },
    { title: stopped, state: "stopped" },
  ];
}

/**
 * Turn 2 as it goes when the index still lists a file renamed upstream: the waiting test command,
 * approved and run, fails; the agent reads the failure; the turn closes with its stats.
 */
function failedRun(turn2: readonly ChatItem[], reply: string): Fixtures["failedRun"] {
  const test = callById(turn2, "tc7");
  return {
    call: {
      ...test,
      state: "failed",
      durationMs: 2_140,
      output: OUTPUT_TEST_FAILED,
      decision: { verdict: "allow", source: "manual" },
    },
    reply: {
      kind: "text",
      id: "tx-failed",
      markdown: reply,
      atIso: iso(TURN2_START_MS + TURN2_SPAN_MS),
    },
    stats: {
      toolCalls: 4,
      inputTokens: 24_920,
      cacheReadTokens: 21_310,
      cacheWriteTokens: 2_240,
      outputTokens: 1_352,
      costUsd: 0.011,
      elapsedMs: TURN2_SPAN_MS,
      outputTps: 64,
    },
  };
}
