/**
 * Draft cache parsing/validation and storage access (the auto-cache
 * foundation for draft-view):
 * - parseDraft validates field by field — localStorage may be corrupted by
 *   external code, so bad JSON / non-object / invalid fields are always
 *   discarded instead of crashing the page;
 * - load/save/clear are isolated by "user x Project/Session" (#68: switching
 *   accounts in the same browser must not leak drafts across users); storage
 *   errors (quota/private mode) are swallowed silently.
 */
import { describe, expect, it } from "vitest";
import {
  clearDraft,
  clearDraftChatDefaults,
  clearDraftModelRef,
  draftKey,
  loadDraft,
  parseDraft,
  saveDraft,
  sessionDraftKey,
} from "../src/features/chat/draft-cache";
import type { DraftStorage } from "../src/features/chat/draft-cache";

/** In-memory storage (vitest runs in a Node environment, no localStorage). */
function memStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("parseDraft (field-by-field validation)", () => {
  it("null / empty string / bad JSON / non-objects all yield an empty draft", () => {
    expect(parseDraft(null)).toEqual({});
    expect(parseDraft("")).toEqual({});
    expect(parseDraft("{not json")).toEqual({});
    expect(parseDraft("42")).toEqual({});
    expect(parseDraft('"str"')).toEqual({});
    expect(parseDraft("null")).toEqual({});
    expect(parseDraft("[1,2]")).toEqual({});
  });

  it("valid fields pass through one by one (both model fields are paired references)", () => {
    const raw = JSON.stringify({
      text: "Write me a script",
      agentId: "default_agent",
      workspace: "/srv/repo",
      approvalMode: "read-only",
      modelRef: { provider: "anthropic", modelId: "claude-opus-4-8" },
      handoffAgentId: "agent_helper",
      switchModelRef: { provider: "openai", modelId: "gpt-5" },
      skills: ["agent-initialization", "penguin-sdk"],
    });
    expect(parseDraft(raw)).toEqual({
      text: "Write me a script",
      agentId: "default_agent",
      workspace: "/srv/repo",
      approvalMode: "read-only",
      modelRef: { provider: "anthropic", modelId: "claude-opus-4-8" },
      handoffAgentId: "agent_helper",
      switchModelRef: { provider: "openai", modelId: "gpt-5" },
      skills: ["agent-initialization", "penguin-sdk"],
    });
  });

  it("wrongly typed fields are dropped, the rest kept", () => {
    const raw = JSON.stringify({
      text: 123,
      agentId: null,
      workspace: { path: "/x" },
      approvalMode: "read-only",
      modelRef: ["m"],
      handoffAgentId: 7,
      switchModelRef: "custom:claude-4-8",
    });
    expect(parseDraft(raw)).toEqual({ approvalMode: "read-only" });
  });

  it("legacy string modelId and half references are always dropped (never released, no migration)", () => {
    expect(parseDraft(JSON.stringify({ modelId: "claude-opus-4-8" }))).toEqual({});
    expect(parseDraft(JSON.stringify({ modelRef: { modelId: "claude-opus-4-8" } }))).toEqual({});
    expect(parseDraft(JSON.stringify({ modelRef: { provider: "anthropic" } }))).toEqual({});
  });

  it("the staged /model target validates exactly like modelRef: half references and non-objects are dropped", () => {
    // The staged switch chip is cached alongside the text it belongs to (a chip lost while its
    // text survived would send that text to the current session on the old model), so a
    // corrupted entry must degrade to "no chip" rather than to a half-formed model reference.
    expect(parseDraft(JSON.stringify({ switchModelRef: { modelId: "gpt-5" } }))).toEqual({});
    expect(parseDraft(JSON.stringify({ switchModelRef: { provider: "openai" } }))).toEqual({});
    expect(parseDraft(JSON.stringify({ switchModelRef: null }))).toEqual({});
    expect(parseDraft(JSON.stringify({ switchModelRef: 42 }))).toEqual({});
    expect(
      parseDraft(JSON.stringify({ switchModelRef: { provider: "openai", modelId: 5 } })),
    ).toEqual({});
    // The two model fields are independent: a bad one never takes the good one down with it.
    expect(
      parseDraft(
        JSON.stringify({
          modelRef: { provider: "anthropic", modelId: "claude-opus-4-8" },
          switchModelRef: { provider: 1, modelId: "gpt-5" },
        }),
      ),
    ).toEqual({ modelRef: { provider: "anthropic", modelId: "claude-opus-4-8" } });
  });

  it("approvalMode accepts only the four valid values", () => {
    expect(parseDraft(JSON.stringify({ approvalMode: "yolo" }))).toEqual({});
    for (const m of ["always-ask", "read-only", "allow-all", "deny-all"]) {
      expect(parseDraft(JSON.stringify({ approvalMode: m }))).toEqual({ approvalMode: m });
    }
  });

  it("unknown fields do not pass through", () => {
    const out = parseDraft(JSON.stringify({ text: "hi", evil: "x" }));
    expect(out).toEqual({ text: "hi" });
  });

  it("skills: non-arrays dropped, non-string elements filtered out, the whole field dropped when empty after filtering", () => {
    // Non-arrays are always discarded
    expect(parseDraft(JSON.stringify({ skills: "agent-initialization" }))).toEqual({});
    expect(parseDraft(JSON.stringify({ skills: { 0: "x" } }))).toEqual({});
    expect(parseDraft(JSON.stringify({ skills: 42 }))).toEqual({});
    // Validate each element individually: strings are kept, everything else is filtered out
    expect(parseDraft(JSON.stringify({ skills: ["a", 1, null, {}, "b", false] }))).toEqual({
      skills: ["a", "b"],
    });
    // Empty array / empty after filtering -> the whole field is dropped
    expect(parseDraft(JSON.stringify({ skills: [] }))).toEqual({});
    expect(parseDraft(JSON.stringify({ skills: [7, null] }))).toEqual({});
  });
});

describe("load / save / clear (key isolation, errors silenced)", () => {
  it("saved drafts read back equal; Project and Session drafts do not affect each other", () => {
    const s = memStorage();
    saveDraft(
      draftKey("user-a1", "project-a"),
      {
        text: "Draft A",
        modelRef: { provider: "deepseek", modelId: "deepseek-v4-pro" },
        skills: ["agent-initialization"],
      },
      s,
    );
    saveDraft(sessionDraftKey("user-a1", "session-1"), { text: "session draft" }, s);
    expect(loadDraft(draftKey("user-a1", "project-a"), s)).toEqual({
      text: "Draft A",
      modelRef: { provider: "deepseek", modelId: "deepseek-v4-pro" },
      skills: ["agent-initialization"],
    });
    expect(loadDraft(sessionDraftKey("user-a1", "session-1"), s)).toEqual({
      text: "session draft",
    });
    // Lock down the key format (e2e accesses it as a literal; ids are all
    // <prefix>-<hex> with no ".", so the key space never collides).
    expect(draftKey("user-a1", "project-a")).toBe("penguin.chatDraft.user-a1.project-a");
    expect(sessionDraftKey("user-a1", "session-1")).toBe(
      "penguin.chatDraft.session.user-a1.session-1",
    );
    expect(s.map.size).toBe(2);
  });

  it("drafts for the same Project/Session are isolated per user: neither reads nor overwrites the other (#68)", () => {
    const s = memStorage();
    saveDraft(draftKey("user-a1", "project-a"), { text: "A's secret draft" }, s);
    saveDraft(sessionDraftKey("user-a1", "session-1"), { text: "A's session draft" }, s);
    // Switch accounts (same browser): B reading the same Project/Session only gets an empty draft.
    expect(loadDraft(draftKey("user-b2", "project-a"), s)).toEqual({});
    expect(loadDraft(sessionDraftKey("user-b2", "session-1"), s)).toEqual({});
    // B saves its own draft: coexists with A's, neither overwrites the other.
    saveDraft(draftKey("user-b2", "project-a"), { text: "B's draft" }, s);
    expect(loadDraft(draftKey("user-a1", "project-a"), s)).toEqual({ text: "A's secret draft" });
    expect(loadDraft(draftKey("user-b2", "project-a"), s)).toEqual({ text: "B's draft" });
  });

  it("reads back an empty draft after clear", () => {
    const s = memStorage();
    saveDraft(draftKey("user-a1", "project-a"), { text: "to be cleared" }, s);
    clearDraft(draftKey("user-a1", "project-a"), s);
    expect(loadDraft(draftKey("user-a1", "project-a"), s)).toEqual({});
    expect(s.map.size).toBe(0);
  });

  it("clearDraftModelRef drops only the model pin, keeping everything else (default-model change follow-through)", () => {
    // Shared by the models page and the project-settings default-model control: after the
    // Project default changes, the draft must follow it instead of pinning the old pick.
    const s = memStorage();
    saveDraft(
      draftKey("user-a1", "project-a"),
      {
        text: "keep me",
        agentId: "default_agent",
        modelRef: { provider: "deepseek", modelId: "deepseek-v4-pro" },
        skills: ["agent-initialization"],
      },
      s,
    );
    clearDraftModelRef("user-a1", "project-a", s);
    expect(loadDraft(draftKey("user-a1", "project-a"), s)).toEqual({
      text: "keep me",
      agentId: "default_agent",
      skills: ["agent-initialization"],
    });
    // No cached pick (or no draft at all): a no-op, never an errant write.
    clearDraftModelRef("user-a1", "project-a", s);
    clearDraftModelRef("user-b2", "project-a", s);
    expect(s.map.has(draftKey("user-b2", "project-a"))).toBe(false);
    // Scoped by user × Project: another user's pin survives.
    saveDraft(
      draftKey("user-b2", "project-a"),
      { modelRef: { provider: "openai", modelId: "gpt-5" } },
      s,
    );
    clearDraftModelRef("user-a1", "project-a", s);
    expect(loadDraft(draftKey("user-b2", "project-a"), s).modelRef).toEqual({
      provider: "openai",
      modelId: "gpt-5",
    });
  });

  it("clearDraftChatDefaults strips only the [default_chat]-seeded selections, preserving user content and the model pin", () => {
    // Called by the project-settings save when the block changed: the next /chat/new must
    // reseed Agent / Workspace / approval mode from the fresh defaults, while typed text,
    // staged skills, the handoff/switch chips and the switch-becomes-default model
    // carry-over (released only by clearDraftModelRef) all survive.
    const s = memStorage();
    saveDraft(
      draftKey("user-a1", "project-a"),
      {
        text: "typed but unsent",
        agentId: "old_default_agent",
        workspace: "/srv/old-default",
        approvalMode: "read-only",
        modelRef: { provider: "deepseek", modelId: "deepseek-v4-pro" },
        handoffAgentId: "agent_helper",
        switchModelRef: { provider: "openai", modelId: "gpt-5" },
        skills: ["agent-initialization"],
      },
      s,
    );
    clearDraftChatDefaults("user-a1", "project-a", s);
    expect(loadDraft(draftKey("user-a1", "project-a"), s)).toEqual({
      text: "typed but unsent",
      modelRef: { provider: "deepseek", modelId: "deepseek-v4-pro" },
      handoffAgentId: "agent_helper",
      switchModelRef: { provider: "openai", modelId: "gpt-5" },
      skills: ["agent-initialization"],
    });
  });

  it('clearDraftChatDefaults strips any subset of the three fields (a cached "" workspace counts) and is otherwise a no-op', () => {
    const s = memStorage();
    // A single seeded field is enough to rewrite; "" workspace is an explicit "auto temp"
    // pin and must be stripped like any other value (undefined-check, not truthiness).
    saveDraft(draftKey("user-a1", "project-a"), { text: "t", workspace: "" }, s);
    clearDraftChatDefaults("user-a1", "project-a", s);
    expect(loadDraft(draftKey("user-a1", "project-a"), s)).toEqual({ text: "t" });
    // Nothing seeded left (or no draft at all): a no-op, never an errant write.
    clearDraftChatDefaults("user-a1", "project-a", s);
    clearDraftChatDefaults("user-b2", "project-a", s);
    expect(s.map.has(draftKey("user-b2", "project-a"))).toBe(false);
    // Scoped by user × Project: another user's pins survive.
    saveDraft(draftKey("user-b2", "project-a"), { agentId: "default_agent" }, s);
    clearDraftChatDefaults("user-a1", "project-a", s);
    expect(loadDraft(draftKey("user-b2", "project-a"), s)).toEqual({ agentId: "default_agent" });
  });

  it("storage throwing (quota/private mode): save does not throw, load yields an empty draft", () => {
    const broken: DraftStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() => saveDraft(draftKey("u", "p"), { text: "x" }, broken)).not.toThrow();
    expect(() => clearDraft(draftKey("u", "p"), broken)).not.toThrow();
    expect(loadDraft(draftKey("u", "p"), broken)).toEqual({});
  });
});
