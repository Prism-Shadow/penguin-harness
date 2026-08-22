import { describe, expect, it } from "vitest";
import { EXAMPLE_FOLDERS, EXAMPLE_TASKS } from "../src/features/chat/example-tasks";
import { buildSkillsMessage } from "../src/features/chat/skill-use";
import { en } from "../src/lib/strings-en";
import { zh } from "../src/lib/strings";

describe("draft example tasks", () => {
  it.each(["agentBenchmarkBuild", "agentOptimization"] as const)(
    "submits the %s prompt without an implicit Skill block",
    (id) => {
      const task = EXAMPLE_TASKS.find((candidate) => candidate.id === id);
      expect(task).toBeDefined();
      expect(task?.skills).toEqual([]);
      expect(buildSkillsMessage([...(task?.skills ?? [])], zh.chat.exampleTasks[id].prompt)).toBe(
        zh.chat.exampleTasks[id].prompt,
      );
    },
  );

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
      expect(normalizedBuild).toContain("`agent-creation`");
      expect(normalizedBuild.indexOf("`agent-creation`")).toBeLessThan(
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
  it("gives every folder and every example copy in both dictionaries", () => {
    const ids = EXAMPLE_TASKS.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const dict of [zh, en]) {
      for (const folder of EXAMPLE_FOLDERS) {
        expect(dict.chat.exampleFolders[folder.id]).not.toBe("");
      }
      for (const id of ids) {
        const copy = dict.chat.exampleTasks[id];
        expect(copy.label).not.toBe("");
        expect(copy.desc).not.toBe("");
        // The prompt is the request; the description is only the row's tooltip for it.
        expect(copy.prompt.length).toBeGreaterThan(copy.desc.length);
      }
    }
  });

  // The draft page reserves no scroll area: its height is the folder rows plus the open
  // folder's rows, so a folder much longer than its siblings makes that height jump.
  it("keeps the folders within one row of each other", () => {
    const sizes = EXAMPLE_FOLDERS.map((folder) => folder.tasks.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });
});

describe("scheduled-task examples", () => {
  const scheduleIds = ["dailyPlan", "githubDigest", "memoryReview"] as const;

  it("files them all in the schedules folder", () => {
    const folder = EXAMPLE_FOLDERS.find((candidate) => candidate.id === "schedules");
    expect(folder?.tasks.map((task) => task.id)).toEqual([...scheduleIds]);
  });

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
 * These five are written to be read by the user before they run, so each is a short paragraph —
 * around 100 Chinese characters — carrying what to build plus the constraints the result would be
 * wrong without, and none of the step-by-step detail the Agent works out or asks about. The caps
 * below are a ceiling against re-inflation, not a target. Only these five are covered: the older
 * briefs in the catalog are still far longer and are being shortened separately.
 */
describe("short example prompts", () => {
  const shortExamples = [
    {
      id: "rhythmRunner",
      zhMarkers: ["喵斯快跑", "音乐", "节拍"],
      enMarkers: ["Muse Dash", "music", "beat"],
    },
    {
      id: "investmentCopilot",
      zhMarkers: ["Penguin SDK", "启动后", "实时抓取", "板块", "股票", "依据", "CLI"],
      enMarkers: [
        "Penguin SDK",
        "from startup",
        "live market",
        "sector",
        "stocks",
        "evidence",
        "CLI",
      ],
    },
    { id: "dailyPlan", zhMarkers: ["计划"], enMarkers: ["plan"] },
    { id: "githubDigest", zhMarkers: ["GitHub", "优先级"], enMarkers: ["GitHub", "priority"] },
    { id: "memoryReview", zhMarkers: ["Memory"], enMarkers: ["Memory"] },
  ] as const;

  it.each(shortExamples)("$id stays within the length ceiling", ({ id }) => {
    expect(zh.chat.exampleTasks[id].prompt.length).toBeLessThanOrEqual(140);
    expect(en.chat.exampleTasks[id].prompt.length).toBeLessThanOrEqual(420);
  });

  // What is left after the cut: what to build, and the constraints without which the result
  // would be the wrong thing (a rhythm game is a game synced to music; the investment Copilot
  // is a Penguin SDK app that refreshes from startup and ships a single-ticker CLI).
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
