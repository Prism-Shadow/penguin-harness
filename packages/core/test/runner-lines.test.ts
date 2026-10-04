/**
 * A sandbox runner's own report lines (ConfinedSpawn.runnerLines) leave the head of the confined
 * command's stderr — in the filter, a command's output and a hook's failure reason — and only those.
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

describe("the runner-line filter on a stderr stream", () => {
  const run = (lines: readonly string[], chunks: readonly string[]) => {
    const filter = runnerLineFilter(lines)!;
    return chunks.map((c) => filter.push(c)).join("") + filter.flush();
  };

  it.each([
    [[`${LINE}\nboom\n`], "boom\n"],
    [["landlock-run: par", "tial enforcement (older Landlock ABI)\r", "\nx"], "x"],
    [[`${LINE.toUpperCase()}\n`], ""],
    // The command's own stderr: the same words after its first line, another runner-prefixed line.
    [[`own\n${LINE}\n`], `own\n${LINE}\n`],
    [["landlock-run: other\n"], "landlock-run: other\n"],
    // Held while it could still be the runner's line; released when the stream ends.
    [["landlock-run"], "landlock-run"],
  ])("%j leaves %j", (chunks, out) => {
    expect(run([LINE], chunks)).toBe(out);
  });

  it("is null when the runner names no lines, so the plain listener stays", () => {
    expect(runnerLineFilter(undefined)).toBeNull();
    expect(runnerLineFilter([])).toBeNull();
  });
});

// The command case runs a POSIX shell line.
describe.skipIf(process.platform === "win32")("the spawn paths drop the runner's lines", () => {
  let dir: string;
  let wrap: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "penguin-runner-lines-"));
    // A stand-in runner: prints its report line on stderr, then runs the rest of its argv.
    wrap = path.join(dir, "runner.mjs");
    await writeFile(
      wrap,
      'import { spawnSync } from "node:child_process";\n' +
        `process.stderr.write(${JSON.stringify(LINE + "\n")});\n` +
        'process.exit(spawnSync(process.argv[2], process.argv.slice(3), { stdio: "inherit" }).status ?? 1);\n',
    );
  });
  afterEach(() => rmEventually(dir));

  it("a command's output", async () => {
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
    const script = path.join(dir, "fail.mjs");
    await writeFile(script, 'process.stderr.write("hook broke\\n"); process.exit(3);\n');
    const confine = {
      confine: (argv: readonly string[]) => ({
        argv: [argv[0]!, wrap, ...argv],
        runnerLines: [LINE],
      }),
    };
    await expect(runHookScript(script, {}, confine)).rejects.toThrow(/^exit 3: hook broke$/);
  });
});
