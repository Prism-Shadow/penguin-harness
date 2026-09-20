import { describe, expect, it } from "vitest";
import { employeeNameProblem, employeeNames, findMentions } from "../src/organization/names.js";
import type { MentionHandle } from "../src/organization/names.js";

const e = (agentId: string, name?: string) => ({
  agentId,
  ...(name !== undefined ? { name } : {}),
});

describe("employee names", () => {
  it("keeps a name nobody else has, and notes the id on every holder of a shared one", () => {
    const names = employeeNames(
      [e("acme_ceo", "老王"), e("acme_dev_a", "小明"), e("acme_dev_b", "小明"), e("acme_qa")],
      (id) => id,
    );
    expect(Object.fromEntries(names)).toEqual({
      acme_ceo: "老王",
      acme_dev_a: "小明 (acme_dev_a)",
      acme_dev_b: "小明 (acme_dev_b)",
      acme_qa: "acme_qa",
    });
  });

  it("falls back to the Agent's display name, which can collide like any other", () => {
    const names = employeeNames([e("a_one"), e("a_two", "Robin")], () => "Robin");
    expect([...names.values()]).toEqual(["Robin (a_one)", "Robin (a_two)"]);
  });

  it("never lets a name shadow what @ already means: another's id, a member, all", () => {
    const names = employeeNames(
      [e("a_one", "a_two"), e("a_two"), e("a_three", "all"), e("a_four", "alice")],
      (id) => id,
      new Set(["alice"]),
    );
    expect(Object.fromEntries(names)).toEqual({
      a_one: "a_two (a_one)",
      a_two: "a_two",
      a_three: "all (a_three)",
      a_four: "alice (a_four)",
    });
  });

  it("accepts any script and spaces, and refuses what would break a line or a mention", () => {
    expect(employeeNameProblem("小明")).toBeNull();
    expect(employeeNameProblem("Ada Lovelace")).toBeNull();
    expect(employeeNameProblem("   ")).not.toBeNull();
    expect(employeeNameProblem("a\nb")).not.toBeNull();
    expect(employeeNameProblem("x@y")).not.toBeNull();
    expect(employeeNameProblem("x".repeat(65))).not.toBeNull();
  });
});

describe("mentions", () => {
  const handles: MentionHandle[] = [
    { handle: "acme_dev_a", principal: "agent:acme_dev_a" },
    { handle: "小明", principal: "agent:acme_dev_a" },
    { handle: "小明明", principal: "agent:acme_dev_b" },
    { handle: "Ada Lovelace", principal: "agent:acme_ada" },
    { handle: "ann", principal: "user:ann" },
    { handle: "all", principal: "all" },
  ];
  const explicit = (kind: "agent" | "user", id: string) =>
    kind === "agent" && id === "acme_dev_a" ? "agent:acme_dev_a" : null;
  const found = (text: string) =>
    findMentions(text, handles, explicit).map((m) => [text.slice(m.start, m.end), m.principal]);

  it("reaches the same employee by id and by name", () => {
    expect(found("@acme_dev_a 看一下，@小明 也看一下")).toEqual([
      ["@acme_dev_a", "agent:acme_dev_a"],
      ["@小明", "agent:acme_dev_a"],
    ]);
  });

  it("needs no space after a name in a script that has none, and takes the longest name", () => {
    expect(found("@小明你好")).toEqual([["@小明", "agent:acme_dev_a"]]);
    expect(found("@小明明你好")).toEqual([["@小明明", "agent:acme_dev_b"]]);
  });

  it("matches a name with a space in it, whole", () => {
    expect(found("ping @Ada Lovelace please")).toEqual([["@Ada Lovelace", "agent:acme_ada"]]);
  });

  it("ends an ASCII handle at the end of its word, and leaves addresses and unknowns as text", () => {
    expect(found("@anna and mail me at bob@ann.example, @nobody")).toEqual([]);
    expect(found("(@ann) @all.")).toEqual([
      ["@ann", "user:ann"],
      ["@all", "all"],
    ]);
  });

  it("keeps the explicit forms", () => {
    expect(found("@agent:acme_dev_a. and @agent:ghost")).toEqual([
      ["@agent:acme_dev_a", "agent:acme_dev_a"],
    ]);
  });
});
