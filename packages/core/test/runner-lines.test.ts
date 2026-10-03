/**
 * A sandbox runner's own report lines (ConfinedSpawn.runnerLines) are dropped from the head of
 * the confined command's stderr — in the filter itself, in a command's output, and in a hook
 * script's failure reason — while the command's own stderr flows untouched.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runnerLineFilter } from "../src/environment/tools/command/runner-lines.js";
import { ManagedSession } from "../src/environment/index.js";
import { runHookScript } from "../src/index.js";
import { rmEventually } from "./rm-eventually.js";

const LINE = "landlock-run: partial enforcement (older Landlock ABI)";

/** Feeds the chunks through one filter and returns everything it passed on. */
function run(lines: readonly string[] | undefined, chunks: readonly string[]): string {
  const filter = runnerLineFilter(lines);
  return chunks.map((c) => filter.push(c)).join("") + filter.flush();
}

describe("the runner-line filter on a stderr stream", () => {
  it("drops a runner line at the head, whole or split across chunks, CRLF included", () => {
    expect(run([LINE], [`${LINE}\nboom\n`])).toBe("boom\n");
    expect(
      run([LINE], ["landlock-run: par", "tial enforcement (older Landlock ABI)\r", "\nx"]),
    ).toBe("x");
    expect(run([LINE], [`${LINE.toUpperCase()}\n`])).toBe("");
  });

  it("passes the command's own stderr untouched, the same words after its first line included", () => {
    expect(run([LINE], [`own\n${LINE}\n`])).toBe(`own\n${LINE}\n`);
    expect(run([LINE], ["landlock-run: something else\n"])).toBe("landlock-run: something else\n");
    // Held while it could still be the runner's line; released when the stream ends.
    expect(run([LINE], ["landlock-run"])).toBe("landlock-run");
  });

  it("is the identity when the runner names no lines", () => {
    expect(run(undefined, [`${LINE}\n`])).toBe(`${LINE}\n`);
    expect(run([], [`${LINE}\n`])).toBe(`${LINE}\n`);
  });
});

// The command case runs a POSIX shell line.
describe.skipIf(process.platform === "win32")("the spawn paths drop the runner's lines", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "penguin-runner-lines-"));
  });
  afterEach(async () => {
    await rmEventually(dir);
  });

  /** A stand-in runner: prints its report line on stderr, then runs the rest of its argv. */
  async function runner(): Promise<string> {
    const file = path.join(dir, "runner.mjs");
    await writeFile(
      file,
      [
        'import { spawnSync } from "node:child_process";',
        `process.stderr.write(${JSON.stringify(LINE + "\n")});`,
        'const r = spawnSync(process.argv[2], process.argv.slice(3), { stdio: "inherit" });',
        "process.exit(r.status ?? 1);",
      ].join("\n"),
    );
    return file;
  }

  it("a command's output", async () => {
    const wrap = await runner();
    const session = new ManagedSession({
      cmd: "echo out; echo own-error >&2",
      cwd: dir,
      env: process.env,
      confine: (argv) => ({ argv: [process.execPath, wrap, ...argv], runnerLines: [LINE] }),
    });
    try {
      let output = "";
      for await (const chunk of session.collect(5000)) output += chunk;
      expect(output).toContain("out");
      expect(output).toContain("own-error");
      expect(output).not.toContain("partial enforcement");
    } finally {
      session.kill();
    }
  });

  it("a hook script's failure reason", async () => {
    const wrap = await runner();
    const script = path.join(dir, "fail.mjs");
    await writeFile(script, 'process.stderr.write("hook broke\\n"); process.exit(3);\n');
    await expect(
      runHookScript(
        script,
        {},
        { confine: (argv) => ({ argv: [argv[0]!, wrap, ...argv], runnerLines: [LINE] }) },
      ),
    ).rejects.toThrow(/^exit 3: hook broke$/);
  });
});
