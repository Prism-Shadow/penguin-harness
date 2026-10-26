/**
 * The start page's example prompts (features/chat/example-tasks.ts and the dictionaries).
 * They are sent to an Agent as written, so what they must carry is a contract with the skills
 * and schedules that read them, held in both languages alike. The self-evolution toolkits' demos
 * are not among them: each toolkit's card fills its plugin's own quick start, read from the
 * server.
 *
 * - The two agent-evolution prompts carry the ids and targets the build and optimization skills
 *   read, name the skills in the order they run, stay short, and leave out what the Agent works
 *   out itself.
 * - The folders stay within one row of each other, so the start page's height does not jump.
 * - Every scheduled-task example says when it fires (never in cron syntax), and the two that
 *   need an answer run in the conversation the user is in.
 * - The short example prompts stay under their length ceilings and keep their core in both
 *   locales — the RAG docs expert its source and citations, the Benchmark import its Skill and
 *   the GDPevo package it imports, the rhythm runner its two penguin forms, its easy difficulty
 *   and its instrumental music, the ski game its downhill terrain, its visible skis and a crash
 *   that never ends the run.
 * - The investment Copilot example keeps its "not investment advice" framing.
 */
import { describe, expect, it } from "vitest";
import { EXAMPLE_FOLDERS } from "../src/features/chat/example-tasks";
import { en } from "../src/lib/strings-en";
import { zh } from "../src/lib/strings";

describe("draft example tasks", () => {
  it.each([
    {
      locale: "zh",
      buildPrompt: zh.chat.exampleTasks.agentBenchmarkBuild.prompt,
      optimizationPrompt: zh.chat.exampleTasks.agentOptimization.prompt,
      buildMarkers: [
        "id：`finite_choice_agent`",
        "installed_skills：`[]`",
        "id：`contextual-choice-adaptation`",
        "desired_baseline_score：`<75`",
        "pilot_iteration_limit：`5`",
      ],
      buildForbiddenMarkers: ["thinking_level", "provider", "model_id", "runs："],
      optimizationMarkers: [
        "test_agent_id：`finite_choice_agent`",
        "benchmark_id：`contextual-choice-adaptation`",
        "runs：`3`",
        "desired_score：`>=95`",
        "candidate_round_limit：`5`",
      ],
    },
    {
      locale: "en",
      buildPrompt: en.chat.exampleTasks.agentBenchmarkBuild.prompt,
      optimizationPrompt: en.chat.exampleTasks.agentOptimization.prompt,
      buildMarkers: [
        "id: `finite_choice_agent`",
        "installed_skills: `[]`",
        "id: `contextual-choice-adaptation`",
        "desired_baseline_score: `<75`",
        "pilot_iteration_limit: `5`",
      ],
      buildForbiddenMarkers: ["thinking_level", "provider", "model_id", "runs:"],
      optimizationMarkers: [
        "test_agent_id: `finite_choice_agent`",
        "benchmark_id: `contextual-choice-adaptation`",
        "runs: `3`",
        "desired_score: `>=95`",
        "candidate_round_limit: `5`",
      ],
    },
  ])(
    "$locale preserves the two-session agent evolution contract",
    ({
      buildPrompt,
      optimizationPrompt,
      buildMarkers,
      buildForbiddenMarkers,
      optimizationMarkers,
    }) => {
      const normalizedBuild = buildPrompt.replace(/\s+/g, " ");
      const normalizedOptimization = optimizationPrompt.replace(/\s+/g, " ");

      for (const marker of buildMarkers) {
        expect(normalizedBuild).toContain(marker);
      }
      for (const marker of buildForbiddenMarkers) {
        expect(normalizedBuild).not.toContain(marker);
      }
      for (const marker of optimizationMarkers) {
        expect(normalizedOptimization).toContain(marker);
      }

      // The build draft names both skills, in the order it runs them; the scenario copy each
      // one is described with is free to change.
      expect(normalizedBuild).toContain("`agent-initialization`");
      expect(normalizedBuild.indexOf("`agent-initialization`")).toBeLessThan(
        normalizedBuild.indexOf("`benchmark-design`"),
      );
      expect(normalizedOptimization).toContain("`agent-optimization`");

      expect(normalizedBuild).not.toContain("penguin run");
      expect(normalizedOptimization).not.toContain("penguin run");
      expect(normalizedBuild).not.toContain("run_subagent");
      expect(normalizedOptimization).not.toContain("run_subagent");
      expect(normalizedBuild).not.toContain("Scoreboard");
      expect(normalizedOptimization).not.toContain("Scoreboard");
      expect(normalizedBuild.length).toBeLessThan(1600);
      expect(normalizedOptimization.length).toBeLessThan(600);
      expect(normalizedBuild).not.toContain("Phase 1");
      expect(normalizedOptimization).not.toContain("Phase 3");
    },
  );
});

describe("draft example catalog", () => {
  // The start page reserves no scroll area: its height is the folder rows plus the open
  // folder's rows, so a folder much longer than its siblings makes that height jump.
  it("keeps the folders within one row of each other", () => {
    const sizes = EXAMPLE_FOLDERS.map((folder) => folder.tasks.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });
});

describe("scheduled-task examples", () => {
  // Two things a shortened schedule brief cannot lose. WHEN it fires: a schedule with no time
  // in it is not a schedule, and the Agent has nothing to ask about it that would not be a
  // guess. And, for the two check-ins that need the user to answer, that they run in the
  // conversation the user is already in — the default is a fresh Session per run, which for
  // those two would be wrong. How the schedule is written (TOML under agent_state/schedule/,
  // `enabled`, `start_at`) is in the Agent's own Scheduled Tasks section; the prompt no longer
  // repeats it. `period` is a fixed interval (30m / 12h / 7d), so cron syntax is always wrong.
  it.each([
    {
      id: "dailyPlan",
      zhMarkers: ["每天", "9 点", "这个会话"],
      enMarkers: ["every day", "9am", "this same conversation"],
    },
    { id: "githubDigest", zhMarkers: ["每天"], enMarkers: ["every morning"] },
    {
      id: "memoryReview",
      zhMarkers: ["每周五", "这个会话"],
      enMarkers: ["every Friday", "this same conversation"],
    },
  ] as const)("$id says when it fires in both locales", ({ id, zhMarkers, enMarkers }) => {
    const zhPrompt = zh.chat.exampleTasks[id].prompt;
    const enPrompt = en.chat.exampleTasks[id].prompt;
    for (const marker of zhMarkers) {
      expect(zhPrompt).toContain(marker);
    }
    for (const marker of enMarkers) {
      expect(enPrompt).toContain(marker);
    }
    expect(zhPrompt).not.toContain("cron");
    expect(enPrompt).not.toContain("cron");
  });
});

/**
 * The prompts listed here are written to be read by the user before they run, so each is a short
 * paragraph — around 100 Chinese characters — carrying what to build plus the constraints the
 * result would be wrong without, and none of the step-by-step detail the Agent works out or asks
 * about. The caps below are a ceiling against re-inflation, not a target. Only the listed ones are
 * covered: the older briefs in the catalog are still far longer and are being shortened separately.
 */
describe("short example prompts", () => {
  const shortExamples = [
    {
      id: "ragDocsExpert",
      zhMarkers: ["claude-code-docs", "RAG", "来源引用"],
      enMarkers: ["claude-code-docs", "RAG", "citing its sources"],
    },
    {
      id: "benchmarkImport",
      zhMarkers: [
        "`benchmark-design`",
        "packages/penguinharness-benchmark-gdpevo-crm-train",
        "不要覆盖",
      ],
      enMarkers: [
        "`benchmark-design`",
        "packages/penguinharness-benchmark-gdpevo-crm-train",
        "leave them as they are",
      ],
    },
    {
      id: "game",
      zhMarkers: ["滑雪大冒险", "滑雪板", "整体向下", "陡坡", "摔倒不会结束游戏", "爬起来"],
      enMarkers: [
        "Ski Safari",
        "visible skis",
        "trends downhill",
        "steep slopes",
        "never ends the run",
        "gets back up",
      ],
    },
    {
      id: "rhythmRunner",
      zhMarkers: [
        "喵斯快跑",
        "企鹅",
        "音符图标",
        "节拍",
        "飞起来",
        "雪橇",
        "Perfect",
        "Great",
        "Miss",
        "简单",
        "纯音乐",
      ],
      enMarkers: [
        "Muse Dash",
        "penguin",
        "music-note icons",
        "beat",
        "fly",
        "sled",
        "Perfect",
        "Great",
        "Miss",
        "easy",
        "Instrumental",
      ],
    },
    {
      id: "investmentCopilot",
      zhMarkers: [
        "Plugin",
        "智能体",
        "Agent Workbench",
        "5 分钟",
        "市场因素",
        "公司名",
        "不要编",
        "新建对话",
      ],
      enMarkers: [
        "Plugins",
        "agent",
        "Agent Workbench",
        "5 minutes",
        "market factors",
        "company name",
        "not listed",
        "new conversation",
      ],
    },
    {
      id: "legalDesk",
      zhMarkers: ["Plugin", "法务智能体", "Agent Workbench", "后台审阅", "报告下载", "新建对话"],
      enMarkers: [
        "Plugins",
        "legal agent",
        "Agent Workbench",
        "background review",
        "report downloads",
        "new conversation",
      ],
    },
    { id: "dailyPlan", zhMarkers: ["计划"], enMarkers: ["plan"] },
    { id: "githubDigest", zhMarkers: ["GitHub", "优先级"], enMarkers: ["GitHub", "priority"] },
    { id: "memoryReview", zhMarkers: ["Memory"], enMarkers: ["Memory"] },
  ] as const;

  it.each(shortExamples)("$id stays within the length ceiling", ({ id }) => {
    // investmentCopilot sits highest by a wide margin: seven requirements plus a reference URL and
    // a quoted sample question, both literals no rewording compresses. The English ceiling is the
    // wider one because English runs about three times the character count of the same Chinese,
    // not because the English is allowed to say more.
    expect(zh.chat.exampleTasks[id].prompt.length).toBeLessThanOrEqual(230);
    expect(en.chat.exampleTasks[id].prompt.length).toBeLessThanOrEqual(700);
  });

  // What is left after the cut: what to build, and the constraints without which the result
  // would be the wrong thing (a rhythm game is a game synced to music; the investment Copilot
  // is an Agent Workbench that refreshes quotes, surfaces trending stocks,
  // and gives the assistant a name-resolving stock-lookup tool).
  it.each(shortExamples)("$id keeps its core in both locales", ({ id, zhMarkers, enMarkers }) => {
    for (const marker of zhMarkers) {
      expect(zh.chat.exampleTasks[id].prompt).toContain(marker);
    }
    for (const marker of enMarkers) {
      expect(en.chat.exampleTasks[id].prompt).toContain(marker);
    }
  });
});

describe("investment copilot example", () => {
  // Short as it is, the brief stays analysis with stated evidence, never a call to act.
  it.each([
    { locale: "zh", prompt: zh.chat.exampleTasks.investmentCopilot.prompt, marker: "不是投资建议" },
    {
      locale: "en",
      prompt: en.chat.exampleTasks.investmentCopilot.prompt,
      marker: "not investment advice",
    },
  ])("$locale keeps the not-advice framing", ({ prompt, marker }) => {
    expect(prompt).toContain(marker);
  });
});
