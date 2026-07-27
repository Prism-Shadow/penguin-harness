import { describe, expect, it } from "vitest";
import { EXAMPLE_TASKS } from "../src/features/chat/example-tasks";
import { buildSkillsMessage } from "../src/features/chat/skill-use";
import { en } from "../src/lib/strings-en";
import { zh } from "../src/lib/strings";

describe("draft example tasks", () => {
  it("submits the self-improvement prompt without an implicit Skill block", () => {
    const task = EXAMPLE_TASKS.find((candidate) => candidate.id === "selfImprovement");
    expect(task).toBeDefined();
    expect(task?.skills).toEqual([]);
    expect(
      buildSkillsMessage([...(task?.skills ?? [])], zh.chat.exampleTasks.selfImprovement.prompt),
    ).toBe(zh.chat.exampleTasks.selfImprovement.prompt);
  });

  it.each([
    {
      locale: "zh",
      prompt: zh.chat.exampleTasks.selfImprovement.prompt,
      pilot: "Pilot 校准",
      formal: "Formal Baseline",
      markers: [
        "Pilot 总计最多执行 3 轮；同一轮内不得进行多次“调整—重新评测”循环",
        "Pilot 结果是临时结果，不得写入 Scoreboard",
        "不得仅针对已经观察到的答案 收紧 Rubric 来降低分数",
        "每次变更 Pilot 产物后， 都必须在下一次评测前完成语义隔离复核",
        "冻结完整 Benchmark 前 立即完成语义隔离复核",
        "全新且完整的 3×1 Formal 台账和矩阵；不得在 Scoreboard 中复用 Pilot 的运行",
        "只能记录一次完整有效的 Formal Baseline，绝不得写入不完整或 放弃的 Formal 矩阵",
        "分数未低于 70 本身不属于设计缺陷",
        "仅当已记录的完整 Formal Baseline 低于 70 时才可开始 Phase 3",
      ],
    },
    {
      locale: "en",
      prompt: en.chat.exampleTasks.selfImprovement.prompt,
      pilot: "Pilot calibration",
      formal: "Formal Baseline",
      markers: [
        "Run no more than three Pilot iterations in total, and never perform multiple adjustment-and-rerun cycles within one iteration",
        "Pilot results are provisional and must not be written to the Scoreboard",
        "must not lower the score only by tightening a Rubric around an observed answer",
        "After every Pilot artifact change, complete a semantic-isolation review before the next evaluation",
        "semantic-isolation review immediately before freezing the complete Benchmark",
        "fresh complete 3×1 Formal ledger and matrix; never reuse Pilot runs in the Scoreboard",
        "Only one complete valid Formal Baseline may be recorded. Never write a partial or abandoned Formal matrix",
        "A score that is not below 70 is not by itself a design defect",
        "Start Phase 3 only when the recorded complete Formal Baseline is below 70",
      ],
    },
  ])(
    "$locale preserves the Pilot-to-Formal self-improvement contract",
    ({ prompt, pilot, formal, markers }) => {
      const normalizedPrompt = prompt.replace(/\s+/g, " ");
      expect(normalizedPrompt.indexOf(pilot)).toBeGreaterThan(-1);
      expect(normalizedPrompt.indexOf(formal)).toBeGreaterThan(normalizedPrompt.indexOf(pilot));
      for (const marker of markers) {
        expect(normalizedPrompt).toContain(marker);
      }
    },
  );
});
