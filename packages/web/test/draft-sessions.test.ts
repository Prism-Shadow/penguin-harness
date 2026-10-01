/**
 * Parked draft conversations (features/chat/draft-sessions.ts), per user and Project. The
 * module keeps an in-memory mirror keyed by storage key, so every test uses its own user id.
 *
 * - Parking moves a typed active draft into the list, leaving only the model carry-over in
 *   the active slot; an untyped draft parks nothing, and an AI-composed prompt is dropped
 *   rather than parked. The newest parked draft sorts first.
 * - An entry updates in place (unknown ids change nothing); removing is idempotent and the
 *   stored key goes with the last entry.
 * - Corrupted storage reads as an empty list, malformed entries dropped field by field.
 * - A parked draft is titled by its first non-empty line, trimmed and capped.
 */
import { describe, expect, it } from "vitest";
import { draftKey, loadDraft, saveDraft } from "../src/features/chat/draft-cache";
import {
  draftSessionsKey,
  draftSessionTitle,
  getDraftSession,
  parkActiveDraft,
  removeDraftSession,
  saveDraftSession,
} from "../src/features/chat/draft-sessions";

import { memoryStorage } from "./helpers/storage";

describe("parkActiveDraft", () => {
  it("moves a typed active draft into the parked list and keeps only the model carry-over", () => {
    const s = memoryStorage();
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
    const s = memoryStorage();
    expect(parkActiveDraft("u-empty", "proj", s)).toBeNull();
    saveDraft(draftKey("u-empty", "proj"), { text: "   \n", agentId: "a" }, s);
    expect(parkActiveDraft("u-empty", "proj", s)).toBeNull();
    // The untouched draft (selections only) stays where it was.
    expect(loadDraft(draftKey("u-empty", "proj"), s).agentId).toBe("a");
  });

  it("drops an AI-composed prompt instead of parking it, keeping the model carry-over", () => {
    const s = memoryStorage();
    saveDraft(
      draftKey("u-ai", "proj"),
      {
        text: "Create a vault entry for OPENAI_API_KEY",
        agentId: "default_agent",
        modelRef: { provider: "anthropic", modelId: "claude-sonnet-5" },
        aiPrefill: true,
      },
      s,
    );
    // Nobody typed it, so it must not become a draft conversation row — and the slot this
    // vacates must be empty, or the new-chat draft the caller lands on would read it back.
    expect(parkActiveDraft("u-ai", "proj", s)).toBeNull();
    expect(s.map.has(draftSessionsKey("u-ai", "proj"))).toBe(false);
    expect(loadDraft(draftKey("u-ai", "proj"), s)).toEqual({
      modelRef: { provider: "anthropic", modelId: "claude-sonnet-5" },
    });
  });

  it("newest parked draft sorts first", () => {
    const s = memoryStorage();
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
    const s = memoryStorage();
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
    const s = memoryStorage();
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
    const s = memoryStorage();
    s.map.set(draftSessionsKey("u-bad", "proj"), "{not json");
    expect(getDraftSession("u-bad", "proj", "draft-x", s)).toBeNull();
    const s2 = memoryStorage();
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
