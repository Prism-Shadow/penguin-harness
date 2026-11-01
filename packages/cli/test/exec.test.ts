/**
 * `penguin exec`'s name resolution and its copyable lines — the pure halves, driven with a
 * list of plugin packages so no I/O is involved:
 *
 *   - an exact npm name always resolves;
 *   - a short name (`packageShortName`) resolves while exactly one plugin carries it;
 *   - a short name two plugins share is refused with BOTH full names — only the full name
 *     is unambiguous, so it is the one the error asks for;
 *   - a name no plugin carries is refused with the candidate list;
 *   - `shellQuote` leaves a shell-safe word alone and single-quotes everything else the
 *     POSIX way, an embedded quote included — the ambiguity report's exec lines and any
 *     re-typed invocation both paste into a shell as one command.
 */
import { describe, expect, it } from "vitest";
import { resolveExecPackage } from "../src/commands/exec.js";
import { shellQuote } from "../src/plugin-cli-commands.js";

describe("resolveExecPackage (exact name > unique short name > refuse with candidates)", () => {
  const packages = ["@acme/one", "@acme/two", "solo"];

  it("an exact npm name resolves, scoped or bare", () => {
    expect(resolveExecPackage(packages, "@acme/one")).toEqual({ pkg: "@acme/one" });
    expect(resolveExecPackage(packages, "solo")).toEqual({ pkg: "solo" });
  });

  it("a short name resolves while exactly one plugin carries it", () => {
    expect(resolveExecPackage(packages, "one")).toEqual({ pkg: "@acme/one" });
    expect(resolveExecPackage(packages, "two")).toEqual({ pkg: "@acme/two" });
  });

  it("a short name two plugins share is refused with both full names", () => {
    expect(resolveExecPackage(["@acme/two", "@other/two"], "two")).toEqual({
      collision: { short: "two", fulls: ["@acme/two", "@other/two"] },
    });
  });

  it("an exact name wins over a short name another plugin shares", () => {
    expect(resolveExecPackage(["two", "@acme/two"], "two")).toEqual({ pkg: "two" });
  });

  it("a name no plugin carries is refused, and the caller lists the candidates", () => {
    expect(resolveExecPackage(packages, "@acme/nope")).toEqual({ unknown: "@acme/nope" });
    expect(resolveExecPackage([], "anything")).toEqual({ unknown: "anything" });
  });
});

describe("shellQuote (one word of a copyable command line, POSIX)", () => {
  it("leaves a word the shell reads back unchanged alone", () => {
    expect(shellQuote("deploy")).toBe("deploy");
    expect(shellQuote("@acme/one")).toBe("@acme/one");
    expect(shellQuote("--flag=value")).toBe("--flag=value");
    expect(shellQuote("a.b.c")).toBe("a.b.c");
  });
  it("single-quotes everything else, an embedded quote included", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote("$(rm -rf /)")).toBe("'$(rm -rf /)'");
    expect(shellQuote("")).toBe("''");
  });
});
