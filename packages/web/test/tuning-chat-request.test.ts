/**
 * - Given a reproduction entry in either language, its draft carries the Target and
 *   reproduction Skill without prescribing a benchmark or design-calibration settings.
 * - Given an optimization entry, its draft carries the selected Agent and Benchmark without
 *   Penguin form defaults. Explicit method instructions are preserved, including their budget.
 * - Given an empty note, the optimization request remains usable without extra leading text.
 * - Given a previously selected Skill in the draft, the new entry selects only its own Skill.
 */
import { afterEach, describe, expect, it } from "vitest";
import { buildAiDraft } from "../src/features/ai-create/ai-bridge";
import { tuningChatRequest } from "../src/features/benchmark/tuning-chat-request";
import { S, setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(zh));

describe.each([
  ["zh", zh],
  ["en", en],
] as const)("tuning chat entry (%s)", (_locale, strings) => {
  it("opens reproduction with the Target, without a fixed benchmark or calibration settings", () => {
    setActiveStrings(strings);
    const request = tuningChatRequest("builder", { action: "reproduce", targetAgentId: "target" });
    const draft = buildAiDraft({ skills: ["benchmark-design"] }, request);
    expect(draft.agentId).toBe("builder");
    expect(draft.skills).toEqual(["benchmark-reproduction"]);
    expect(draft.source).toBe("benchmark");
    expect(draft.text).toContain("`target`");
    expect(draft.text).toContain("reproduction.yaml");
    expect(draft.text).toContain("arXiv");
    expect(draft.text).toContain("GitHub");
    expect(draft.text).not.toMatch(/GDPevo|pilot_iteration_limit|desired_baseline_score/);
  });

  it("preserves an explicit method and budget without adding Penguin form defaults", () => {
    setActiveStrings(strings);
    const note = "Use ACE with num_epochs: 2.";
    const draft = buildAiDraft(
      { skills: ["agent-evaluation"] },
      tuningChatRequest("optimizer", {
        action: "optimize",
        targetAgentId: "target",
        benchmarkId: "business_train",
        note,
      }),
    );
    expect(draft.agentId).toBe("optimizer");
    expect(draft.skills).toEqual(["agent-optimization"]);
    expect(draft.source).toBe("benchmark");
    expect(draft.text?.startsWith(`${note}\n\n`)).toBe(true);
    expect(draft.text).toContain("`target`");
    expect(draft.text).toContain("`benchmarks/business_train/`");
    expect(draft.text).toContain("experiment.yaml");
    expect(draft.text).toContain("arXiv");
    expect(draft.text).toContain("GitHub");
    expect(draft.text).not.toMatch(/runs[：:]|desired_score|candidate_round_limit/);
  });

  it("leaves a blank note out of the request", () => {
    setActiveStrings(strings);
    const request = tuningChatRequest("optimizer", {
      action: "optimize",
      targetAgentId: "target",
      benchmarkId: "business_train",
      note: "   ",
    });
    expect(request.text).toBe(S.tuningChat.optimizePrompt("target", "business_train"));
  });
});
