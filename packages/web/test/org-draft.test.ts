/**
 * org-draft.ts unit tests: the key's user and Project scope, the defensive parse of whatever
 * is in storage, what counts as a draft worth keeping, and the round trip through an injected
 * storage — including a storage that throws, which must cost the dialog nothing.
 */
import { describe, expect, it } from "vitest";
import type { DraftStorage, OrgCreateDraft } from "../src/features/company/org-draft";
import {
  EMPTY_ORG_DRAFT,
  clearOrgDraft,
  hasContent,
  loadOrgDraft,
  orgDraftKey,
  parseOrgDraft,
  saveOrgDraft,
  serializeOrgDraft,
} from "../src/features/company/org-draft";

const draft = (over: Partial<OrgCreateDraft> = {}): OrgCreateDraft => ({
  ...EMPTY_ORG_DRAFT,
  mission: "Ship the marketplace",
  ...over,
});

function memoryStorage(initial: Record<string, string> = {}): DraftStorage & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const throwingStorage: DraftStorage = {
  getItem: () => {
    throw new Error("private mode");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("quota");
  },
};

describe("orgDraftKey", () => {
  it("separates users and Projects, and gives a signed-out browser its own bucket", () => {
    expect(orgDraftKey("alice", "p1")).toBe("penguin.orgCreateDraft.alice.p1");
    expect(orgDraftKey("alice", "p1")).not.toBe(orgDraftKey("bob", "p1"));
    expect(orgDraftKey("alice", "p1")).not.toBe(orgDraftKey("alice", "p2"));
    expect(orgDraftKey(null, "p1")).toBe("penguin.orgCreateDraft..p1");
  });
});

describe("hasContent", () => {
  it("ignores the prefilled budget and reads every field the user types", () => {
    expect(hasContent(EMPTY_ORG_DRAFT)).toBe(false);
    expect(hasContent({ ...EMPTY_ORG_DRAFT, ceoBudget: "100" })).toBe(false);
    expect(hasContent({ ...EMPTY_ORG_DRAFT, mission: "  " })).toBe(false);
    expect(hasContent({ ...EMPTY_ORG_DRAFT, mission: "x" })).toBe(true);
    expect(hasContent({ ...EMPTY_ORG_DRAFT, orgId: "acme" })).toBe(true);
    expect(hasContent({ ...EMPTY_ORG_DRAFT, workspace: "/w" })).toBe(true);
    expect(hasContent({ ...EMPTY_ORG_DRAFT, model: { provider: "anthropic", modelId: "m" } })).toBe(
      true,
    );
  });
});

describe("parseOrgDraft", () => {
  it("round-trips a full draft", () => {
    const d = draft({
      orgId: "acme",
      name: "Acme",
      workspace: "/w",
      model: { provider: "anthropic", modelId: "claude" },
      ceoBudget: "250",
    });
    expect(parseOrgDraft(serializeOrgDraft(d))).toEqual(d);
  });

  it("answers nothing for absent, unparsable or empty stored values", () => {
    expect(parseOrgDraft(null)).toBeNull();
    expect(parseOrgDraft("")).toBeNull();
    expect(parseOrgDraft("{oops")).toBeNull();
    expect(parseOrgDraft("[]")).toBeNull();
    expect(parseOrgDraft("null")).toBeNull();
    expect(parseOrgDraft(serializeOrgDraft(EMPTY_ORG_DRAFT))).toBeNull();
  });

  it("keeps the fields it can read when others are the wrong shape", () => {
    // The mission is the expensive field: a mangled model reference must not cost it.
    expect(parseOrgDraft(JSON.stringify({ mission: "Ship it", model: 7, name: 3 }))).toEqual({
      ...EMPTY_ORG_DRAFT,
      mission: "Ship it",
    });
    expect(
      parseOrgDraft(JSON.stringify({ orgId: "acme", model: { provider: "anthropic" } })),
    ).toEqual({ ...EMPTY_ORG_DRAFT, orgId: "acme" });
  });
});

describe("loadOrgDraft / saveOrgDraft / clearOrgDraft", () => {
  it("stores a draft with content and removes the entry once it is empty again", () => {
    const storage = memoryStorage();
    const key = orgDraftKey("alice", "p1");
    saveOrgDraft(key, draft(), storage);
    expect(loadOrgDraft(key, storage)).toEqual(draft());
    saveOrgDraft(key, EMPTY_ORG_DRAFT, storage);
    expect(storage.map.has(key)).toBe(false);
    expect(loadOrgDraft(key, storage)).toBeNull();
  });

  it("clears one key and leaves another user's draft alone", () => {
    const storage = memoryStorage();
    saveOrgDraft(orgDraftKey("alice", "p1"), draft(), storage);
    saveOrgDraft(orgDraftKey("bob", "p1"), draft({ mission: "Bob's" }), storage);
    clearOrgDraft(orgDraftKey("alice", "p1"), storage);
    expect(loadOrgDraft(orgDraftKey("alice", "p1"), storage)).toBeNull();
    expect(loadOrgDraft(orgDraftKey("bob", "p1"), storage)?.mission).toBe("Bob's");
  });

  it("degrades to no draft when storage throws", () => {
    const key = orgDraftKey("alice", "p1");
    expect(loadOrgDraft(key, throwingStorage)).toBeNull();
    expect(() => saveOrgDraft(key, draft(), throwingStorage)).not.toThrow();
    expect(() => clearOrgDraft(key, throwingStorage)).not.toThrow();
  });
});
