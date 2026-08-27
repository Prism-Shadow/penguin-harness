/**
 * Gate + dismissal unit tests for the three DISMISSIBLE badge trails.
 *
 * The rule every case here defends is the one that makes a dismissal safe: what the badge is
 * dismissed against is WHAT is waiting, not the fact that something was. So dismissing hides
 * exactly the thing that was waved away, acting on the trail clears it on its own, and
 * anything new — a later Skill version, a different model, a newer error — raises it again.
 */
import { describe, expect, it } from "vitest";
import type { AgentSummary, UsageErrorsPage } from "@prismshadow/penguin-server/api";
import {
  presetUpdateTodo,
  raisedTodo,
  skillUpdateTodo,
  unexpectedErrorTodo,
} from "../src/lib/todo-badges";
import {
  dismissTodo,
  parseTodoDismissals,
  todoDismissKey,
  withDismissal,
} from "../src/lib/todo-dismissals";
import type { TodoDismissStorage } from "../src/lib/todo-dismissals";

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

/** In-memory storage (vitest runs in a Node environment, no localStorage; pinned-sessions.test.ts convention). */
function memStorage(entries: Record<string, string> = {}): TodoDismissStorage & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(entries));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
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
    expect(todo).toEqual({ signature: "vllm@2,web-design@3", count: 2 });
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
    expect(todo).toEqual({ signature: "vllm@3", count: 1 });
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
    expect(todo).toEqual({ signature: "anthropic/claude-opus-5,openai/gpt-5", count: 2 });
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
      count: 7,
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
  const todo = { signature: "vllm@2", count: 1 };

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
    expect(raisedTodo({ signature: "vllm@3", count: 1 }, "vllm@2")).toEqual({
      signature: "vllm@3",
      count: 1,
    });
  });
});

describe("todo dismissals storage", () => {
  it("reads nothing out of an absent, malformed or wrongly shaped record", () => {
    expect(parseTodoDismissals(null)).toEqual({});
    expect(parseTodoDismissals("{oops")).toEqual({});
    expect(parseTodoDismissals("[]")).toEqual({});
    expect(parseTodoDismissals('"skills"')).toEqual({});
  });

  it("keeps the string signatures and drops everything else, key by key", () => {
    // One bad value must not resurrect the other trails' dots.
    expect(parseTodoDismissals('{"skills":"a@1","models":7,"nope":"x"}')).toEqual({
      skills: "a@1",
    });
  });

  it("replaces one trail's marker and leaves the others alone", () => {
    expect(withDismissal({ skills: "a@1", errors: "t" }, "skills", "a@2")).toEqual({
      skills: "a@2",
      errors: "t",
    });
  });

  it("persists per Project, under the project-suffixed key", () => {
    const storage = memStorage();
    dismissTodo("p1", "models", "a/one", storage);
    dismissTodo("p2", "models", "b/two", storage);
    expect(storage.map.get(todoDismissKey("p1"))).toBe('{"models":"a/one"}');
    expect(storage.map.get(todoDismissKey("p2"))).toBe('{"models":"b/two"}');
  });

  it("merges into what a Project already dismissed", () => {
    // A Project id of its own: the module caches parsed records by storage key for the
    // lifetime of the process, so reusing one from another case would read that case's write.
    const storage = memStorage({ [todoDismissKey("p3")]: '{"skills":"a@1"}' });
    dismissTodo("p3", "errors", "2026-08-26T00:00:00.000Z", storage);
    expect(parseTodoDismissals(storage.map.get(todoDismissKey("p3")) ?? null)).toEqual({
      skills: "a@1",
      errors: "2026-08-26T00:00:00.000Z",
    });
  });

  it("skips the write when the same signature is dismissed twice", () => {
    const storage = memStorage();
    dismissTodo("p4", "skills", "a@1", storage);
    storage.map.delete(todoDismissKey("p4"));
    dismissTodo("p4", "skills", "a@1", storage);
    expect(storage.map.size).toBe(0);
  });

  it("does nothing without a Project", () => {
    const storage = memStorage();
    dismissTodo(null, "skills", "a@1", storage);
    expect(storage.map.size).toBe(0);
  });
});
