/**
 * Which engine records Agent State versions, given what plugins contributed.
 *
 * - A contributed engine is used from the moment its source answers with it, and was handed a
 *   directory of its own under the data root; until then the asking is an error, said with what
 *   each contribution answered.
 * - A source that answers null (a plugin built for an older contract), fails, or throws, leaves
 *   the deployment without an engine, and the log says which.
 * - Of several, the first in contribution order that is ready.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStateEngine, AgentStateEngineSource } from "@prismshadow/penguin-core/plugin";
import { EngineChoice } from "../src/workbenches/engines.js";

const ROOT = path.join(path.sep, "data");
/** An engine that is never driven: choosing it is all these tests ask. */
const named = (name: string): AgentStateEngine => ({
  name,
  commit: async () => {
    throw new Error("not driven");
  },
  readObjects: async () => {
    throw new Error("not driven");
  },
});

/** A source whose answer the test gives when it likes. */
function deferred() {
  let answer!: (engine: AgentStateEngine | null) => void;
  const asked: string[] = [];
  const source: AgentStateEngineSource = (host) => {
    asked.push(host.cacheDir);
    return new Promise((resolve) => {
      answer = resolve as (engine: AgentStateEngine) => void;
    });
  };
  return { source, asked, answer: (e: AgentStateEngine | null) => answer(e) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function choose(...sources: Array<[string, AgentStateEngineSource]>) {
  const logged: string[] = [];
  const choice = new EngineChoice(
    sources.map(([id, source]) => ({ id, name: id.split(".")[0]!, source })),
    { root: ROOT, log: (line) => logged.push(line) },
  );
  return { choice, logged };
}

describe("the engine that records versions", () => {
  it("is an error to ask with nothing contributed", () => {
    expect(() => choose().choice.current()).toThrow(/no Agent State engine is ready/);
  });

  it("is a contributed one from the moment it answers, asked with a directory of its own", async () => {
    const git = deferred();
    const { choice, logged } = choose(["dugite.engine", git.source]);
    expect(git.asked).toEqual([path.join(ROOT, "cache", "dugite.engine")]);
    expect(() => choice.current()).toThrow(/has not answered yet/);

    const engine = named("git 2.56.1");
    git.answer(engine);
    await settle();

    expect(choice.current()).toBe(engine);
    expect(logged).toEqual(["[agent-state] dugite: git 2.56.1 records Agent State versions"]);
  });

  it.each([
    {
      how: "answers null (a plugin built for an older contract)",
      source: () => null as never,
      line: "[agent-state] dugite: answered without an engine",
    },
    {
      how: "fails",
      source: () => Promise.reject(new Error("download refused")),
      line: "[agent-state] dugite: failed (download refused)",
    },
    {
      how: "throws",
      source: () => {
        throw new Error("no platform");
      },
      line: "[agent-state] dugite: not started (no platform)",
    },
  ])("leaves the deployment without an engine when the source $how, and says so", async ({ source, line }) => {
    const { choice, logged } = choose(["dugite.engine", source]);
    await settle();

    expect(() => choice.current()).toThrow(/no Agent State engine is ready.*dugite/);
    expect(logged).toEqual([line]);
  });

  it("of several, is the first ready in contribution order", async () => {
    const first = deferred();
    const second = named("second");
    const { choice } = choose(["first.engine", first.source], ["second.engine", () => second]);
    await settle();
    expect(choice.current()).toBe(second);

    const engine = named("first");
    first.answer(engine);
    await settle();
    expect(choice.current()).toBe(engine);
  });

  it("the error to ask with names why each contribution has none", async () => {
    const first = deferred();
    const { choice } = choose(["first.engine", first.source], ["second.engine", () => {
      throw new Error("no platform");
    }]);
    await settle();

    expect(() => choice.current()).toThrow(
      "no Agent State engine is ready (first.engine has not answered yet, second.engine not started (no platform))",
    );
  });
});
