/**
 * chat-mentions.ts unit tests: the candidate list and its filter, the @-token at the caret,
 * splicing a pick into the draft, and splitting a stored message into plain and mention runs
 * by the server's own token grammar.
 */
import { describe, expect, it } from "vitest";
import {
  filterMentionCandidates,
  insertMention,
  mentionCandidates,
  mentionQueryAt,
  mentionRuns,
  mentionsUser,
} from "../src/features/company/chat-mentions";

const candidates = mentionCandidates(
  [
    { agentId: "ceo", name: "Alice" },
    { agentId: "pm", name: "Product" },
  ],
  ["bob"],
  "Everyone",
);

describe("mentionCandidates and filterMentionCandidates", () => {
  it("lists employees, then members, then all, with their principals", () => {
    expect(candidates.map((c) => c.principal)).toEqual([
      "agent:ceo",
      "agent:pm",
      "user:bob",
      "all",
    ]);
    expect(candidates[3]).toEqual({ principal: "all", label: "Everyone", id: "all", kind: "all" });
  });

  it("matches the id, the label or the full principal, case-insensitively", () => {
    expect(filterMentionCandidates(candidates, "ali").map((c) => c.id)).toEqual(["ceo"]);
    expect(filterMentionCandidates(candidates, "user:").map((c) => c.id)).toEqual(["bob"]);
    expect(filterMentionCandidates(candidates, "").length).toBe(4);
    expect(filterMentionCandidates(candidates, "zzz")).toEqual([]);
  });
});

describe("mentionQueryAt", () => {
  it("finds the token the caret ends and reports what was typed after the @", () => {
    expect(mentionQueryAt("hi @ce", 6)).toEqual({ start: 3, query: "ce" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("@agent:c", 8)).toEqual({ start: 0, query: "agent:c" });
  });

  it("is null when the @ is glued to a word, when a space breaks the token, or when there is none", () => {
    expect(mentionQueryAt("mail@ex", 7)).toBeNull();
    expect(mentionQueryAt("@ceo please", 11)).toBeNull();
    expect(mentionQueryAt("plain", 5)).toBeNull();
  });
});

describe("insertMention", () => {
  it("replaces the typed token with the principal and a trailing space, moving the caret after it", () => {
    expect(insertMention("hi @ce there", 3, 6, "agent:ceo")).toEqual({
      text: "hi @agent:ceo  there",
      caret: 14,
    });
  });
});

describe("mentionRuns", () => {
  it("splits plain text and mentions in order, keeping the server's trailing-punctuation rule", () => {
    expect(mentionRuns("@ceo, ping @user:bob. cc @all")).toEqual([
      { text: "@ceo", mention: "ceo" },
      { text: ", ping ", mention: null },
      { text: "@user:bob", mention: "user:bob" },
      { text: ". cc ", mention: null },
      { text: "@all", mention: "all" },
    ]);
  });

  it("leaves an email address alone and returns one plain run for text without mentions", () => {
    expect(mentionRuns("write to me@example.com")).toEqual([
      { text: "write to me@example.com", mention: null },
    ]);
    expect(mentionRuns("")).toEqual([]);
  });
});

describe("mentionsUser", () => {
  it("is addressed by the user's own principal or by all", () => {
    expect(mentionsUser(["agent:ceo", "user:bob"], "bob")).toBe(true);
    expect(mentionsUser(["all"], "bob")).toBe(true);
    expect(mentionsUser(["user:alice"], "bob")).toBe(false);
  });
});
