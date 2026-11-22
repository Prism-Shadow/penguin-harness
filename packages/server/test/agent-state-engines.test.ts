/**
 * Which engine records Agent State versions, given what plugins contributed.
 *
 * - With none, the built-in engine does.
 * - A contributed engine is used from the moment its source answers with it, and was handed a
 *   directory of its own under the data root; until then, and when it answers null, fails, or
 *   throws, the built-in engine does, and the log says which.
 * - Of several, the first in contribution order that is ready; a dropped one is passed over.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStateEngine, AgentStateEngineSource } from "@prismshadow/penguin-core/plugin";
import { EngineChoice } from "../src/workbenches/engines.js";
import { builtinEngine } from "../src/workbenches/repo.js";

const ROOT = path.join(path.sep, "data");
const named = (name: string): AgentStateEngine => ({ ...builtinEngine, name });

/** A source whose answer the test gives when it likes. */
function deferred() {
  let answer!: (engine: AgentStateEngine | null) => void;
  const asked: string[] = [];
  const source: AgentStateEngineSource = (host) => {
    asked.push(host.cacheDir);
    return new Promise((resolve) => {
      answer = resolve;
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
  it("is the built-in one when nothing is contributed", () => {
    expect(choose().choice.current()).toBeNull();
  });

  it("is a contributed one from the moment it answers, asked with a directory of its own", async () => {
    const git = deferred();
    const { choice, logged } = choose(["dugite.engine", git.source]);
    expect(git.asked).toEqual([path.join(ROOT, "cache", "dugite.engine")]);
    expect(choice.current()).toBeNull();

    const engine = named("git 2.56.1");
    git.answer(engine);
    await settle();

    expect(choice.current()).toBe(engine);
    expect(logged).toEqual(["[agent-state] dugite: git 2.56.1 records Agent State versions"]);
  });

  it.each([
    {
      how: "answers null",
      source: () => null,
      line: "[agent-state] dugite: not available on this host; the built-in engine records versions",
    },
    {
      how: "fails",
      source: () => Promise.reject(new Error("download refused")),
      line: "[agent-state] dugite: failed (download refused); the built-in engine records versions",
    },
    {
      how: "throws",
      source: () => {
        throw new Error("no platform");
      },
      line: "[agent-state] dugite: not started (no platform); the built-in engine records versions",
    },
  ])("stays the built-in one when the source $how, and says so", async ({ source, line }) => {
    const { choice, logged } = choose(["dugite.engine", source]);
    await settle();

    expect(choice.current()).toBeNull();
    expect(logged).toEqual([line]);
  });

  it("of several, is the first ready in contribution order, passing over a dropped one", async () => {
    const first = deferred();
    const second = named("second");
    const { choice } = choose(["first.engine", first.source], ["second.engine", () => second]);
    await settle();
    expect(choice.current()).toBe(second);

    const engine = named("first");
    first.answer(engine);
    await settle();
    expect(choice.current()).toBe(engine);

    choice.drop(engine);
    expect(choice.current()).toBe(second);
  });
});
