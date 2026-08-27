/**
 * Gate + dismissal unit tests for the three DISMISSIBLE badge trails.
 *
 * The rule every case here defends is the one that makes a dismissal safe: what the badge is
 * dismissed against is WHAT is waiting, not the fact that something was. So dismissing hides
 * exactly the things that were waved away — including the rest of a batch after one of them is
 * dealt with — acting on the trail clears it on its own, and anything new — a later Skill
 * version, a different model, a newer error — raises it again.
 */
import { describe, expect, it } from "vitest";
import type { AgentSummary, UsageErrorsPage } from "@prismshadow/penguin-server/api";
import {
  presetUpdateTodo,
  raisedTodo,
  skillUpdateTodo,
  unexpectedErrorTodo,
} from "../src/lib/todo-badges";
import type { Todo } from "../src/lib/todo-badges";
import { parseTodoDismissMap, withDismissal } from "../src/lib/todo-dismissals";

/** Just the field the Skills gate reads (the gate takes a Pick, so the fixture can be one too). */
function agent(
  ...updates: Array<{ name: string; version: number }>
): Pick<AgentSummary, "skillUpdates"> {
  return { skillUpdates: updates };
}

function errorPage(total: number, ...timestamps: string[]): UsageErrorsPage {
  return {
    total,
    items: timestamps.map((ts) => ({
      ts,
      source: "runtime",
      code: "boom",
      kind: "unexpected",
      message: "boom",
    })),
  };
}

describe("skillUpdateTodo", () => {
  it("is null when no Agent is behind", () => {
    expect(skillUpdateTodo([agent(), agent()])).toBeNull();
  });

  it("counts distinct Skills, not Agents: the trail ends on a list that shows each once", () => {
    const todo = skillUpdateTodo([
      agent({ name: "web-design", version: 3 }),
      agent({ name: "web-design", version: 3 }, { name: "vllm", version: 2 }),
    ]);
    expect(todo).toEqual({
      signature: "vllm@2,web-design@3",
      items: ["vllm@2", "web-design@3"],
      count: 2,
      match: "set",
    });
  });

  it("is order-independent, so two loads of the same state dismiss alike", () => {
    const a = skillUpdateTodo([agent({ name: "b", version: 1 }, { name: "a", version: 2 })]);
    const b = skillUpdateTodo([agent({ name: "a", version: 2 }), agent({ name: "b", version: 1 })]);
    expect(a).toEqual(b);
  });

  it("keeps the highest library version when Agents disagree", () => {
    // One Agent behind v2 and another behind v3 is one Skill to update, at v3.
    const todo = skillUpdateTodo([
      agent({ name: "vllm", version: 2 }),
      agent({ name: "vllm", version: 3 }),
    ]);
    expect(todo).toEqual({ signature: "vllm@3", items: ["vllm@3"], count: 1, match: "set" });
  });

  it("survives an Agent list from a server that does not send the field", () => {
    // A newer web against an older runtime: no skillUpdates key at all, and no crash.
    expect(skillUpdateTodo([{} as Pick<AgentSummary, "skillUpdates">])).toBeNull();
  });
});

describe("presetUpdateTodo", () => {
  it("is null when the table already matches the catalog", () => {
    expect(presetUpdateTodo({ added: 0, updated: 0, refs: [] })).toBeNull();
  });

  it("counts the entries that would change and signs itself with them", () => {
    const todo = presetUpdateTodo({
      added: 1,
      updated: 1,
      refs: ["anthropic/claude-opus-5", "openai/gpt-5"],
    });
    expect(todo).toEqual({
      signature: "anthropic/claude-opus-5,openai/gpt-5",
      items: ["anthropic/claude-opus-5", "openai/gpt-5"],
      count: 2,
      match: "set",
    });
  });

  it("separates two deltas of the same size, so a different model still raises the dot", () => {
    const first = presetUpdateTodo({ added: 1, updated: 0, refs: ["a/one"] });
    const second = presetUpdateTodo({ added: 1, updated: 0, refs: ["b/two"] });
    expect(first!.count).toBe(second!.count);
    expect(first!.signature).not.toBe(second!.signature);
  });
});

describe("unexpectedErrorTodo", () => {
  it("is null on an empty window", () => {
    expect(unexpectedErrorTodo(errorPage(0))).toBeNull();
  });

  it("is null when the count is zero even if a row came back", () => {
    // Defensive: a total of 0 is the answer to "is anything waiting", and it wins.
    expect(unexpectedErrorTodo(errorPage(0, "2026-08-26T10:00:00.000Z"))).toBeNull();
  });

  it("signs itself with the newest error and counts the whole window", () => {
    expect(unexpectedErrorTodo(errorPage(7, "2026-08-26T10:00:00.000Z"))).toEqual({
      signature: "2026-08-26T10:00:00.000Z",
      items: ["2026-08-26T10:00:00.000Z"],
      count: 7,
      match: "watermark",
    });
  });

  it("does not move when only older rows are evicted", () => {
    // The row cap evicts oldest-first, so the newest timestamp — and the dismissal — holds.
    const before = unexpectedErrorTodo(errorPage(20000, "2026-08-26T10:00:00.000Z"));
    const after = unexpectedErrorTodo(errorPage(19800, "2026-08-26T10:00:00.000Z"));
    expect(after!.signature).toBe(before!.signature);
  });
});

describe("raisedTodo", () => {
  const todo: Todo = { signature: "vllm@2", items: ["vllm@2"], count: 1, match: "set" };

  it("is down when nothing is waiting", () => {
    expect(raisedTodo(null, null)).toBeNull();
    expect(raisedTodo(null, "vllm@2")).toBeNull();
  });

  it("is up when nothing was dismissed", () => {
    expect(raisedTodo(todo, null)).toEqual(todo);
  });

  it("is down for exactly what was dismissed", () => {
    expect(raisedTodo(todo, "vllm@2")).toBeNull();
  });

  it("comes back for a later version of the same thing", () => {
    // "Not this update" — never "never tell me about this Skill again".
    const later: Todo = { signature: "vllm@3", items: ["vllm@3"], count: 1, match: "set" };
    expect(raisedTodo(later, "vllm@2")).toEqual(later);
  });

  it("stays down for the rest of a batch after one of it was acted on", () => {
    // Two Skills dismissed together, then one updated: what is left is a SUBSET of what the
    // user waved away, and a shrinking set is not news.
    const rest: Todo = { signature: "b@3", items: ["b@3"], count: 1, match: "set" };
    expect(raisedTodo(rest, "a@2,b@3")).toBeNull();
  });
});

describe("todo dismissal markers", () => {
  it("reads nothing out of an absent, malformed or wrongly shaped record", () => {
    expect(parseTodoDismissMap(undefined)).toEqual({});
    expect(parseTodoDismissMap("skills")).toEqual({});
    expect(parseTodoDismissMap([])).toEqual({});
    expect(parseTodoDismissMap({ p1: "a@1" })).toEqual({});
  });

  it("keeps the string signatures and drops everything else, key by key", () => {
    // One bad value must not resurrect the other trails' dots.
    expect(parseTodoDismissMap({ p1: { skills: "a@1", models: 7, nope: "x" } })).toEqual({
      p1: { skills: "a@1" },
    });
  });

  it("merges into what a Project already dismissed and leaves other Projects alone", () => {
    // The whole map is what gets written back (PUT /me/prefs merges only at the top level),
    // so a dismissal must carry every other Project through untouched.
    expect(
      withDismissal({ p1: { skills: "a@1" }, p2: { errors: "t" } }, "p1", "models", "b/two"),
    ).toEqual({
      p1: { skills: "a@1", models: "b/two" },
      p2: { errors: "t" },
    });
  });
});
