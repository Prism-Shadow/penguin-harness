/**
 * `penguin exec`'s name resolution and its copyable lines — the pure halves, driven with a
 * synthetic discovery so no I/O is involved:
 *
 *   - an exact npm name always resolves;
 *   - a short name (`packageShortName`) resolves while exactly one contributing package
 *     carries it;
 *   - a short name two packages share is refused with BOTH full names — only the full
 *     name is unambiguous, so it is the one the error asks for;
 *   - a name no contributing package carries is refused with the candidate list;
 *   - `shellQuote` leaves a shell-safe word alone and single-quotes everything else the
 *     POSIX way, an embedded quote included — the ambiguity report's exec lines and any
 *     re-typed invocation both paste into a shell as one command.
 */
import { describe, expect, it } from "vitest";
import type { CliCommandEntry } from "@prismshadow/penguin-core/plugin";
import { resolveExecPackage, shellQuote } from "../src/commands/exec.js";
import type { CliDiscovery } from "../src/contributions.js";

/** A discovery whose contributing packages are exactly these, one flat command each. */
function discoveryOf(pkgs: readonly string[]): CliDiscovery {
  return {
    commands: pkgs.map((pkg) => ({
      pkg,
      entry: {
        id: `${pkg}#main`,
        key: "run",
        summary: { en: "run", zh: "run" },
      } as CliCommandEntry,
    })),
    invalid: [],
    ambiguous: [],
    pluginPackages: new Map(),
    faults: [],
  };
}

describe("resolveExecPackage (exact name > unique short name > refuse with candidates)", () => {
  const discovery = discoveryOf(["@prismshadow/penguin-cli", "@acme/one", "@acme/two", "solo"]);

  it("an exact npm name resolves, scoped or bare", () => {
    expect(resolveExecPackage(discovery, "@acme/one")).toEqual({ pkg: "@acme/one" });
    expect(resolveExecPackage(discovery, "solo")).toEqual({ pkg: "solo" });
  });

  it("a short name resolves while exactly one contributing package carries it", () => {
    expect(resolveExecPackage(discovery, "one")).toEqual({ pkg: "@acme/one" });
    expect(resolveExecPackage(discovery, "solo")).toEqual({ pkg: "solo" });
  });

  it("a short name two packages share is refused with both full names", () => {
    const both = discoveryOf(["@acme/two", "@other/two"]);
    expect(resolveExecPackage(both, "two")).toEqual({
      collision: { short: "two", fulls: ["@acme/two", "@other/two"] },
    });
  });

  it("a name nothing contributes is refused, and the caller lists the candidates", () => {
    expect(resolveExecPackage(discovery, "@acme/nope")).toEqual({ unknown: "@acme/nope" });
    expect(resolveExecPackage(discoveryOf([]), "anything")).toEqual({ unknown: "anything" });
  });

  it("the CLI's own package resolves by name too — exec is for every contributor", () => {
    expect(resolveExecPackage(discovery, "penguin-cli")).toEqual({
      pkg: "@prismshadow/penguin-cli",
    });
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
