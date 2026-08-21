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
        // The submitted prompt is the working brief, not a longer version of the row tooltip.
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

  it.each(scheduleIds)("%s describes the real schedule mechanism in both locales", (id) => {
    for (const dict of [zh, en]) {
      const prompt = dict.chat.exampleTasks[id].prompt;
      // A schedule is a TOML file in this directory, explicitly enabled, with a first trigger
      // time — a prompt missing any of the three is instructing against an API that does not
      // exist. `period` is a fixed interval (30m / 12h / 7d); there is no cron syntax to reach for.
      expect(prompt).toContain("agent_state/schedule/");
      expect(prompt).toContain("enabled = true");
      expect(prompt).toContain("start_at");
      expect(prompt).not.toContain("cron");
    }
  });
});

describe("investment copilot example", () => {
  // The brief is analysis with stated evidence, never a recommendation to act.
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
