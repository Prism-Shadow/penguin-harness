/**
 * `penguin exec`'s id resolution and its copyable lines — the pure halves, driven with a
 * list of plugin commands so no I/O is involved:
 *
 *   - a dotted id resolves exactly while one plugin contributes it, prefixed or bare;
 *   - the same id in two plugins is refused with BOTH package names — only
 *     `<package>:<id>` is unambiguous, so it is the one the error asks for;
 *   - the prefixed form takes the full npm name only: a scope-less short name is just an
 *     unknown package;
 *   - a single word is not an id (two segments or more), and an id no plugin carries is
 *     refused with the id list;
 *   - `shellQuote` leaves a shell-safe word alone and single-quotes everything else the
 *     POSIX way, an embedded quote included — the ambiguity report's exec lines and any
 *     re-typed invocation both paste into a shell as one command.
 */
import { describe, expect, it } from "vitest";
import type { PluginCliCommandInfo } from "@prismshadow/penguin-server/api";
import { resolveExecTarget } from "../src/commands/exec.js";
import { shellQuote } from "../src/plugin-cli-commands.js";

const cmd = (pkg: string, key: string): PluginCliCommandInfo => ({
  package: pkg,
  key,
  summary: { en: "", zh: "" },
});
const commands = [
  cmd("@acme/one", "one.deploy"),
  cmd("@acme/two", "two.up"),
  cmd("solo", "run.now"),
];

describe("resolveExecTarget (exact dotted id, prefix only on collision)", () => {
  it("a dotted id resolves while exactly one plugin contributes it", () => {
    expect(resolveExecTarget(commands, "one.deploy")).toEqual({
      target: { pkg: "@acme/one", key: "one.deploy" },
    });
    expect(resolveExecTarget(commands, "run.now")).toEqual({
      target: { pkg: "solo", key: "run.now" },
    });
  });

  it("the prefixed form resolves too, and names the same target", () => {
    expect(resolveExecTarget(commands, "@acme/one:one.deploy")).toEqual({
      target: { pkg: "@acme/one", key: "one.deploy" },
    });
  });

  it("a single word is not an id: an id is two segments or more", () => {
    expect(resolveExecTarget(commands, "deploy")).toEqual({ invalidId: "deploy" });
  });

  it("a dotted id no plugin contributes is refused with the id list", () => {
    expect(resolveExecTarget(commands, "one.nope")).toEqual({
      unknownId: "one.nope",
      keys: ["one.deploy", "two.up", "run.now"],
    });
  });

  it("an id two plugins share is refused with both package names", () => {
    const shared = [cmd("@a/x", "greet.all"), cmd("@b/y", "greet.all")];
    expect(resolveExecTarget(shared, "greet.all")).toEqual({
      collision: { key: "greet.all", fulls: ["@a/x", "@b/y"] },
    });
  });

  it("the prefixed form takes the full npm name only; a short name is an unknown package", () => {
    expect(resolveExecTarget(commands, "one:one.deploy")).toEqual({
      unknownPackage: "one",
      packages: ["@acme/one", "@acme/two", "solo"],
    });
  });

  it("the prefixed form refuses an id the named package does not carry", () => {
    expect(resolveExecTarget(commands, "@acme/one:two.up")).toEqual({
      unknownId: "two.up",
      keys: ["one.deploy"],
    });
  });

  it("an unknown package is refused, and the caller lists the candidates", () => {
    expect(resolveExecTarget([], "@acme/nope:some.id")).toEqual({
      unknownPackage: "@acme/nope",
      packages: [],
    });
  });
});

describe("shellQuote (one word of a copyable command line, POSIX)", () => {
  it("leaves a word the shell reads back unchanged alone", () => {
    expect(shellQuote("deploy")).toBe("deploy");
    expect(shellQuote("@acme/one")).toBe("@acme/one");
    expect(shellQuote("--flag=value")).toBe("--flag=value");
    expect(shellQuote("a.b.c")).toBe("a.b.c");
    expect(shellQuote("@acme/one:one.deploy")).toBe("@acme/one:one.deploy");
  });
  it("single-quotes everything else, an embedded quote included", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote("$(rm -rf /)")).toBe("'$(rm -rf /)'");
    expect(shellQuote("")).toBe("''");
  });
});
