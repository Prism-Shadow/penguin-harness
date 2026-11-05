/**
 * channel-mentions.ts unit tests: the candidate list, its narrowing to a channel's own
 * membership, its filter and its ranking, what a pick types, the @-token at the caret,
 * splicing a pick into the draft, splitting a stored message into plain and mention runs by
 * the server's own token grammar, and what a mention run displays and whom it addresses.
 */
import { describe, expect, it } from "vitest";
import {
  channelMentionCandidates,
  mentionCandidates,
  mentionInsertId,
  mentionIsMe,
  mentionLabel,
  mentionNote,
  mentionNameHandles,
  mentionQueryAt,
  mentionRuns,
  rankMentionCandidates,
} from "../src/features/company/channel-mentions";

const candidates = mentionCandidates(
  [
    { agentId: "ceo", name: "Alice" },
    { agentId: "pm", name: "Product" },
  ],
  ["bob"],
  "Everyone",
);

describe("mentionCandidates", () => {
  it("lists employees, then members, then all, with their principals", () => {
    expect(candidates.map((c) => c.principal)).toEqual([
      "agent:ceo",
      "agent:pm",
      "user:bob",
      "all",
    ]);
    expect(candidates[3]).toEqual({ principal: "all", label: "Everyone", id: "all", kind: "all" });
  });
});

describe("mentionQueryAt", () => {
  it("finds the token the caret ends and reports what was typed after the @", () => {
    expect(mentionQueryAt("hi @ce", 6)).toEqual({ start: 3, query: "ce" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("@agent:c", 8)).toEqual({ start: 0, query: "agent:c" });
  });

  it("reads a name typed in any script, glued to CJK text before the @", () => {
    expect(mentionQueryAt("请@张", 3)).toEqual({ start: 1, query: "张" });
    expect(mentionQueryAt("@Ada", 4)).toEqual({ start: 0, query: "Ada" });
  });

  it("is null when the @ is glued to a word, when a space breaks the token, or when there is none", () => {
    expect(mentionQueryAt("mail@ex", 7)).toBeNull();
    expect(mentionQueryAt("@ceo please", 11)).toBeNull();
    expect(mentionQueryAt("plain", 5)).toBeNull();
    expect(mentionQueryAt("@Ada, hi", 8)).toBeNull();
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
  it("sends a bare id, and disambiguates a member who shares an employee's id", () => {
    const list = mentionCandidates([{ agentId: "alice", name: "Alice" }], ["alice", "bob"], "All");
    // The draft shows the name (mention-draft.ts); the wire keeps the id.
    expect(mentionInsertId(list[0]!, list)).toBe("alice");
    expect(mentionInsertId(list[1]!, list)).toBe("user:alice");
    expect(mentionInsertId(list[2]!, list)).toBe("bob");
    expect(mentionInsertId(list[3]!, list)).toBe("all");
  });
});

describe("mentions by name", () => {
  const names = mentionNameHandles(
    new Map([
      ["acme_dev_a", "小明"],
      ["acme_dev_b", "小明明"],
      ["acme_ada", "Ada Lovelace"],
      ["acme_qa", "acme_qa"],
    ]),
  );

  it("keeps the panel open while a name in any script is being typed", () => {
    expect(mentionQueryAt("请 @小", 4)).toEqual({ start: 2, query: "小" });
    expect(mentionQueryAt("@Ada L", 6)).toBeNull();
  });

  it("finds a name without a space after it, takes the longest, and tokens it as the employee", () => {
    expect(mentionRuns("@小明你好", names)).toEqual([
      { text: "@小明", mention: "agent:acme_dev_a" },
      { text: "你好", mention: null },
    ]);
    expect(mentionRuns("@小明明你好", names)[0]).toEqual({
      text: "@小明明",
      mention: "agent:acme_dev_b",
    });
    expect(mentionRuns("ping @Ada Lovelace please", names)[1]).toEqual({
      text: "@Ada Lovelace",
      mention: "agent:acme_ada",
    });
  });

  it("ends a handle where the server does: not before a - or . that runs on into a word", () => {
    const mentions = (text: string) =>
      mentionRuns(text, names)
        .filter((r) => r.mention)
        .map((r) => [r.text, r.mention]);
    // An id-shaped token takes the whole run, as the server reads it: `@all-hands` is not `all`.
    expect(mentions("@all-hands and @all.hands")).toEqual([
      ["@all-hands", "all-hands"],
      ["@all.hands", "all.hands"],
    ]);
    // A name is not found in front of one either…
    expect(mentions("ping @Ada Lovelace-x and @Ada Lovelace.y")).toEqual([
      ["@Ada", "Ada"],
      ["@Ada", "Ada"],
    ]);
    // …while a sentence's own punctuation after it is no part of it.
    expect(mentions("thanks @Ada Lovelace. And @Ada Lovelace, @all.")).toEqual([
      ["@Ada Lovelace", "agent:acme_ada"],
      ["@Ada Lovelace", "agent:acme_ada"],
      ["@all", "all"],
    ]);
    // A name in a script without word boundaries needs none.
    expect(mentions("@小明-你好 @小明.ok")).toEqual([
      ["@小明", "agent:acme_dev_a"],
      ["@小明", "agent:acme_dev_a"],
    ]);
  });

  it("still reads ids and the explicit forms, and offers no handle for a name that is just the id", () => {
    expect(names.has("acme_qa")).toBe(false);
    expect(mentionRuns("@acme_qa and @agent:acme_dev_a.", names).filter((r) => r.mention)).toEqual([
      { text: "@acme_qa", mention: "acme_qa" },
      { text: "@agent:acme_dev_a", mention: "agent:acme_dev_a" },
    ]);
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

describe("channelMentionCandidates", () => {
  const list = mentionCandidates(
    [
      { agentId: "ceo", name: "Alice" },
      { agentId: "pm", name: "Product" },
    ],
    ["bob", "carol"],
    "Everyone",
  );

  it("keeps only the channel's members, and `all` — which means that membership", () => {
    const members = new Set(["agent:pm", "user:carol"]);
    expect(channelMentionCandidates(list, members).map((c) => c.principal)).toEqual([
      "agent:pm",
      "user:carol",
      "all",
    ]);
  });

  it("offers everyone when the membership is not known yet, rather than an empty panel", () => {
    expect(channelMentionCandidates(list, null).map((c) => c.principal)).toEqual([
      "agent:ceo",
      "agent:pm",
      "user:bob",
      "user:carol",
      "all",
    ]);
  });

  it("is `all` alone in a channel whose only member is the reader's own employee-free self", () => {
    expect(channelMentionCandidates(list, new Set()).map((c) => c.principal)).toEqual(["all"]);
  });
});

describe("mentionNote", () => {
  const titles = new Map([
    ["ceo", "CEO"],
    ["dev", "  "],
  ]);

  it("is the employee's title, for a prefixed or a bare id", () => {
    expect(mentionNote("agent:ceo", titles)).toBe("CEO");
    expect(mentionNote("ceo", titles)).toBe("CEO");
  });

  it("is empty for a member, for all, for an employee without a title and for an unknown id", () => {
    expect(mentionNote("user:ceo", titles)).toBe("");
    expect(mentionNote("all", titles)).toBe("");
    expect(mentionNote("agent:dev", titles)).toBe("");
    expect(mentionNote("nobody", titles)).toBe("");
  });
});
