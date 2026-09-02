/**
 * chat-mentions.ts unit tests: the candidate list, its filter and its ranking, what a pick
 * types, the @-token at the caret, splicing a pick into the draft, splitting a stored
 * message into plain and mention runs by the server's own token grammar, and what a
 * mention run displays and whom it addresses.
 */
import { describe, expect, it } from "vitest";
import {
  filterMentionCandidates,
  insertMention,
  mentionCandidates,
  mentionInsertId,
  mentionIsMe,
  mentionLabel,
  mentionQueryAt,
  mentionRuns,
  mentionsUser,
  rankMentionCandidates,
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

describe("mentionCandidates with titles", () => {
  it("carries an employee's title as the detail and leaves a blank one out", () => {
    const list = mentionCandidates(
      [
        { agentId: "ceo", name: "Alice", title: "CEO" },
        { agentId: "pm", name: "Product", title: "  " },
      ],
      [],
      "Everyone",
    );
    expect(list[0]?.detail).toBe("CEO");
    expect("detail" in list[1]!).toBe(false);
  });
});

describe("rankMentionCandidates", () => {
  const list = mentionCandidates(
    [
      { agentId: "studio_ceo", name: "Penguin CEO" },
      { agentId: "studio_cto", name: "Tech Lead" },
      { agentId: "ops", name: "Studio Ops" },
    ],
    ["stu", "bob"],
    "Everyone",
  );

  it("keeps the list's own order for an empty query", () => {
    expect(rankMentionCandidates(list, "").map((c) => c.id)).toEqual([
      "studio_ceo",
      "studio_cto",
      "ops",
      "stu",
      "bob",
      "all",
    ]);
  });

  it("puts id and name prefixes above substring matches, ties in list order", () => {
    // "stu": prefixes on studio_ceo / studio_cto / Studio Ops (name) / stu; nothing else.
    expect(rankMentionCandidates(list, "stu").map((c) => c.id)).toEqual([
      "studio_ceo",
      "studio_cto",
      "ops",
      "stu",
    ]);
    // "lead": a substring of the name only.
    expect(rankMentionCandidates(list, "LEAD").map((c) => c.id)).toEqual(["studio_cto"]);
    // "cto" is a prefix of nothing but is contained in studio_cto.
    expect(rankMentionCandidates(list, "cto").map((c) => c.id)).toEqual(["studio_cto"]);
    // A principal prefix reaches the members.
    expect(rankMentionCandidates(list, "user:").map((c) => c.id)).toEqual(["stu", "bob"]);
    expect(rankMentionCandidates(list, "zzz")).toEqual([]);
  });
});

describe("mentionInsertId", () => {
  it("types a bare id, and disambiguates a member who shares an employee's id", () => {
    const list = mentionCandidates([{ agentId: "alice", name: "Alice" }], ["alice", "bob"], "All");
    expect(mentionInsertId(list[0]!, list)).toBe("alice");
    expect(mentionInsertId(list[1]!, list)).toBe("user:alice");
    expect(mentionInsertId(list[2]!, list)).toBe("bob");
    expect(mentionInsertId(list[3]!, list)).toBe("all");
  });
});

describe("mentionLabel and mentionIsMe", () => {
  const names = new Map([["ceo", "Alice"]]);
  const employees = new Set(["ceo", "bob"]);

  it("resolves an agent id to its name, a member to its id, all to the everyone label", () => {
    expect(mentionLabel("agent:ceo", names, "Everyone")).toBe("Alice");
    expect(mentionLabel("ceo", names, "Everyone")).toBe("Alice");
    expect(mentionLabel("user:bob", names, "Everyone")).toBe("bob");
    expect(mentionLabel("unknown", names, "Everyone")).toBe("unknown");
    expect(mentionLabel("all", names, "Everyone")).toBe("Everyone");
  });

  it("addresses the reader by principal, by all, or by bare id when no employee claims it", () => {
    expect(mentionIsMe("user:bob", "bob", employees)).toBe(true);
    expect(mentionIsMe("all", "bob", employees)).toBe(true);
    // The server gives a bare "bob" to the employee of that id, not the member.
    expect(mentionIsMe("bob", "bob", employees)).toBe(false);
    expect(mentionIsMe("carol", "carol", employees)).toBe(true);
    expect(mentionIsMe("all", "", employees)).toBe(false);
  });
});
