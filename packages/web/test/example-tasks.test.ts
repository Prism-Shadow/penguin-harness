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
        "先使用 `agent-creation`",
        "id：`finite_choice_agent`",
        "installed_skills：`[]`",
        "id：`contextual-choice-development`",
        "id：`contextual-choice-promotion`",
        "role：`development`",
        "role：`promotion`",
        "desired_baseline_score：`<75`",
        "pilot_iteration_limit：`5`",
        "足球投注决策",
        "售后政策与工单事实",
        "投资策略、历史市场与当前指标",
      ],
      buildForbiddenMarkers: ["thinking_level", "provider", "model_id", "runs："],
      optimizationMarkers: [
        "使用 `agent-optimization`",
        "test_agent_id：`finite_choice_agent`",
        "benchmark_id：`contextual-choice-development`",
        "提高信息不完整、规则冲突和有限选项决策中的稳定性",
        "runs：`3`",
        "desired_score：`>=95`",
        "candidate_round_limit：`5`",
        "optimization_session_id",
        "production_reference_version",
      ],
    },
    {
      locale: "en",
      buildPrompt: en.chat.exampleTasks.agentBenchmarkBuild.prompt,
      optimizationPrompt: en.chat.exampleTasks.agentOptimization.prompt,
      buildMarkers: [
        "first use `agent-creation`",
        "id: `finite_choice_agent`",
        "installed_skills: `[]`",
        "id: `contextual-choice-development`",
        "id: `contextual-choice-promotion`",
        "role: `development`",
        "role: `promotion`",
        "desired_baseline_score: `<75`",
        "pilot_iteration_limit: `5`",
        "football betting decisions",
        "policy and ticket facts",
        "strategy, historical markets, and current indicators",
      ],
      buildForbiddenMarkers: ["thinking_level", "provider", "model_id", "runs:"],
      optimizationMarkers: [
        "Use `agent-optimization`",
        "test_agent_id: `finite_choice_agent`",
        "benchmark_id: `contextual-choice-development`",
        "improve stability under incomplete information, conflicting rules, and finite choices",
        "runs: `3`",
        "desired_score: `>=95`",
        "candidate_round_limit: `5`",
        "optimization_session_id",
        "production_reference_version",
      ],
    },
  ])(
    "$locale preserves the Builder and Optimizer sides of the three-session contract",
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

      expect(normalizedBuild).not.toContain("penguin run");
      expect(normalizedOptimization).not.toContain("penguin run");
      expect(normalizedBuild).not.toContain("run_subagent");
      expect(normalizedOptimization).not.toContain("run_subagent");
      expect(normalizedBuild).not.toContain("Scoreboard");
      expect(normalizedOptimization).not.toContain("Scoreboard");
      expect(normalizedOptimization).not.toContain("contextual-choice-promotion");
      expect(normalizedBuild.length).toBeLessThan(2200);
      expect(normalizedOptimization.length).toBeLessThan(1200);
      expect(normalizedBuild).not.toContain("Phase 1");
      expect(normalizedOptimization).not.toContain("Phase 3");
    },
  );
});
