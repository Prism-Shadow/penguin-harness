/**
 * The shared shell: one connection per machine, not one per command.
 *
 * Driven against a real child process (a stub `ssh` on PATH that just runs the shell it is
 * handed), because the thing worth proving cannot be mocked: that N commands cost ONE
 * connection, that their outputs do not bleed into each other, and that a dead connection
 * costs one command rather than every later one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeAllShells, closeShell, runOnShell } from "../src/machines/ssh-session.js";

let work: string;
let originalPath: string | undefined;
const target = { alias: "somehost", user: "deploy" };

/** Counts every invocation, then becomes the shell it was asked to start. */
function writeStubSsh(body: string) {
  fs.writeFileSync(path.join(work, "bin", "ssh"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

const connections = (): number => {
  const log = path.join(work, "connections.log");
  return fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").length : 0;
};

beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-shell-test-"));
  fs.mkdirSync(path.join(work, "bin"));
  originalPath = process.env.PATH;
  process.env.PATH = `${path.join(work, "bin")}:${process.env.PATH ?? ""}`;
  writeStubSsh(`echo one >> ${JSON.stringify(path.join(work, "connections.log"))}\nexec /bin/sh`);
});
afterEach(() => {
  closeAllShells();
  process.env.PATH = originalPath;
  fs.rmSync(work, { recursive: true, force: true });
});

/**
 * POSIX-only: the stub is a `#!/bin/sh` script reached through PATH, which Windows neither
 * executes nor joins with ':'. What is under test is the module's own logic, not anything
 * platform-specific — so the coverage is real everywhere the harness can drive it, and
 * pretending otherwise on Windows only produced 15 failures about the stub, not the code.
 */
describe.skipIf(process.platform === "win32")("runOnShell", () => {
  it("runs a command and reports its output and exit code", async () => {
    const result = await runOnShell("ssh:somehost", target, "echo hello");
    expect(result.output).toBe("hello\n");
    expect(result.code).toBe(0);
  });

  it("spends ONE connection across many commands — the whole point", async () => {
    for (let i = 0; i < 5; i++) await runOnShell("ssh:somehost", target, `echo ${i}`);
    expect(connections()).toBe(1);
  });

  it("keeps each command's output to itself", async () => {
    const a = await runOnShell("ssh:somehost", target, "echo aaa");
    const b = await runOnShell("ssh:somehost", target, "echo bbb");
    expect(a.output).toBe("aaa\n");
    expect(b.output).toBe("bbb\n");
  });

  it("carries a real exit code back, which is how failure is read", async () => {
    // stdout and stderr are merged by design, so the code is the only signal.
    const result = await runOnShell("ssh:somehost", target, "exit 3");
    expect(result.code).toBe(3);
  });

  it("merges stderr into the output rather than losing it", async () => {
    const result = await runOnShell("ssh:somehost", target, "echo oops 1>&2");
    expect(result.output).toBe("oops\n");
  });

  it("cannot be confused by output that looks like its own framing", async () => {
    // The mark is random per connection, so a command echoing a plausible one is just text.
    const result = await runOnShell("ssh:somehost", target, "echo '--penguin-0000-- 0'");
    expect(result.output).toBe("--penguin-0000-- 0\n");
    expect(result.code).toBe(0);
  });

  it("holds one connection PER machine, not one for all of them", async () => {
    await runOnShell("ssh:a", { alias: "a", user: "" }, "echo 1");
    await runOnShell("ssh:b", { alias: "b", user: "" }, "echo 1");
    expect(connections()).toBe(2);
  });

  it("serializes, so concurrent callers still get their own answers", async () => {
    const results = await Promise.all([
      runOnShell("ssh:somehost", target, "echo first"),
      runOnShell("ssh:somehost", target, "echo second"),
      runOnShell("ssh:somehost", target, "echo third"),
    ]);
    expect(results.map((r) => r.output.trim())).toEqual(["first", "second", "third"]);
    expect(connections()).toBe(1);
  });

  it("an `exit` in a command ends the COMMAND, not the connection", async () => {
    // Run in a subshell for exactly this: the directory browser's command exits on a missing
    // path, and ending the shared shell there would cost every later command a reconnect.
    expect((await runOnShell("ssh:somehost", target, "exit 3")).code).toBe(3);
    expect((await runOnShell("ssh:somehost", target, "echo still-here")).output.trim()).toBe(
      "still-here",
    );
    expect(connections()).toBe(1);
  });

  it("a `cd` does not leak into the next command", async () => {
    await runOnShell("ssh:somehost", target, "cd /tmp");
    const after = await runOnShell("ssh:somehost", target, "pwd");
    expect(after.output.trim()).not.toBe("/tmp");
  });

  it("reopens after the connection is dropped, costing one command and not the rest", async () => {
    await runOnShell("ssh:somehost", target, "echo alive");
    closeShell("ssh:somehost");
    const after = await runOnShell("ssh:somehost", target, "echo back");
    expect(after.output.trim()).toBe("back");
    expect(after.code).toBe(0);
    expect(connections()).toBe(2);
  });

  it("does not throw when ssh cannot start at all", async () => {
    writeStubSsh("exit 127");
    const result = await runOnShell("ssh:gone", { alias: "gone", user: "" }, "echo x");
    expect(result.code).not.toBe(0);
  });
});
