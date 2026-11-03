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
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { Command } from "commander";
import type {
  PluginCliCommandInfo,
  PluginCliCommandRunRequest,
} from "@prismshadow/penguin-server/api";
import { registerExecCommand, resolveExecTarget } from "../src/commands/exec.js";
import { shellQuote } from "../src/plugin-cli-commands.js";
import { getMessages, type Messages } from "../src/i18n.js";

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

describe("registerExecCommand (through the real commander tree, a stand-in source)", () => {
  const t = getMessages("en");
  const listing: PluginCliCommandInfo[] = [
    cmd("@acme/one", "one.deploy"),
    { package: "@acme/one", key: "one.up", summary: { en: "One's up", zh: "One 的启动" } },
    { package: "@acme/two", key: "two.up", summary: { en: "Two's up", zh: "Two 的启动" } },
  ];

  let stdoutSpy: MockInstance<typeof process.stdout.write>;
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  const recorded: PluginCliCommandRunRequest[] = [];

  beforeEach(() => {
    recorded.length = 0;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  const source = () => ({
    list: async () => listing,
    run: async (req: PluginCliCommandRunRequest) => {
      recorded.push(req);
      return { exitCode: 0, stdout: "ok\n", stderr: "" };
    },
  });
  const makeProgram = (messages: Messages = t): Command => {
    const program = new Command();
    program.name("penguin").version("1.0.0", "-v, --version").enablePositionalOptions();
    registerExecCommand(program.command("exec"), messages, source());
    return program;
  };
  const run = async (...argv: string[]) => {
    stdoutSpy.mockClear();
    stderrSpy.mockClear();
    await makeProgram().parseAsync(argv, { from: "user" });
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    const err = stderrSpy.mock.calls.map((c) => c[0]).join("");
    return { out, err };
  };

  it("hands the id's arguments to the run request whole — options, the host's version flag and `--` included", async () => {
    const { out } = await run("exec", "one.deploy", "--prod", "-v", "--", "--help");
    expect(recorded).toEqual([
      {
        package: "@acme/one",
        args: ["one", "deploy", "--prod", "-v", "--", "--help"],
        language: "en",
        prog: "penguin exec one.deploy",
      },
    ]);
    expect(out).toBe("ok\n");
  });

  it("the prefixed form names the package and its id, and prog carries the colon", async () => {
    await run("exec", "@acme/one:one.deploy", "--x");
    expect(recorded[0]).toMatchObject({
      package: "@acme/one",
      args: ["one", "deploy", "--x"],
      prog: "penguin exec @acme/one:one.deploy",
    });
  });

  it("a bundle whose language is not one of the server's renders English", async () => {
    const fr = { ...t, language: "fr" } as unknown as Messages;
    await makeProgram(fr).parseAsync(["exec", "ls", "@acme/one"], { from: "user" });
    const out = stdoutSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("One's up");
    expect(out).not.toContain("One 的启动");
  });

  it("ls lists every command with its package and summary; with a package, that package's alone", async () => {
    const all = await run("exec", "ls");
    expect(all.out).toContain("Package");
    expect(all.out).toContain("one.deploy");
    expect(all.out).toContain("@acme/two");

    const one = await run("exec", "ls", "@acme/one");
    expect(one.out).not.toContain("Package");
    expect(one.out).toContain("one.deploy");
    expect(one.out).not.toContain("@acme/two");
  });

  it("ls refuses a package no plugin carries, with the candidate list", async () => {
    const { err } = await run("exec", "ls", "@acme/nope");
    expect(err).toContain(t.exec.unknownPackage("@acme/nope"));
    expect(err).toContain(t.exec.candidates(["@acme/one", "@acme/two"]));
    expect(process.exitCode).toBe(1);
  });

  it("bare exec shows exec's own help", async () => {
    const { out } = await run("exec");
    expect(out).toContain(t.exec.lsDesc);
  });

  it("an unknown id is refused with the id list", async () => {
    const { err } = await run("exec", "one.nope");
    expect(err).toContain(t.exec.unknownId("one.nope"));
    expect(process.exitCode).toBe(1);
  });
});
