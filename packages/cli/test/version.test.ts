/**
 * `penguin version`: the two output modes, and the property that `-v` cannot drift from the
 * subcommand. Both render core's buildInfo() and add nothing, so the assertions compare
 * against that producer rather than against literals — the release workflow stamps core's
 * constants before it runs these tests, and a hardcoded version would only fail there.
 */
import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { buildInfo } from "@prismshadow/penguin-core";
import { registerVersionCommand } from "../src/commands/version.js";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";

/** Collects everything `body` writes to stdout, alongside whatever it returns. */
async function captureStdout<T>(body: () => Promise<T>): Promise<{ out: string; result: T }> {
  const written: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = await body();
    return { out: written.join(""), result };
  } finally {
    process.stdout.write = original;
  }
}

/** Runs one argv through a bare program carrying only the version command; returns stdout. */
async function run(argv: string[]): Promise<string> {
  const program = new Command();
  program.exitOverride();
  registerVersionCommand(program, getMessages("en"));
  const { out } = await captureStdout(() => program.parseAsync(argv, { from: "user" }));
  return out;
}

describe("penguin version", () => {
  it("prints the one-line identity and nothing else", async () => {
    expect(await run(["version"])).toBe(`${buildInfo().describe}\n`);
  });

  it("prints the whole build info as JSON under --json", async () => {
    const out = await run(["version", "--json"]);
    expect(JSON.parse(out)).toEqual(buildInfo());
    // Indented, because a human reads this out of a bug report.
    expect(out).toContain("\n  ");
  });

  it("describes this build in a form that names a version", async () => {
    const { version, describe: described } = buildInfo();
    expect(described.startsWith(`v${version}`)).toBe(true);
  });

  it("agrees with -v", async () => {
    const { out } = await captureStdout(() => cli(["-v"]));
    expect(out).toBe(`${buildInfo().describe}\n`);
  });

  it("is reachable as a subcommand of the real CLI", async () => {
    const { out, result } = await captureStdout(() => cli(["version"]));
    expect(result).toBe(0);
    expect(out).toBe(`${buildInfo().describe}\n`);
  });
});
