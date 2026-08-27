/**
 * Commander's parse failures, driven through `cli()`: the raw English line is gone, what
 * the user reads is one localized sentence plus the failing command's own usage — for a
 * positional (`logs`, once its argument is required again by `schedule rm`) and for a
 * flag (`schedule add`), in both locales. Exit codes stay commander's.
 */
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { commandForArgv } from "../src/usage-error.js";

let stdout: string[];
let stderr: string[];
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };
let priorLang: string | undefined;

beforeEach(() => {
  stdout = [];
  stderr = [];
  priorLang = process.env.PENGUIN_LANG;
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  if (priorLang === undefined) delete process.env.PENGUIN_LANG;
  else process.env.PENGUIN_LANG = priorLang;
});

const err = () => stderr.join("");

describe("missing positional argument", () => {
  it("names the argument and the command's usage, in each language", async () => {
    for (const lang of ["en", "zh"] as const) {
      process.env.PENGUIN_LANG = lang;
      stderr.length = 0;
      const t = getMessages(lang);
      const code = await cli(["schedule", "rm"]);
      expect(code).toBe(1);
      expect(err()).toContain(t.usage.missingArgument("name"));
      expect(err()).toContain("penguin schedule rm");
      // Commander's own English wording never reaches the terminal.
      expect(err()).not.toContain("missing required argument 'name'");
    }
  });
});

describe("missing required option", () => {
  it("PENGUIN_LANG=zh explains `schedule add` in Chinese", async () => {
    process.env.PENGUIN_LANG = "zh";
    const t = getMessages("zh");
    const code = await cli(["schedule", "add", "daily"]);
    expect(code).toBe(1);
    expect(err()).toContain(t.usage.missingOption("--prompt <text>"));
    // The usage line quotes the failing subcommand, not the program.
    expect(err()).toContain("penguin schedule add");
    expect(err()).toContain("--help");
    expect(err()).not.toContain("required option");
  });

  it("says the same thing in English", async () => {
    process.env.PENGUIN_LANG = "en";
    const t = getMessages("en");
    const code = await cli(["schedule", "add", "daily"]);
    expect(code).toBe(1);
    expect(err()).toContain(t.usage.missingOption("--prompt <text>"));
    expect(err()).toContain("penguin schedule add");
  });
});

describe("unknown option and unknown command", () => {
  it("both are localized and carry a usage line", async () => {
    for (const lang of ["en", "zh"] as const) {
      process.env.PENGUIN_LANG = lang;
      const t = getMessages(lang);

      stderr.length = 0;
      expect(await cli(["ls", "--nope"])).toBe(1);
      expect(err()).toContain(t.usage.unknownOption("--nope"));
      expect(err()).toContain("penguin ls");

      stderr.length = 0;
      expect(await cli(["nosuchthing"])).toBe(1);
      expect(err()).toContain(t.usage.unknownCommand("nosuchthing"));
      expect(err()).toContain("penguin");
    }
  });
});

describe("what must not change", () => {
  it("--help and --version print their own output and exit 0", async () => {
    expect(await cli(["--help"])).toBe(0);
    expect(stdout.join("")).toContain("penguin");
    expect(err()).toBe("");
    stdout.length = 0;
    expect(await cli(["--version"])).toBe(0);
    expect(stdout.join("").trim().length).toBeGreaterThan(0);
    expect(err()).toBe("");
  });

  it("bare `penguin` still prints help, not an error", async () => {
    expect(await cli([])).toBe(0);
    expect(stdout.join("")).toContain("Usage:");
    expect(err()).toBe("");
  });
});

describe("commandForArgv", () => {
  const program = new Command().name("penguin");
  const schedule = program.command("schedule");
  const add = schedule.command("add <name>");
  const ls = program.command("ls");

  it("walks to the deepest named subcommand", () => {
    expect(commandForArgv(program, ["schedule", "add", "daily"])).toBe(add);
    expect(commandForArgv(program, ["schedule"])).toBe(schedule);
    expect(commandForArgv(program, ["ls", "--json"])).toBe(ls);
  });

  it("skips option flags and stops at the first non-command word", () => {
    expect(commandForArgv(program, ["--json", "ls"])).toBe(ls);
    expect(commandForArgv(program, ["ls", "extra", "add"])).toBe(ls);
    expect(commandForArgv(program, [])).toBe(program);
    expect(commandForArgv(program, ["unknown"])).toBe(program);
    // An option's value is a bare word too, and stops the walk — landing on the parent
    // is the safe outcome, never a wrong command.
    expect(commandForArgv(program, ["--server", "http://x", "ls"])).toBe(program);
  });
});
