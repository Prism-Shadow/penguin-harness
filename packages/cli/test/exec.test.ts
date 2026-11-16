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
import os from "node:os";
import path from "node:path";
import type {
  PluginCliCommandInfo,
  PluginCliCommandRunRequest,
} from "@prismshadow/penguin-server/api";
import { registerExecCommand, resolveExecTarget } from "../src/commands/exec.js";
import { getMessages, type Messages } from "@prismshadow/penguin-server/cli";
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

describe("registerExecCommand (through the real commander tree, via stubbed fetch)", () => {
  const t: Messages = getMessages("en");
  const listing = [
    cmd("@acme/one", "one.deploy"),
    { package: "@acme/one", key: "one.up", summary: { en: "One's up", zh: "One 的启动" } },
    { package: "@acme/two", key: "two.up", summary: { en: "Two's up", zh: "Two 的启动" } },
  ];

  let originalEnv: NodeJS.ProcessEnv;
  let stdoutSpy: MockInstance<typeof process.stdout.write>;
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  const recorded: PluginCliCommandRunRequest[] = [];

  beforeEach(async () => {
    // The command builds its own source (serverPluginCommands), so point the connection at
    // the URL the stubbed fetch answers and keep the data root away from the tester's own.
    originalEnv = process.env;
    process.env = {
      ...originalEnv,
      PENGUIN_API_URL: "http://127.0.0.1:7399",
      PENGUIN_HOME: await import("fs/promises").then((fs) =>
        fs.mkdtemp(path.join(os.tmpdir(), "penguin-test-")),
      ),
    };
    delete process.env.PENGUIN_API_TOKEN;
    delete process.env.PENGUIN_SESSION_ID;
    recorded.length = 0;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts?: RequestInit) => {
        if (url.endsWith("/api/cli/commands")) {
          return new Response(JSON.stringify({ commands: listing }), { status: 200 });
        }
        if (url.endsWith("/run")) {
          recorded.push(JSON.parse(opts?.body as string));
          return new Response(JSON.stringify({ exitCode: 0, stdout: "ok\n", stderr: "" }), {
            status: 200,
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  const makeProgram = (): Command => {
    const program = new Command();
    program.name("penguin").version("1.0.0", "-v, --version").enablePositionalOptions();
    registerExecCommand(program.command("exec"), t);
    return program;
  };

  const run = async (...argv: string[]) => {
    stdoutSpy.mockClear();
    stderrSpy.mockClear();
    await makeProgram().parseAsync(argv, { from: "user" });
    return {
      out: stdoutSpy.mock.calls.map((c) => c[0]).join(""),
      err: stderrSpy.mock.calls.map((c) => c[0]).join(""),
    };
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
});
