import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import type { MockInstance } from "vitest";
import type { PluginCliCommandInfo } from "@prismshadow/penguin-server/api";
import fs from "node:fs";
import {
  keyAnswers,
  matchingPackages,
  dispatchPluginCommand,
  packageShortName,
  shellQuote,
  writeRun,
  reportAmbiguous,
} from "../src/plugin-cli-commands.js";
import type { PluginCommandSource } from "../src/plugin-cli-commands.js";
import { getMessages } from "@prismshadow/penguin-server/cli";

const t = getMessages("en");

describe("shellQuote", () => {
  it("passes safe words through unchanged", () => {
    expect(shellQuote("deploy")).toBe("deploy");
    expect(shellQuote("@scope/name")).toBe("@scope/name");
    expect(shellQuote("a-b_c+d=e:f,g.h/i")).toBe("a-b_c+d=e:f,g.h/i");
  });

  it("single-quotes words with shell metacharacters", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("packageShortName", () => {
  it("returns the segment after the last slash", () => {
    expect(packageShortName("@scope/name")).toBe("name");
    expect(packageShortName("@a/b/c")).toBe("c");
  });

  it("returns the whole string when there is no slash", () => {
    expect(packageShortName("barepackage")).toBe("barepackage");
  });
});

describe("keyAnswers", () => {
  it("returns true when the key's segments and the command words agree", () => {
    expect(keyAnswers("tool.sub", ["tool", "sub", "x"])).toBe(true);
    expect(keyAnswers("tool.sub", ["tool", "sub"])).toBe(true);
    expect(keyAnswers("tool", ["tool"])).toBe(true);
    expect(keyAnswers("tool", ["tool", "--help"])).toBe(true);
  });

  it("returns false when they diverge or when no words are present", () => {
    expect(keyAnswers("tool.sub", ["tool", "other"])).toBe(false);
    expect(keyAnswers("tool", ["tools"])).toBe(false);
    expect(keyAnswers("tool", [])).toBe(false);
    expect(keyAnswers("tool", ["--x"])).toBe(false);
  });
});

describe("matchingPackages", () => {
  const commands: PluginCliCommandInfo[] = [
    { package: "@a/one", key: "deploy", summary: { en: "", zh: "" } },
    { package: "@a/one", key: "deploy.list", summary: { en: "", zh: "" } },
    { package: "@a/two", key: "deploy.list", summary: { en: "", zh: "" } },
  ];

  it("returns packages in order, each once", () => {
    const result = matchingPackages(commands, ["deploy"]);
    expect(result).toEqual(["@a/one", "@a/two"]);
  });

  it("filters by key when words diverge", () => {
    const result = matchingPackages(commands, ["deploy", "rm"]);
    expect(result).toEqual(["@a/one"]);
  });

  it("returns an empty array when no commands match", () => {
    expect(matchingPackages(commands, ["other"])).toEqual([]);
  });
});

describe("writeRun", () => {
  let stdoutSpy: MockInstance<typeof process.stdout.write>;
  let stderrSpy: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("writes stdout first, then stderr, and returns the exit code", () => {
    const code = writeRun({ exitCode: 3, stdout: "out\n", stderr: "err\n" });
    expect(stdoutSpy).toHaveBeenCalledWith("out\n");
    expect(stderrSpy).toHaveBeenCalledWith("err\n");
    expect(code).toBe(3);
    expect(stdoutSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      stderrSpy.mock.invocationCallOrder[0]!,
    );
  });

  it("does not write empty streams", () => {
    writeRun({ exitCode: 0, stdout: "", stderr: "" });
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe("reportAmbiguous", () => {
  let stderrSpy: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it("writes the header, one exec line per package, and the note, and returns 2", () => {
    const code = reportAmbiguous(
      ["greet", "world"],
      [
        { package: "@a/x", key: "greet", summary: { en: "", zh: "" } },
        { package: "@b/y", key: "greet", summary: { en: "", zh: "" } },
      ],
      t,
    );
    expect(code).toBe(2);
    const text = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(text).toContain("greet world");
    expect(text).toContain("penguin exec @a/x:greet world");
    expect(text).toContain("penguin exec @b/y:greet world");
    expect(text).toContain(t.ambiguous.note());
  });

  it("uses the longest matching key and leaves the rest of the argv in place", () => {
    reportAmbiguous(
      ["greet", "all", "--loud", "two words"],
      [
        { package: "@a/one", key: "greet", summary: { en: "", zh: "" } },
        { package: "@a/one", key: "greet.all", summary: { en: "", zh: "" } },
      ],
      t,
    );
    const text = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(text).toContain("penguin exec @a/one:greet.all --loud 'two words'");
  });

  it("pastes nothing after the id when the argv names the key exactly", () => {
    reportAmbiguous(["greet"], [{ package: "@a/x", key: "greet", summary: { en: "", zh: "" } }], t);
    const text = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(text).toContain("penguin exec @a/x:greet\n");
  });
});

describe("dispatchPluginCommand (unit)", () => {
  let stdoutSpy: MockInstance<typeof process.stdout.write>;
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Outside any Agent: a run carries no caller context of its own.
    originalEnv = process.env;
    process.env = { ...originalEnv };
    delete process.env.PENGUIN_PROJECT_ID;
    delete process.env.PENGUIN_SESSION_ID;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = originalEnv;
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("returns null when no commands match", async () => {
    const source: PluginCommandSource = {
      list: async () => [{ package: "@a/x", key: "other", summary: { en: "", zh: "" } }],
      run: vi.fn(),
    };
    const code = await dispatchPluginCommand(["greet"], "en", source, t);
    expect(code).toBe(null);
    expect(source.run).not.toHaveBeenCalled();
  });

  it("returns null when list throws", async () => {
    const source: PluginCommandSource = {
      list: async () => {
        throw new Error("fetch failed");
      },
      run: vi.fn(),
    };
    const code = await dispatchPluginCommand(["greet"], "en", source, t);
    expect(code).toBe(null);
    expect(source.run).not.toHaveBeenCalled();
  });

  it("reports ambiguity and returns 2 when multiple packages match", async () => {
    const source: PluginCommandSource = {
      list: async () => [
        { package: "@a/x", key: "greet", summary: { en: "", zh: "" } },
        { package: "@b/y", key: "greet", summary: { en: "", zh: "" } },
      ],
      run: vi.fn(),
    };
    const code = await dispatchPluginCommand(["greet", "world"], "en", source, t);
    expect(code).toBe(2);
    expect(source.run).not.toHaveBeenCalled();
    const stderr = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderr).toContain("penguin exec @a/x:greet world");
    expect(stderr).toContain("penguin exec @b/y:greet world");
  });

  it("runs the command when exactly one package matches", async () => {
    const source: PluginCommandSource = {
      list: async () => [{ package: "@a/greet", key: "greet", summary: { en: "", zh: "" } }],
      run: async (req) => {
        expect(req).toEqual({
          package: "@a/greet",
          args: ["greet", "world"],
          language: "en",
          prog: "penguin",
        });
        return { exitCode: 0, stdout: "Hello!\n", stderr: "" };
      },
    };
    const code = await dispatchPluginCommand(["greet", "world"], "en", source, t);
    expect(code).toBe(0);
    expect(stdoutSpy).toHaveBeenCalledWith("Hello!\n");
  });

  it("passes the language and writes both streams", async () => {
    const source: PluginCommandSource = {
      list: async () => [{ package: "pkg", key: "cmd", summary: { en: "", zh: "" } }],
      run: async () => ({ exitCode: 3, stdout: "out", stderr: "err" }),
    };
    const code = await dispatchPluginCommand(["cmd"], "zh", source, t);
    expect(code).toBe(3);
    expect(stdoutSpy).toHaveBeenCalledWith("out");
    expect(stderrSpy).toHaveBeenCalledWith("err");
  });
});

describe("dispatchPluginCommand (e2e via stubbed fetch)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let stdoutSpy: MockInstance<typeof process.stdout.write>;
  let stderrSpy: MockInstance<typeof process.stderr.write>;

  beforeEach(async () => {
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
    delete process.env.PENGUIN_PROJECT_ID;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = originalEnv;
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
    vi.unstubAllGlobals();
  });

  it("dispatches the command to the server", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts?: RequestInit) => {
        requests.push({ method: opts?.method ?? "GET", url, body: opts?.body });
        if (url.endsWith("/api/cli/commands")) {
          return new Response(
            JSON.stringify({
              commands: [{ package: "@a/greet", key: "greet", summary: { en: "", zh: "" } }],
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/run")) {
          return new Response(JSON.stringify({ exitCode: 0, stdout: "Hello!\n", stderr: "" }), {
            status: 200,
          });
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { dispatchPluginCommand, serverPluginCommands } =
      await import("../src/plugin-cli-commands.js");
    const code = await dispatchPluginCommand(
      ["greet", "world"],
      "en",
      serverPluginCommands({ autoStart: false }, t),
      t,
    );

    expect(code).toBe(0);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      method: "GET",
      url: expect.stringContaining("/api/cli/commands"),
    });
    expect(requests[1]).toMatchObject({ method: "POST", url: expect.stringContaining("/run") });
    const runBody = JSON.parse(requests[1]!.body as string);
    expect(runBody).toEqual({
      package: "@a/greet",
      args: ["greet", "world"],
      language: "en",
      prog: "penguin",
    });
    expect(stdoutSpy).toHaveBeenCalledWith("Hello!\n");
  });

  it("returns 2 when ambiguous, without calling run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/api/cli/commands")) {
          return new Response(
            JSON.stringify({
              commands: [
                { package: "@a/x", key: "greet", summary: { en: "", zh: "" } },
                { package: "@b/y", key: "greet", summary: { en: "", zh: "" } },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const { dispatchPluginCommand, serverPluginCommands } =
      await import("../src/plugin-cli-commands.js");
    const code = await dispatchPluginCommand(
      ["greet"],
      "en",
      serverPluginCommands({ autoStart: false }, t),
      t,
    );

    expect(code).toBe(2);
    const stderr = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(stderr).toContain("@a/x");
    expect(stderr).toContain("@b/y");
  });

  it("returns null when the list is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ commands: [] }), { status: 200 })),
    );

    const { dispatchPluginCommand, serverPluginCommands } =
      await import("../src/plugin-cli-commands.js");
    const code = await dispatchPluginCommand(
      ["nope"],
      "en",
      serverPluginCommands({ autoStart: false }, t),
      t,
    );

    expect(code).toBe(null);
  });

  it("returns null when list returns 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("internal error", { status: 500 })),
    );

    const { dispatchPluginCommand, serverPluginCommands } =
      await import("../src/plugin-cli-commands.js");
    const code = await dispatchPluginCommand(
      ["greet"],
      "en",
      serverPluginCommands({ autoStart: false }, t),
      t,
    );

    expect(code).toBe(null);
  });
});

/**
 * A plugin command's caller context and files, as the terminal sends and saves them.
 *
 * - Given a member command run outside any Agent, the run names the CLI's default Project and no
 *   Session; inside an Agent, the Agent's Project and Session. An admin command outside one names
 *   neither.
 * - Given an option the command reads a file from, the run carries the file's bytes keyed by the
 *   value as typed; an unreadable file stops the run before anything is sent.
 * - Given the run hands back files, they land under the command's output option, never over an
 *   existing file, and each saved path is named on stderr.
 */
describe("plugin command runs: caller context and files", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let stdoutSpy: MockInstance<typeof process.stdout.write>;
  let stderrSpy: MockInstance<typeof process.stderr.write>;
  let dir: string;
  const flip: PluginCliCommandInfo = {
    package: "@a/tools",
    key: "tools.flip",
    summary: { en: "", zh: "" },
    access: "member",
    files: { read: ["--input"], write: "--out" },
  };
  const reset: PluginCliCommandInfo = { ...flip, key: "tools.reset", access: "admin", files: {} };
  const sourceAnswering = (
    reply: Awaited<ReturnType<PluginCommandSource["run"]>>,
  ): PluginCommandSource & { sent: unknown[] } => {
    const sent: unknown[] = [];
    return {
      sent,
      list: async () => [flip, reset],
      run: async (req) => {
        sent.push(req);
        return reply;
      },
    };
  };

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    delete process.env.PENGUIN_PROJECT_ID;
    delete process.env.PENGUIN_SESSION_ID;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-files-"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(dir, { recursive: true, force: true });
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("names the default Project for a member command outside an Agent, the Agent's inside one", async () => {
    const source = sourceAnswering({ exitCode: 0, stdout: "", stderr: "" });
    await dispatchPluginCommand(["tools", "flip"], "en", source, t);
    await dispatchPluginCommand(["tools", "reset"], "en", source, t);
    process.env.PENGUIN_PROJECT_ID = "field_work";
    process.env.PENGUIN_SESSION_ID = "session-2026-11-19-10-00-00-abcd1234";
    await dispatchPluginCommand(["tools", "flip"], "en", source, t);
    expect(source.sent).toEqual([
      expect.objectContaining({ projectId: "default_project" }),
      expect.not.objectContaining({ projectId: expect.anything() }),
      expect.objectContaining({
        projectId: "field_work",
        sessionId: "session-2026-11-19-10-00-00-abcd1234",
      }),
    ]);
    expect(source.sent[0]).not.toHaveProperty("sessionId");
  });

  it("sends the file an input option names, keyed by the value as typed", async () => {
    const input = path.join(dir, "a.txt");
    fs.writeFileSync(input, "abc");
    const source = sourceAnswering({ exitCode: 0, stdout: "", stderr: "" });
    await dispatchPluginCommand(["tools", "flip", `--input=${input}`], "en", source, t);
    expect(source.sent[0]).toMatchObject({
      files: [{ value: input, name: "a.txt", data: Buffer.from("abc").toString("base64") }],
    });
  });

  it("stops before sending anything when an input file cannot be read", async () => {
    const source = sourceAnswering({ exitCode: 0, stdout: "", stderr: "" });
    const missing = path.join(dir, "missing.txt");
    const code = await dispatchPluginCommand(
      ["tools", "flip", "--input", missing],
      "en",
      source,
      t,
    );
    expect(code).toBe(1);
    expect(source.sent).toEqual([]);
    expect(stderrSpy.mock.calls.map((c) => c[0]).join("")).toContain(missing);
  });

  it("saves the files a run hands back under the output option, never over an existing one", async () => {
    const out = path.join(dir, "out");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "flipped.txt"), "kept");
    const source = sourceAnswering({
      exitCode: 0,
      stdout: "",
      stderr: "",
      files: [{ name: "flipped.txt", data: Buffer.from("cba").toString("base64") }],
    });
    const code = await dispatchPluginCommand(["tools", "flip", "--out", out], "en", source, t);
    expect(code).toBe(0);
    expect(fs.readFileSync(path.join(out, "flipped.txt"), "utf8")).toBe("kept");
    expect(fs.readFileSync(path.join(out, "flipped-1.txt"), "utf8")).toBe("cba");
    expect(stderrSpy.mock.calls.map((c) => c[0]).join("")).toContain(
      path.join(out, "flipped-1.txt"),
    );
  });
});
