/**
 * The pure half of the "Create with AI" bridge (src/features/ai-create/ai-bridge.ts): what the
 * draft cache and the route state hold once a surface hands its prompt to the draft page.
 */
import { describe, expect, it } from "vitest";
import { aiChatRouteState, buildAiDraft } from "../src/features/ai-create/ai-bridge";

describe("buildAiDraft", () => {
  it("merges over the cached draft, so the model carry-over survives", () => {
    const draft = buildAiDraft(
      { modelRef: { provider: "p", modelId: "m" }, approvalMode: "read-only", text: "typed" },
      { agentId: "default_agent", text: "prompt" },
    );
    expect(draft.modelRef).toEqual({ provider: "p", modelId: "m" });
    expect(draft.approvalMode).toBe("read-only");
    expect(draft.agentId).toBe("default_agent");
    expect(draft.text).toBe("prompt");
  });

  it("resets the skill selection unless the request pins one", () => {
    expect(buildAiDraft({ skills: ["old"] }, { agentId: "a", text: "t" }).skills).toEqual([]);
    expect(buildAiDraft({}, { agentId: "a", text: "t", skills: ["s"] }).skills).toEqual(["s"]);
  });

  it("pins the Workspace only when asked, keeping the cached one otherwise", () => {
    expect(buildAiDraft({ workspace: "/w" }, { agentId: "a", text: "t" }).workspace).toBe("/w");
    // "" is the temporary Workspace — a pin, not an absence.
    const pinned = buildAiDraft({ workspace: "/w" }, { agentId: "a", text: "t", workspace: "" });
    expect(pinned.workspace).toBe("");
  });

  it("drops a stale handoff target, which would forward the prompt to another agent", () => {
    const draft = buildAiDraft({ handoffAgentId: "other" }, { agentId: "a", text: "t" });
    expect("handoffAgentId" in draft).toBe(false);
  });
});

describe("aiChatRouteState", () => {
  it("carries only what was asked for", () => {
    expect(aiChatRouteState({ agentId: "a", text: "t" })).toEqual({ agentId: "a" });
    expect(aiChatRouteState({ agentId: "a", text: "t", autoSend: false })).toEqual({
      agentId: "a",
    });
    expect(aiChatRouteState({ agentId: "a", text: "t", workspace: "", autoSend: true })).toEqual({
      agentId: "a",
      workspace: "",
      autoSend: true,
    });
  });
});
