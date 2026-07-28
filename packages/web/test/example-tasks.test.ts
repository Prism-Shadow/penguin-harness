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
        "依次直接使用 `agent-creation` 和 `benchmark-design`",
        "通过 `run_subagent` 委托使用 `agent-evaluation` 的 Evaluator",
        "期望 Pilot 分数：低于 75",
        "有效 Pilot iteration 上限：5",
        "赛前赔率、近期状态、主客场、伤停、天气和最终赛果",
        "售后政策、订单记录、用户诉求和时间信息",
        "公开的投资策略、历史市场样本和当前市场指标",
        "三个 Case 应覆盖不同的决策难点",
        "不能只依靠一个低分 Case 拉低总分",
        "难度应来自必要的推理依赖",
        "只呈现题目，不解释考点、解法或关键证据",
        "最多完成 5 个有效 Pilot iteration",
        "分数最低的有效 Benchmark revision Freeze",
        "只要 Formal 有效就记录 Baseline，即使分数没有低于 75",
        "不要开始优化 Agent",
      ],
      optimizationMarkers: [
        "直接使用 `agent-optimization`",
        "Scoreboard 是否包含第一条完整有效的 Formal Baseline",
        "期望目标分数：至少 85",
        "有效 Candidate round 上限：5",
        "最多完成 5 个有效 Candidate round",
        "完整有效但未被接受的 Candidate 计入轮数",
        "保留得分最高的已接受 Reference",
        "不得读取 Rubric、Gold 或其他私有评分信息",
      ],
    },
    {
      locale: "en",
      buildPrompt: en.chat.exampleTasks.agentBenchmarkBuild.prompt,
      optimizationPrompt: en.chat.exampleTasks.agentOptimization.prompt,
      buildMarkers: [
        "directly use `agent-creation` followed by `benchmark-design`",
        "use `run_subagent` to delegate to an Evaluator using `agent-evaluation`",
        "Desired Pilot score: below 75",
        "Valid Pilot iteration limit: 5",
        "pre-match odds, recent form, home or away status, injuries, weather, and outcomes",
        "policies, order records, customer requests, and timing",
        "a public strategy, historical market samples, and current indicators",
        "three Cases must cover different decision challenges",
        "do not rely on one low-scoring Case to pull down the total",
        "Difficulty must come from necessary reasoning dependencies",
        "without explaining the tested capability, solution, or decisive evidence",
        "no more than five valid Pilot iterations",
        "lowest-scoring valid Benchmark revision",
        "Record every valid Formal Baseline even when its score is not below 75",
        "Do not begin Agent optimization",
      ],
      optimizationMarkers: [
        "directly use `agent-optimization`",
        "Scoreboard contains a first complete valid Formal Baseline",
        "Desired target score: at least 85",
        "Valid Candidate round limit: 5",
        "no more than five valid Candidate rounds",
        "validly evaluated rejected Candidate does count",
        "retain the highest-scoring accepted Reference",
        "must not read Rubrics, Gold answers, or other private scoring information",
      ],
    },
  ])(
    "$locale preserves the two-session agent evolution contract",
    ({ buildPrompt, optimizationPrompt, buildMarkers, optimizationMarkers }) => {
      const normalizedBuild = buildPrompt.replace(/\s+/g, " ");
      const normalizedOptimization = optimizationPrompt.replace(/\s+/g, " ");

      for (const marker of buildMarkers) {
        expect(normalizedBuild).toContain(marker);
      }
      for (const marker of optimizationMarkers) {
        expect(normalizedOptimization).toContain(marker);
      }

      expect(normalizedBuild).not.toContain("penguin run");
      expect(normalizedOptimization).not.toContain("penguin run");
      expect(normalizedBuild).not.toContain("Phase 1");
      expect(normalizedOptimization).not.toContain("Phase 3");
    },
  );
});
