/**
 * Integration tests for `penguin config vault set|list|remove` (run through commander's
 * parseAsync for the full command path, with PENGUIN_HOME pointed at a temp directory):
 * writes to a hidden .vault.toml (mode 0600), list masks values without leaking
 * plaintext, remove raises an error on a missing key, --agent-id targets a specific
 * Agent, and an invalid key name / an overlong value exit with a non-zero code.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { agentVaultPath, DEFAULT_PROJECT_ID } from "@prismshadow/penguin-core";
import { registerConfigCommand } from "../src/commands/config.js";
import { getMessages } from "../src/i18n.js";

let tmpRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cli-vault-"));
  process.env.PENGUIN_HOME = tmpRoot;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/** Runs a `penguin config vault …` command, capturing stdout/stderr and the exit code (without actually exiting the process). */
async function runVault(args: string[]): Promise<{ out: string; err: string; code: number }> {
  const program = new Command();
  program.exitOverride();
  registerConfigCommand(program, getMessages("en"));
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
    await program.parseAsync(["node", "penguin", "config", "vault", ...args]);
    return { out: out.join(""), err: err.join(""), code: Number(process.exitCode ?? 0) };
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = prevExitCode;
  }
}

describe("penguin config vault", () => {
  it("set → list（掩码）→ remove 全链路；落盘为隐藏 .vault.toml 且 0600", async () => {
    const set = await runVault(["set", "--key", "MY_KEY", "--value", "vault-secret-9876"]);
    expect(set.code).toBe(0);
    expect(set.out).toContain("Saved vault entry MY_KEY.");

    const file = agentVaultPath(tmpRoot, DEFAULT_PROJECT_ID, "default_agent");
    expect(path.basename(file)).toBe(".vault.toml");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(file, "utf8")).toContain("vault-secret-9876");

    const list = await runVault(["list"]);
    expect(list.code).toBe(0);
    expect(list.out).toContain("MY_KEY");
    expect(list.out).toContain("****9876");
    // Plaintext never appears in list output.
    expect(list.out).not.toContain("vault-secret-9876");

    const removed = await runVault(["remove", "--key", "MY_KEY"]);
    expect(removed.code).toBe(0);
    expect(removed.out).toContain("Removed vault entry MY_KEY.");
    const empty = await runVault(["list"]);
    expect(empty.out).toContain("The vault is empty.");
  });

  it("--agent-id 定向到目标 Agent 的 vault，不影响 default_agent", async () => {
    const set = await runVault([
      "set",
      "--key",
      "ONLY_A",
      "--value",
      "va-secret-value-1",
      "--agent-id",
      "agent-a",
    ]);
    expect(set.code).toBe(0);
    expect(
      await fs.readFile(agentVaultPath(tmpRoot, DEFAULT_PROJECT_ID, "agent-a"), "utf8"),
    ).toContain("ONLY_A");
    const defaultList = await runVault(["list"]);
    expect(defaultList.out).toContain("The vault is empty.");
  });

  it("--root 指定数据根目录（优先于 PENGUIN_HOME），set/list 均定向到该根目录", async () => {
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cli-vault-root-"));
    try {
      const set = await runVault([
        "set",
        "--key",
        "ROOTED_KEY",
        "--value",
        "root-secret-value-1",
        "--root",
        otherRoot,
      ]);
      expect(set.code).toBe(0);
      expect(
        await fs.readFile(agentVaultPath(otherRoot, DEFAULT_PROJECT_ID, "default_agent"), "utf8"),
      ).toContain("ROOTED_KEY");
      // The root directory pointed to by PENGUIN_HOME is unaffected.
      const defaultList = await runVault(["list"]);
      expect(defaultList.out).toContain("The vault is empty.");
      const rootedList = await runVault(["list", "--root", otherRoot]);
      expect(rootedList.out).toContain("ROOTED_KEY");
    } finally {
      await fs.rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("非法键名 / 超长值以非零码退出并打印原因；remove 不存在的键报错", async () => {
    const badKey = await runVault(["set", "--key", "1BAD", "--value", "v"]);
    expect(badKey.code).toBe(1);
    expect(badKey.err).toContain("Invalid vault key");

    const tooLong = await runVault(["set", "--key", "OK_BIG", "--value", "x".repeat(8193)]);
    expect(tooLong.code).toBe(1);
    expect(tooLong.err).toContain("too long");

    const ghost = await runVault(["remove", "--key", "GHOST"]);
    expect(ghost.code).toBe(1);
    expect(ghost.err).toContain("Vault entry GHOST does not exist.");
  });
});
