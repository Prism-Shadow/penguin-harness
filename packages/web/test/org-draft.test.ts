/**
 * The create-organization dialog's draft (features/company/org-draft.ts), kept in
 * localStorage per user and Project.
 *
 * - Two users, two Projects and a signed-out browser each get their own draft.
 * - A draft is worth keeping once the user typed something; the prefilled budget does not count.
 * - A full draft round-trips; an absent, unparsable or empty stored value reads as no draft,
 *   and a wrong-shaped field costs only itself.
 * - A draft with content is stored and removed once empty again; clearing one key leaves
 *   another user's draft alone; a storage that throws costs the dialog nothing.
 */
import { describe, expect, it } from "vitest";
import type { OrgCreateDraft } from "../src/features/company/org-draft";
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
import { blockedStorage, memoryStorage } from "./helpers/storage";

const draft = (over: Partial<OrgCreateDraft> = {}): OrgCreateDraft => ({
  ...EMPTY_ORG_DRAFT,
  mission: "Ship the marketplace",
  ...over,
});

const throwingStorage = blockedStorage();

describe("orgDraftKey", () => {
  it("separates users and Projects, and gives a signed-out browser its own bucket", () => {
    const keys = [
      orgDraftKey("alice", "p1"),
      orgDraftKey("bob", "p1"),
      orgDraftKey("alice", "p2"),
      orgDraftKey(null, "p1"),
    ];
    expect(new Set(keys).size).toBe(keys.length);
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
