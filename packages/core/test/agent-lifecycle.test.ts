/**
 * Agent lifecycle: new session id format + no more `.penguin` symlink in the Workspace.
 *
 * - sessionId looks like `session-YYYY-MM-DD-HH-mm-ss-<8-digit hex>` (local time, zero-padded fields).
 * - createSession no longer creates any `.penguin` symlink inside the Workspace, nor touches existing
 *   Workspace files; the model reaches Agent State and other absolute paths directly by combining the
 *   Project Dir / Agent ID placeholders from the system prompt.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/index.js";
import { formatSessionId } from "../src/internal/session-support.js";
import { projectDir } from "../src/state/paths.js";
import { stubProviderKeys } from "./provider-keys.js";

let tmpRoot: string;
let prevHome: string | undefined;
let restoreKeys: () => void;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-harness-lifecycle-"));
  process.env.PENGUIN_HOME = tmpRoot;
  restoreKeys = stubProviderKeys();
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  restoreKeys();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

const SESSION_ID_RE = /^session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/;

describe("formatSessionId", () => {
  it("matches the session-YYYY-MM-DD-HH-mm-ss-<8hex> format", () => {
    expect(formatSessionId()).toMatch(SESSION_ID_RE);
  });

  it("uses local time fields with zero padding", () => {
    // 2026-06-19 15:28:08 local time -> session-2026-06-19-15-28-08-<hex>.
    const d = new Date(2026, 5, 19, 15, 28, 8);
    expect(formatSessionId(d)).toMatch(/^session-2026-06-19-15-28-08-[0-9a-f]{8}$/);
  });

  it("generates distinct ids on repeated calls", () => {
    expect(formatSessionId()).not.toBe(formatSessionId());
  });
});

describe("Agent.createSession session id + no .penguin symlink", () => {
  it("assigns a sessionId in the new format", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws });
    expect(session.sessionId).toMatch(SESSION_ID_RE);
  });

  it("does not create a .penguin entry in the workspace", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws");
    await fs.mkdir(ws, { recursive: true });
    await agent.createSession({ workspaceDir: ws });
    await expect(fs.lstat(path.join(ws, ".penguin"))).rejects.toThrow();
    // agent_state also no longer creates traces/notes symlinks.
    await expect(fs.lstat(path.join(agent.state.stateDir, "traces"))).rejects.toThrow();
    await expect(fs.lstat(path.join(agent.state.stateDir, "notes"))).rejects.toThrow();
  });

  it("leaves a user's pre-existing .penguin file untouched", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws");
    await fs.mkdir(ws, { recursive: true });
    const linkPath = path.join(ws, ".penguin");
    await fs.writeFile(linkPath, "user-data", "utf8");
    await agent.createSession({ workspaceDir: ws });
    expect(await fs.readFile(linkPath, "utf8")).toBe("user-data");
  });

  it("is idempotent: repeated createSession registers no exit listeners", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws");
    await fs.mkdir(ws, { recursive: true });
    const before = process.listenerCount("exit");
    for (let i = 0; i < 12; i++) {
      await agent.createSession({ workspaceDir: ws });
    }
    expect(process.listenerCount("exit") - before).toBe(0);
  });

  it("injects Project Dir and Agent ID into the assembled system prompt", async () => {
    const agent = await createAgent();
    const ws = path.join(tmpRoot, "ws");
    await fs.mkdir(ws, { recursive: true });
    const session = await agent.createSession({ workspaceDir: ws });
    const prompt = (session.metaMessage.payload as { system_prompt: string }).system_prompt;
    expect(prompt).toContain(`Agent ID: ${agent.state.agentId}`);
    expect(prompt).toContain(`Project Dir: ${projectDir(tmpRoot, agent.state.projectId)}`);
    expect(prompt).not.toContain(".penguin");
  });
});
