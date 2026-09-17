/**
 * What a "New chat" entry point starts (src/features/chat/new-chat.ts):
 * - newChatAgentId: the Project's `[default_chat].agent_id` while it names a listed Agent, else
 *   default_agent, else the first Agent;
 * - prepareNewChatDraft: parks typed text, then releases the Agent / Workspace / approval-mode
 *   selections an earlier visit left in the active slot, keeping the model carry-over and
 *   staged skills.
 *
 * Note: draft-sessions.ts keeps an in-memory mirror keyed by storage key, so every test uses
 * its own user id to stay isolated from the others' keys.
 */
import { describe, expect, it } from "vitest";
import type { AgentSummary } from "@prismshadow/penguin-server/api";
import { draftKey, loadDraft, saveDraft } from "../src/features/chat/draft-cache";
import type { DraftStorage } from "../src/features/chat/draft-cache";
import { getDraftSession } from "../src/features/chat/draft-sessions";
import { newChatAgentId, prepareNewChatDraft } from "../src/features/chat/new-chat";

const agent = (agentId: string) => ({ agentId }) as AgentSummary;

/** In-memory storage (vitest runs in a Node environment, no localStorage). */
function memStorage(): DraftStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("newChatAgentId", () => {
  const agents = [agent("coder"), agent("default_agent"), agent("writer")];

  it("starts on the Project's default Agent when one is set, ahead of default_agent", () => {
    expect(newChatAgentId(agents, { agentId: "writer" })).toBe("writer");
  });

  it("falls back to default_agent when no default is set, wherever it sits in the list", () => {
    expect(newChatAgentId(agents, {})).toBe("default_agent");
    expect(newChatAgentId(agents, { workspace: "/srv/repo", approvalMode: "read-only" })).toBe(
      "default_agent",
    );
    expect(newChatAgentId(agents, null)).toBe("default_agent");
  });

  it("ignores a default that no longer names an Agent of the Project", () => {
    expect(newChatAgentId(agents, { agentId: "deleted_agent" })).toBe("default_agent");
  });

  it("falls back to the first Agent without default_agent, and to null for an empty list", () => {
    expect(newChatAgentId([agent("coder"), agent("writer")], {})).toBe("coder");
    expect(newChatAgentId([agent("coder"), agent("writer")], { agentId: "gone" })).toBe("coder");
    expect(newChatAgentId([], { agentId: "writer" })).toBeNull();
  });
});

describe("prepareNewChatDraft", () => {
  it("releases the selections a text-less draft left behind, keeping the model and staged skills", () => {
    const s = memStorage();
    // What an abandoned Workspace-group "+" leaves: its path and an Agent, pinned by the draft
    // page's persist-on-mount, with nothing typed.
    saveDraft(
      draftKey("u-release", "proj"),
      {
        text: "",
        agentId: "coder",
        workspace: "/srv/group-path",
        approvalMode: "read-only",
        modelRef: { provider: "deepseek", modelId: "deepseek-v4-pro" },
        skills: ["ship-it"],
      },
      s,
    );
    expect(prepareNewChatDraft("u-release", "proj", s)).toBeNull();
    expect(loadDraft(draftKey("u-release", "proj"), s)).toEqual({
      text: "",
      modelRef: { provider: "deepseek", modelId: "deepseek-v4-pro" },
      skills: ["ship-it"],
    });
  });

  it("parks typed text with its selections, leaving only the model carry-over in the slot", () => {
    const s = memStorage();
    saveDraft(
      draftKey("u-typed", "proj"),
      {
        text: "half-written prompt",
        agentId: "coder",
        workspace: "/srv/repo",
        approvalMode: "read-only",
        modelRef: { provider: "anthropic", modelId: "claude-sonnet-5" },
      },
      s,
    );
    const id = prepareNewChatDraft("u-typed", "proj", s);
    expect(id).toMatch(/^draft-[0-9a-f]{8}$/);
    expect(loadDraft(draftKey("u-typed", "proj"), s)).toEqual({
      modelRef: { provider: "anthropic", modelId: "claude-sonnet-5" },
    });
    // The parked entry is the only record of the typed draft, so it keeps every selection.
    expect(getDraftSession("u-typed", "proj", id!, s)?.draft).toMatchObject({
      text: "half-written prompt",
      agentId: "coder",
      workspace: "/srv/repo",
      approvalMode: "read-only",
    });
  });

  it("is a no-op on an empty slot", () => {
    const s = memStorage();
    expect(prepareNewChatDraft("u-empty", "proj", s)).toBeNull();
    expect(loadDraft(draftKey("u-empty", "proj"), s)).toEqual({});
  });
});
