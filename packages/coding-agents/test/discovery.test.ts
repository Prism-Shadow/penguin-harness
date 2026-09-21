/**
 * Discovery over a faked machine: a PATH holding only fixture "installs" and a fake home
 * for the version-manager dirs, so the recipes' detect/launch logic is pinned without
 * depending on what the test host really has installed. Windows fixtures are `.cmd`
 * shims — the shape npm actually leaves behind.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAgents } from "../src/discovery.js";
import { resolveCommandPath } from "../src/resolve.js";

const WIN = process.platform === "win32";

describe("agent discovery", () => {
  let root: string;
  let bin: string;
  let home: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agents-discover-"));
    bin = path.join(root, "bin");
    home = path.join(root, "home");
    await fs.mkdir(bin);
    await fs.mkdir(home, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  /** An "installed" CLI: an executable file in `dir` (a `.cmd` shim on Windows). */
  async function install(dir: string, name: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, WIN ? `${name}.cmd` : name), "", { mode: 0o755 });
  }

  const env = (): NodeJS.ProcessEnv => ({ PATH: bin });

  it("offers gemini with its native ACP flag when the CLI is on PATH", async () => {
    await install(bin, "gemini");
    const candidates = await discoverAgents({ env: env(), home });
    const gemini = candidates.find((c) => c.recipeId === "gemini");
    expect(gemini).toMatchObject({
      detected: true,
      setupHint: null,
      launch: { args: ["--experimental-acp"] },
    });
    expect(gemini?.launch?.command.toLowerCase()).toBe(
      path.join(bin, WIN ? "gemini.cmd" : "gemini").toLowerCase(),
    );
  });

  it("falls back to npx for an installed agent whose adapter is missing", async () => {
    await install(bin, "claude");
    await install(bin, "npx");
    const candidates = await discoverAgents({ env: env(), home });
    const claude = candidates.find((c) => c.recipeId === "claude");
    expect(claude?.detected).toBe(true);
    expect(claude?.launch?.command.toLowerCase()).toBe(
      path.join(bin, WIN ? "npx.cmd" : "npx").toLowerCase(),
    );
    expect(claude?.launch?.args).toEqual(["-y", "claude-agent-acp"]);
  });

  it("reports a setup hint when the agent is installed but no entrypoint is", async () => {
    await install(bin, "claude");
    const candidates = await discoverAgents({ env: env(), home });
    const claude = candidates.find((c) => c.recipeId === "claude");
    expect(claude?.launch).toBeNull();
    expect(claude?.setupHint).toContain("npm install -g claude-agent-acp");
  });

  it("marks agents absent from the machine as undetected", async () => {
    const candidates = await discoverAgents({ env: env(), home });
    const codex = candidates.find((c) => c.recipeId === "codex");
    expect(codex).toMatchObject({ detected: false, launch: null });
    expect(codex?.setupHint).toBe("Not found on the server machine.");
  });

  // The two flags are independent by design: an npx runner resolves without the agent.
  // Consumers (the Add-agent dialog) must gate "usable" on `detected`, not `launch`.
  it("still resolves an npx-run adapter when the agent itself is absent", async () => {
    await install(bin, "npx");
    const candidates = await discoverAgents({ env: env(), home });
    const claude = candidates.find((c) => c.recipeId === "claude");
    expect(claude?.detected).toBe(false);
    expect(claude?.launch?.args).toEqual(["-y", "claude-agent-acp"]);
  });

  it("finds CLIs in version-manager install dirs the PATH misses", async () => {
    await install(path.join(home, ".volta", "bin"), "gemini");
    await install(path.join(home, ".bun", "bin"), "npx");
    await install(path.join(home, ".bun", "bin"), "codex-acp");
    const candidates = await discoverAgents({ env: { PATH: "" }, home });
    const gemini = candidates.find((c) => c.recipeId === "gemini");
    const codex = candidates.find((c) => c.recipeId === "codex");
    expect(gemini?.detected).toBe(true);
    expect(gemini?.launch?.args).toEqual(["--experimental-acp"]);
    // The direct adapter wins over the npx fallback even though npx is also present.
    expect(codex?.launch?.command).toContain("codex-acp");
    expect(codex?.launch?.args).toEqual([]);
  });

  // fnm keeps one bin dir per Node install; on Windows that is the standard home of
  // npm-shim CLIs, and unlike the per-shell multishell dirs it survives the shell.
  it("finds CLIs under fnm's versioned Node roots", async () => {
    await install(path.join(home, "fnm", "node-versions", "v22.11.0", "installation"), "npx");
    const candidates = await discoverAgents({
      env: { PATH: "", FNM_DIR: path.join(home, "fnm") },
      home,
    });
    const claude = candidates.find((c) => c.recipeId === "claude");
    expect(claude?.launch?.command).toContain(
      path.join("node-versions", "v22.11.0", "installation"),
    );
    expect(claude?.launch?.args).toEqual(["-y", "claude-agent-acp"]);
  });
});

describe("resolveCommandPath", () => {
  let root: string;
  let bin: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agents-resolve-"));
    bin = path.join(root, "bin");
    await fs.mkdir(bin);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("resolves a bare name to the absolute executable", async () => {
    const file = path.join(bin, WIN ? "tool.cmd" : "tool");
    await fs.writeFile(file, "", { mode: 0o755 });
    const resolved = await resolveCommandPath("tool", { env: { PATH: bin } });
    expect(resolved.toLowerCase()).toBe(file.toLowerCase());
  });

  it("passes explicit paths and unknown names through unchanged", async () => {
    const explicit = path.join(root, "somewhere", "agent");
    expect(await resolveCommandPath(explicit, { env: { PATH: bin } })).toBe(explicit);
    expect(await resolveCommandPath("no-such-tool", { env: { PATH: bin } })).toBe("no-such-tool");
  });

  // npm drops an extensionless POSIX shim beside the spawnable .cmd twin; on Windows
  // the shim must lose, or discovery hands out a command Windows cannot start.
  it.skipIf(!WIN)("prefers the .cmd twin over npm's extensionless shim", async () => {
    await fs.writeFile(path.join(bin, "tool"), "", { mode: 0o755 });
    await fs.writeFile(path.join(bin, "tool.cmd"), "", { mode: 0o755 });
    const resolved = await resolveCommandPath("tool", { env: { PATH: bin } });
    expect(resolved.toLowerCase()).toBe(path.join(bin, "tool.cmd").toLowerCase());
  });

  // fnm's per-shell multishell dirs hold only the extensionless shim; resolving to it
  // would bake an unspawnable, dying-with-the-shell path into a saved definition.
  it.skipIf(!WIN)("never resolves a bare name to an extensionless shim", async () => {
    await fs.writeFile(path.join(bin, "npx"), "", { mode: 0o755 });
    expect(await resolveCommandPath("npx", { env: { PATH: bin } })).toBe("npx");
    // A command that spells its own dot still resolves by exact name.
    await fs.writeFile(path.join(bin, "odd.name"), "", { mode: 0o755 });
    expect((await resolveCommandPath("odd.name", { env: { PATH: bin } })).toLowerCase()).toBe(
      path.join(bin, "odd.name").toLowerCase(),
    );
  });
});
