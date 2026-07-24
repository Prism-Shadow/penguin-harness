import { describe, expect, it } from "vitest";
import { EXAMPLE_TASKS } from "../src/features/chat/example-tasks";
import { buildSkillsMessage } from "../src/features/chat/skill-use";
import { zh } from "../src/lib/strings";

describe("draft example tasks", () => {
  it("submits the tuning prompt without an implicit Skill block", () => {
    const task = EXAMPLE_TASKS.find((candidate) => candidate.id === "tuning");
    expect(task).toBeDefined();
    expect(task?.skills).toEqual([]);
    expect(buildSkillsMessage([...(task?.skills ?? [])], zh.chat.exampleTasks.tuning.prompt)).toBe(
      zh.chat.exampleTasks.tuning.prompt,
    );
  });
});
