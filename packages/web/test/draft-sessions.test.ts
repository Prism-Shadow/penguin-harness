/**
 * Parked draft conversations (draft-sessions.ts): parking moves the ACTIVE new-chat
 * draft into the per-user×Project list (model carry-over stays behind, like a
 * successful send), entries round-trip through validated storage, and corrupted
 * storage degrades to an empty list instead of crashing.
 *
 * Note: the module keeps an in-memory mirror keyed by storage key, so every test uses
 * its own user id to stay isolated from the others' keys.
 */
import { describe, expect, it } from "vitest";
import { draftKey, loadDraft, saveDraft } from "../src/features/chat/draft-cache";
import type { DraftStorage } from "../src/features/chat/draft-cache";
import {
  draftSessionsKey,
  draftSessionTitle,
  getDraftSession,
  parkActiveDraft,
  removeDraftSession,
  saveDraftSession,
} from "../src/features/chat/draft-sessions";

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

describe("parkActiveDraft", () => {
  it("moves a typed active draft into the parked list and keeps only the model carry-over", () => {
    const s = memStorage();
    saveDraft(
      draftKey("u-park", "proj"),
      {
        text: "half-written prompt",
        agentId: "default_agent",
        workspace: "/srv/repo",
        approvalMode: "read-only",
        modelRef: { provider: "anthropic", modelId: "claude-sonnet-5" },
        skills: ["ship-it"],
      },
      s,
    );
    const id = parkActiveDraft("u-park", "proj", s);
    expect(id).toMatch(/^draft-[0-9a-f]{8}$/);
    const entry = getDraftSession("u-park", "proj", id!, s);
    expect(entry?.draft.text).toBe("half-written prompt");
    expect(entry?.draft.agentId).toBe("default_agent");
    expect(entry?.draft.skills).toEqual(["ship-it"]);
    // The active slot keeps exactly the model pick (switch-becomes-default), nothing else.
    expect(loadDraft(draftKey("u-park", "proj"), s)).toEqual({
      modelRef: { provider: "anthropic", modelId: "claude-sonnet-5" },
    });
  });

  it("parks nothing when the active draft has no typed text (empty or whitespace)", () => {
    const s = memStorage();
    expect(parkActiveDraft("u-empty", "proj", s)).toBeNull();
    saveDraft(draftKey("u-empty", "proj"), { text: "   \n", agentId: "a" }, s);
    expect(parkActiveDraft("u-empty", "proj", s)).toBeNull();
    // The untouched draft (selections only) stays where it was.
    expect(loadDraft(draftKey("u-empty", "proj"), s).agentId).toBe("a");
  });

  it("newest parked draft sorts first", () => {
    const s = memStorage();
    saveDraft(draftKey("u-order", "proj"), { text: "first" }, s);
    const first = parkActiveDraft("u-order", "proj", s)!;
    saveDraft(draftKey("u-order", "proj"), { text: "second" }, s);
    const second = parkActiveDraft("u-order", "proj", s)!;
    const raw = JSON.parse(s.map.get(draftSessionsKey("u-order", "proj"))!) as { id: string }[];
    expect(raw.map((e) => e.id)).toEqual([second, first]);
  });
});

describe("saveDraftSession / removeDraftSession", () => {
  it("updates an entry's content in place and is a no-op for unknown ids", () => {
    const s = memStorage();
    saveDraft(draftKey("u-save", "proj"), { text: "v1" }, s);
    const id = parkActiveDraft("u-save", "proj", s)!;
    const savedAt = getDraftSession("u-save", "proj", id, s)!.savedAt;
    saveDraftSession("u-save", "proj", id, { text: "v2 edited" }, s);
    const entry = getDraftSession("u-save", "proj", id, s)!;
    expect(entry.draft.text).toBe("v2 edited");
    expect(entry.savedAt).toBe(savedAt); // edits don't reorder the list
    // Unknown id (deleted elsewhere): nothing is created.
    saveDraftSession("u-save", "proj", "draft-deadbeef", { text: "ghost" }, s);
    expect(getDraftSession("u-save", "proj", "draft-deadbeef", s)).toBeNull();
  });

  it("removes entries idempotently and clears the storage key when the list empties", () => {
    const s = memStorage();
    saveDraft(draftKey("u-rm", "proj"), { text: "bye" }, s);
    const id = parkActiveDraft("u-rm", "proj", s)!;
    removeDraftSession("u-rm", "proj", id, s);
    expect(getDraftSession("u-rm", "proj", id, s)).toBeNull();
    expect(s.map.has(draftSessionsKey("u-rm", "proj"))).toBe(false);
    removeDraftSession("u-rm", "proj", id, s); // second remove: no throw, no write
  });
});

describe("stored-list validation", () => {
  it("corrupted storage degrades to an empty list; malformed entries are dropped field-by-field", () => {
    const s = memStorage();
    s.map.set(draftSessionsKey("u-bad", "proj"), "{not json");
    expect(getDraftSession("u-bad", "proj", "draft-x", s)).toBeNull();
    const s2 = memStorage();
    s2.map.set(
      draftSessionsKey("u-bad2", "proj"),
      JSON.stringify([
        { id: "not-a-draft-id", draft: { text: "dropped" } },
        42,
        { id: "draft-ok", savedAt: 7, draft: { text: "kept", skills: [1, "real"] } },
      ]),
    );
    const entry = getDraftSession("u-bad2", "proj", "draft-ok", s2);
    expect(entry).not.toBeNull();
    expect(entry?.savedAt).toBe(""); // non-string savedAt normalized
    expect(entry?.draft.text).toBe("kept");
    expect(entry?.draft.skills).toEqual(["real"]); // non-string skill filtered
    expect(getDraftSession("u-bad2", "proj", "not-a-draft-id", s2)).toBeNull();
  });
});

describe("draftSessionTitle", () => {
  it("uses the first non-empty line, trimmed and capped", () => {
    expect(
      draftSessionTitle({
        id: "draft-1",
        savedAt: "",
        draft: { text: "\n\n  Hello world \nrest" },
      }),
    ).toBe("Hello world");
    expect(draftSessionTitle({ id: "draft-2", savedAt: "", draft: {} })).toBe("");
    expect(
      draftSessionTitle({ id: "draft-3", savedAt: "", draft: { text: "x".repeat(200) } }),
    ).toHaveLength(80);
  });
});
