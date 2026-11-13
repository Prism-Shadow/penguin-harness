/**
 * The CLI's own commands as contributions (cli-commands.ts): each is one `@Component` whose
 * `CliCommandsModule.commands` entry carries its key and summary and whose `@Bind` field
 * carries its code, and `CliCommandsModule` collects them.
 *
 * - Booting the module yields every command once, in declaration order: an id of the form
 *   `cli.<key>`, a well-formed key, a summary in both languages and a bound code half.
 * - `penguin --help` lists the top-level commands in that order, each described by its
 *   summary in the invocation's language; `penguin server --help` lists the commands whose
 *   keys sit under `server`, and keeps the options `server` registers itself.
 * - Every command's own `--help` opens with its summary: no code half replaces the
 *   description the host wrote from the entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cliCommandKeyFault } from "@prismshadow/penguin-core/cli";
import { bootBuiltinCommands } from "../src/cli-commands.js";
import type { BuiltinCommand } from "../src/cli-commands.js";
import { cli } from "../src/index.js";

/** The commands in the order they are declared, which is the order help lists them in. */
const KEYS = [
  "auth",
  "config",
  "run",
  "chat",
  "session",
  "agent",
  "project",
  "plugin",
  "cost",
  "schedule",
  "org",
  "browser",
  "server",
  "server.reset-admin-password",
  "server.status",
  "server.stop",
  "web",
  "exec",
  "update",
  "version",
];

let stdout: string[];
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };
let priorLang: string | undefined;

beforeEach(() => {
  stdout = [];
  priorLang = process.env.PENGUIN_LANG;
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  if (priorLang === undefined) delete process.env.PENGUIN_LANG;
  else process.env.PENGUIN_LANG = priorLang;
});

/** Help text with every run of whitespace as one space, so a wrapped description reads whole. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

/** The command names a help text lists under `Commands:`, in order (wrapped lines skipped). */
function listedCommands(help: string): string[] {
  const section = help.split(/\nCommands:\n/)[1] ?? "";
  return section
    .split("\n")
    .map((line) => /^ {2}([^\s|]+)/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** What `penguin <argv>` printed on stdout, with its exit code. */
async function run(argv: string[]): Promise<{ code: number; out: string }> {
  stdout.length = 0;
  const code = await cli(argv);
  return { code, out: stdout.join("") };
}

describe("CliCommandsModule", () => {
  let commands: readonly BuiltinCommand[];
  beforeEach(async () => {
    commands = await bootBuiltinCommands();
  });

  it("collects every command once, in declaration order", () => {
    expect(commands.map((c) => c.key)).toEqual(KEYS);
  });

  it("gives each command an id of the form cli.<key>, a well-formed key, both summaries and a code half", () => {
    for (const command of commands) {
      expect(command.id).toBe(`cli.${command.key}`);
      expect(cliCommandKeyFault(command.key)).toBeNull();
      expect(command.summary.en.trim()).not.toBe("");
      expect(command.summary.zh.trim()).not.toBe("");
      expect(typeof command.code.register).toBe("function");
    }
  });
});

describe("help lists the collected commands", () => {
  it("penguin --help lists the top-level commands in order, each with its summary, in each language", async () => {
    const commands = await bootBuiltinCommands();
    const topLevel = commands.filter((c) => !c.key.includes("."));
    for (const language of ["en", "zh"] as const) {
      process.env.PENGUIN_LANG = language;
      const { code, out } = await run(["--help"]);
      expect(code).toBe(0);
      expect(listedCommands(out)).toEqual(topLevel.map((c) => c.key));
      for (const command of topLevel) expect(flat(out)).toContain(flat(command.summary[language]));
    }
  });

  it("penguin server --help lists the commands under server, and keeps server's own options", async () => {
    process.env.PENGUIN_LANG = "en";
    const commands = await bootBuiltinCommands();
    const { code, out } = await run(["server", "--help"]);
    expect(code).toBe(0);
    expect(listedCommands(out)).toEqual(["reset-admin-password", "status", "stop"]);
    for (const command of commands.filter((c) => c.key.startsWith("server."))) {
      expect(flat(out)).toContain(flat(command.summary.en));
    }
    expect(out).toContain("--port <port>");
    expect(out).toContain("--host <host>");
  });

  it("every command's own --help opens with its summary", async () => {
    process.env.PENGUIN_LANG = "en";
    for (const command of await bootBuiltinCommands()) {
      const { code, out } = await run([...command.key.split("."), "--help"]);
      expect(code).toBe(0);
      expect(out).toContain(`Usage: penguin ${command.key.split(".").join(" ")}`);
      expect(flat(out)).toContain(flat(command.summary.en));
    }
  });
});
