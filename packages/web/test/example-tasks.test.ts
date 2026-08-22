import { describe, expect, it } from "vitest";
import { EXAMPLE_TASKS } from "../src/features/chat/example-tasks";
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
