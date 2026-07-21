/**
 * `penguin run` / `penguin chat`: a model reference is always an explicit
 * (provider, model_id) pair. Commander can only mark each option required on its own, so
 * the "both or neither" rule is enforced inside the action — supplying exactly one of
 * --model-id / --provider is a usage error (never a lookup against the configured models),
 * while supplying neither falls back to the Project's default model.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerChatCommand } from "../src/commands/chat.js";
import { registerRunCommand } from "../src/commands/run.js";
import { getMessages } from "../src/i18n.js";

// The --resume case below reaches createAgent, which initializes Agent state on disk; point
// the data root at a throwaway directory so no test ever writes to the real ~/.penguin/data.
let tmpHome: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cli-pairing-"));
  process.env.PENGUIN_HOME = tmpHome;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
});

/** Runs one command, capturing stdout / stderr and the exit code (without exiting the process). */
async function runCommand(
  register: (program: Command, t: ReturnType<typeof getMessages>) => void,
  args: string[],
): Promise<{ out: string; err: string; code: number }> {
  const program = new Command();
  program.exitOverride();
  register(program, getMessages("en"));
  const out: string[] = [];
  const err: string[] = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
  const prevExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await program.parseAsync(["node", "penguin", ...args]);
    return { out: out.join(""), err: err.join(""), code: Number(process.exitCode ?? 0) };
  } catch (e) {
    const exitCode = (e as { exitCode?: number }).exitCode;
    return { out: out.join(""), err: err.join(""), code: exitCode || 1 };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = prevExitCode;
  }
}

describe("run: --model-id and --provider must be given together", () => {
  it("--model-id without --provider: error on stderr, exit code 1", async () => {
    const bad = await runCommand(registerRunCommand, [
      "run",
      "-m",
      "hi",
      "--model-id",
      "deepseek-v4-flash",
    ]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("--model-id and --provider must be given together");
  });

  it("--provider without --model-id: same error (the pair is never half-specified)", async () => {
    const bad = await runCommand(registerRunCommand, ["run", "-m", "hi", "--provider", "deepseek"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("--model-id and --provider must be given together");
  });
});

describe("chat: --model-id and --provider must be given together", () => {
  it("--model-id without --provider: error on stderr, exit code 1", async () => {
    const bad = await runCommand(registerChatCommand, ["chat", "--model-id", "deepseek-v4-flash"]);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("--model-id and --provider must be given together");
  });

  it("--resume plus a lone --model-id keeps the more specific resume error", async () => {
    const bad = await runCommand(registerChatCommand, [
      "chat",
      "--resume",
      "sess-1",
      "--model-id",
      "deepseek-v4-flash",
    ]);
    expect(bad.code).toBe(1);
    expect(bad.out).toContain("--resume does not accept");
    expect(`${bad.out}${bad.err}`).not.toContain("must be given together");
  });
});
